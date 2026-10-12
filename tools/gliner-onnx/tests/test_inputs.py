import hashlib
import json
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from gliner_onnx.inputs import (BASE_FILES, RELEASE_ASSETS, read_adapter,
                                resolve_base, resolve_selection, snapshot_adapter,
                                verify_base, verify_v3_runtime)
from gliner_onnx.cli import build, fixture_paths


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

    def test_source_and_head_fixtures_are_packaged_exactly_once(self):
        source = ['source-case-0.json', 'model-reference-0.json', 'attributes-reference.json']
        for name in [*source, 'records-reference.json', 'relations-reference.json']:
            (self.root/name).write_text('{}')
        paths = fixture_paths(self.root, [*source, source[1]])
        self.assertEqual(paths, [*source, 'records-reference.json', 'relations-reference.json'])
        self.assertEqual(len(paths), len(set(paths)))

    def test_package_and_report_cannot_alias_even_before_export_starts(self):
        folder = self.root/'destination'
        folder.mkdir()
        alias = self.root/'alias'
        alias.symlink_to(folder, target_is_directory=True)
        output = folder/'new-model.zip'
        for report in [output, folder/'..'/'destination'/'new-model.zip', alias/'new-model.zip']:
            with self.subTest(report=report), self.assertRaisesRegex(ValueError, 'distinct paths'):
                # No adapter/import/work-directory arguments: rejection must
                # happen before loading models or producing any artifacts.
                build(SimpleNamespace(out=output,report=report))
            self.assertFalse(output.exists())

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

    def test_model_selection_presets_are_pinned_and_default_to_small_adapter(self):
        default = resolve_selection('auto')
        self.assertEqual(default['selection'], 'clinical-v3-small')
        self.assertEqual(default['repo_id'], 'na399/clinical-evidence-gliner2.5-small-lora-v3-act-sol')
        self.assertEqual(default['revision'], '82386c7a9776d3c14ed73d6310273a1c9d354d55')
        self.assertEqual((default['base_model'], default['base_revision']),
                         ('fastino/gliner2.5-small-v1', '7132dc4561c3f94563c6147e75ffa8ef34c4964a'))
        base_adapter = resolve_selection('clinical-v3-base')
        self.assertEqual(base_adapter['revision'], 'b5db08ccd2581690f30a448428ba7659e1469eeb')
        self.assertEqual((base_adapter['base_model'], base_adapter['base_revision']),
                         ('fastino/gliner2.5-base-v1', 'ca906247640776a07753514055be9726f9080ead'))
        self.assertEqual(base_adapter['threshold'], 0.6)

    def test_original_checkpoint_selections_have_no_adapter_and_keep_existing_base_pin(self):
        small = resolve_selection('original-small')
        base = resolve_selection('original-base')
        self.assertEqual(small['kind'], 'base')
        self.assertEqual((small['base_model'], small['base_revision']),
                         ('fastino/gliner2.5-small-v1', '7132dc4561c3f94563c6147e75ffa8ef34c4964a'))
        self.assertEqual((base['base_model'], base['base_revision']),
                         ('fastino/gliner2.5-base-v1', 'ca906247640776a07753514055be9726f9080ead'))
        self.assertEqual(base['base_license'], 'Apache-2.0')
        with self.assertRaisesRegex(ValueError, 'does not accept adapter inputs'):
            resolve_selection('original-small', adapter=self.root/'adapter.zip')

    def test_custom_hub_and_local_selections_require_bounded_inputs(self):
        remote = resolve_selection('huggingface-adapter', repository='owner/adapter', revision='d'*40)
        self.assertEqual((remote['repo_id'], remote['revision']), ('owner/adapter', 'd'*40))
        for repository, revision in [('owner/adapter', 'main'), ('https://evil/adapter', 'd'*40), ('bad', 'd'*40)]:
            with self.subTest(repository=repository, revision=revision), self.assertRaises(ValueError):
                resolve_selection('huggingface-adapter', repository=repository, revision=revision)
        with self.assertRaisesRegex(ValueError, 'require --adapter'):
            resolve_selection('local-adapter')
        self.assertEqual(resolve_selection('auto', adapter=self.root/'adapter.zip')['selection'], 'local-adapter')

    def test_hub_download_allowlists_only_adapter_tensors_and_pinned_runtime_assets(self):
        with patch('huggingface_hub.snapshot_download', return_value=str(self.root/'download')) as download:
            snapshot_adapter('owner/adapter', 'a'*40, self.root/'plain')
        plain_args = download.call_args.kwargs
        self.assertEqual(plain_args['allow_patterns'], ['adapter_config.json', 'adapter_model.safetensors'])
        self.assertNotIn('tokenizer.py', plain_args['allow_patterns'])
        self.assertIsNone(plain_args['token'])
        with patch('huggingface_hub.snapshot_download', return_value=str(self.root/'release')) as download:
            snapshot_adapter('owner/adapter', 'b'*40, self.root/'release', include_v3_runtime=True)
        release_args = download.call_args.kwargs
        self.assertIsNone(release_args['token'])
        self.assertIn('vendor/gliner2/**', release_args['allow_patterns'])
        self.assertTrue(set(RELEASE_ASSETS).issubset(release_args['allow_patterns']))
        self.assertNotIn('usage.py', release_args['allow_patterns'])
        self.assertNotIn('README.md', release_args['allow_patterns'])

    def test_clinical_runtime_fails_before_import_when_pinned_release_assets_are_missing(self):
        with self.assertRaisesRegex(ValueError, 'Pinned clinical release asset'):
            verify_v3_runtime(self.root)

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

    def test_release_pinned_base_assets_verify_offline(self):
        base = self.root/'release-base'
        hashes = {}
        for name in BASE_FILES:
            path = base/name
            path.parent.mkdir(parents=True, exist_ok=True)
            data = json.dumps({'architecture': 'boundary', 'token_pooling': 'first'}).encode() if name == 'config.json' else name.encode()
            path.write_bytes(data)
            hashes[name] = hashlib.sha256(data).hexdigest()
        actual = verify_base(base, 'fastino/test', 'a'*40, expected_hashes=hashes)
        self.assertEqual(actual, hashes)
        with self.assertRaisesRegex(ValueError, 'Pinned base content mismatch'):
            verify_base(base, 'fastino/test', 'a'*40,
                        expected_hashes={**hashes, 'model.safetensors': '0'*64})


if __name__ == '__main__':
    unittest.main()
