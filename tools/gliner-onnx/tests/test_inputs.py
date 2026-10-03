import hashlib
import json
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from gliner_onnx.inputs import BASE_FILES, read_adapter, resolve_base, verify_base


class Inputs(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.config = {'peft_type': 'LORA', 'r': 8, 'target_modules': ['query_proj'],
                       'base_model_name_or_path': '/cache/models--fastino--gliner2.5-base-v1/snapshots/'+'a'*40}

    def tearDown(self):
        self.temp.cleanup()

    def adapter(self, extras=()):
        path = self.root/'adapter.zip'
        with zipfile.ZipFile(path, 'w') as z:
            z.writestr('arbitrary-name/adapter_config.json', json.dumps(self.config))
            z.writestr('arbitrary-name/adapter_model.safetensors', b'test-input-only')
            for name, data in extras:
                z.writestr(name, data)
        return path

    def test_zip_and_directory_have_same_identity_and_ignore_mac_metadata(self):
        cfg, hash_zip = read_adapter(self.adapter([('__MACOSX/._adapter', b'irrelevant')]), self.root/'a')
        _, hash_dir = read_adapter(self.root/'a', self.root/'b')
        self.assertEqual(hash_zip, hash_dir)
        self.assertEqual(resolve_base(cfg), ('fastino/gliner2.5-base-v1', 'a'*40))

    def test_reject_unsafe_and_ambiguous_archives(self):
        for member in ['../adapter_model.safetensors', '/absolute', 'windows\\file', 'arbitrary-name/adapter_config.json', 'other/adapter_config.json']:
            with self.subTest(member=member), self.assertRaises(ValueError):
                read_adapter(self.adapter([(member, b'{}')]), self.root/'out')
        info = zipfile.ZipInfo('link')
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaises(ValueError):
            read_adapter(self.adapter([(info, b'/etc/passwd')]), self.root/'out')

    def test_base_conflicts_and_mutable_revision_are_rejected(self):
        for kwargs in [{'model': 'other/base'}, {'revision': 'b'*40}]:
            with self.assertRaises(ValueError):
                resolve_base(self.config, **kwargs)
        with self.assertRaises(ValueError):
            resolve_base({'base_model_name_or_path': 'fastino/gliner2.5-base-v1', 'revision': 'main'})
        self.assertEqual(resolve_base({}, 'fastino/gliner2.5-small-v1', 'c'*40), ('fastino/gliner2.5-small-v1', 'c'*40))

    def test_unmergeable_invocation_adapter_rejected(self):
        self.config['alora_invocation_tokens'] = [1, 2]
        with self.assertRaisesRegex(ValueError, 'Invocation'):
            read_adapter(self.adapter(), self.root/'out')

    def test_local_base_is_verified_against_immutable_git_and_lfs_bytes(self):
        base = self.root/'base'
        for name in BASE_FILES:
            p = base/name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b'weights' if name.endswith('.safetensors') else b'{}')
        (base/'config.json').write_text(json.dumps({'architecture': 'boundary', 'token_pooling': 'first'}))
        def metadata(url):
            name = url.split('/'+'a'*40+'/')[1]
            data = (base/name).read_bytes()
            etag = hashlib.sha256(data).hexdigest() if name.endswith('.safetensors') else hashlib.sha1(f'blob {len(data)}\0'.encode()+data).hexdigest()
            return SimpleNamespace(commit_hash='a'*40, size=len(data), etag=etag)
        with patch('huggingface_hub.get_hf_file_metadata', metadata):
            hashes = verify_base(base, 'fastino/test', 'a'*40)
        self.assertEqual(len(hashes), 5)
        with patch('huggingface_hub.get_hf_file_metadata', return_value=SimpleNamespace(commit_hash='a'*40, size=1, etag='0'*64)):
            with self.assertRaisesRegex(ValueError, 'mismatch'):
                verify_base(base, 'fastino/test', 'a'*40)


if __name__ == '__main__':
    unittest.main()
