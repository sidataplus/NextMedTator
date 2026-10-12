"""Exercise CLI packaging with stub tensors; these are not inference tests."""
import json
import tempfile
import unittest
import zipfile
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from gliner_onnx.cli import build
from gliner_onnx.inputs import (BASE_FILES, PINNED_ADAPTERS, RELEASE_REGISTRY_HASH,
                               RELEASE_RUNTIME_FINGERPRINT, resolve_selection)


class PinnedExportIdentityTests(unittest.TestCase):
    def test_default_and_both_pinned_exports_retain_release_identity(self):
        for chosen in ['auto', 'clinical-v3-small', 'clinical-v3-base']:
            with self.subTest(selection=chosen), tempfile.TemporaryDirectory() as directory:
                root=Path(directory);package=root/'release';package.mkdir()
                selection=resolve_selection(chosen)
                pinned=PINNED_ADAPTERS[selection['selection']]
                schema={'registry_sha256':RELEASE_REGISTRY_HASH,'core_entities':{'sample':'Synthetic test query'},'shared_axes':{}}
                (package/'schema_v3.json').write_text(json.dumps(schema))
                (package/'synthetic_cases.json').write_text('{"cases":[]}')
                base_hashes={name:'c'*64 for name in BASE_FILES}
                release={'runtime':{'source_fingerprint':RELEASE_RUNTIME_FINGERPRINT}}
                spec={'base_model':{'files':base_hashes},'core_threshold':pinned['threshold'],
                      'selection_sha256':'d'*64,'adapter_fingerprint':'e'*64}
                def read_adapter(source,target):
                    target.mkdir();(target/'adapter_config.json').write_text('{}')
                    (target/'adapter_model.safetensors').write_bytes(b'stub tensors, not inference weights')
                    return {},'b'*64
                def save_tokenizer(path): (Path(path)/'tokenizer.json').write_text('{}')
                model=SimpleNamespace(record_decoder=object(),relation_scorer=object(),
                                      processor=SimpleNamespace(tokenizer=SimpleNamespace(save_pretrained=save_tokenizer)),
                                      boundary_settings=SimpleNamespace(pair_temperature=1,abstention_threshold=.5))
                model.eval=lambda:model
                runtime=SimpleNamespace(from_pretrained=lambda *a,**k:model)
                def export_model(model,captures,path,**kwargs):
                    for name in ['model.onnx','attributes.onnx']: (path/name).write_bytes(b'stub graph')
                    (path/'reference.json').write_text('{}')
                    return ['reference.json'],{}
                args=SimpleNamespace(entity_contract=None,out=root/'model.zip',report=root/'report.json',threads=1,
                                     selection=chosen,adapter=None,adapter_repository=None,adapter_revision=None,
                                     base_model=None,base_revision=None,base_dir=root/'base',release_dir=package,
                                     runtime_package_dir=None,clinical_schema=None,thresholds=None,clinical_release=None,
                                     cases=None,id=None,work_dir=root/'work',base_license='Apache-2.0',adapter_license='Test-only')
                mocks={'verify_v3_release':(release,spec),'verify_v3_runtime':release,'verify_browser_contract':None,
                       'resolve_base':(pinned['base_model'],pinned['base_revision']),'verify_base':base_hashes,
                       '_load_export_runtime':(runtime,{'sourceFingerprint':RELEASE_RUNTIME_FINGERPRINT}),
                       'merge_adapter':(model,{'trainedHeads':'unchanged'}),'source_cases':[]}
                with ExitStack() as stack:
                    for name,value in mocks.items():stack.enter_context(patch('gliner_onnx.cli.'+name,return_value=value))
                    stack.enter_context(patch('gliner_onnx.cli.read_adapter',side_effect=read_adapter))
                    stack.enter_context(patch('gliner_onnx.cli.export_model',side_effect=export_model))
                    report=build(args)
                with zipfile.ZipFile(args.out) as archive:manifest=json.loads(archive.read('manifest.json'))
                variant=manifest['variants'][0]
                expected={'modelSize':selection['model_key'],'runtimeFingerprint':RELEASE_RUNTIME_FINGERPRINT,
                          'registryHash':RELEASE_REGISTRY_HASH,'adapterFingerprint':spec['adapter_fingerprint'],
                          'coreThreshold':pinned['threshold']}
                self.assertEqual(variant.get('clinicalRelease'),expected)
                self.assertEqual(report.get('clinicalRelease'),expected)
                self.assertEqual(variant['threshold'],expected['coreThreshold'])
                self.assertEqual(json.loads(args.report.read_text())['clinicalRelease'],expected)


if __name__=='__main__':unittest.main()
