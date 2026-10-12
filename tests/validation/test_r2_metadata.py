"""Deployment metadata must opt in and must not broaden model request URLs."""
import json
import os
import sys
import tempfile
import unittest
import importlib
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'scripts'))
from model_delivery import r2_catalog, connect_origins


class R2MetadataTests(unittest.TestCase):
    def entry(self):
        revision='a'*64;origin='https://models.example.org';prefix=f'/nextmedtator-models/{revision}/'
        return {'revision':revision,'delivery':{'kind':'r2','origin':origin,'prefix':prefix},
                'manifest':{'files':[{'path':'model.onnx'}]},'urls':{'model.onnx':origin+prefix+'model.onnx'}}

    def read(self, entry):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'catalog.json';path.write_text(json.dumps({'entries':[entry]}))
            with patch.dict(os.environ, {'NMT_MODEL_CATALOG':str(path)}):return r2_catalog(),connect_origins()

    def test_default_has_no_destination(self):
        with patch.dict(os.environ, {}, clear=True):self.assertEqual(r2_catalog(),{'entries':[]})

    def test_reviewed_origin_and_exact_prefix(self):
        catalog,origins=self.read(self.entry());self.assertEqual(len(catalog['entries']),1)
        self.assertEqual(origins,['https://models.example.org'])

    def test_bad_origins_and_changed_urls(self):
        for origin in ['http://models.example.org','https://user:secret@models.example.org','https://models.example.org/path','https://models.example.org?secret=x']:
            entry=self.entry();entry['delivery']['origin']=origin
            with self.assertRaises(ValueError):self.read(entry)
        entry=self.entry();entry['urls']['model.onnx']='https://other.example.org/model.onnx'
        with self.assertRaises(ValueError):self.read(entry)

    def test_paths_cannot_escape_or_normalize_outside_prefix(self):
        for path in ['../schema.dtd','x//model.onnx','/model.onnx','..']:
            entry=self.entry();entry['manifest']['files'][0]['path']=path;entry['urls']={path:entry['delivery']['origin']+entry['delivery']['prefix']+path}
            with self.assertRaises(ValueError):self.read(entry)

    def test_notice_subdirectories_are_kept_under_prefix(self):
        entry=self.entry();path='LICENSES/Apache-2.0.txt';entry['manifest']['files'][0]['path']=path;entry['urls']={path:entry['delivery']['origin']+entry['delivery']['prefix']+path}
        self.assertEqual(len(self.read(entry)[0]['entries']),1)

    def test_opt_in_build_adds_catalog_and_only_reviewed_csp_origin(self):
        from backend_assets import copy_public_models
        import build_preview
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'models';source.mkdir();(source/'catalog.json').write_text('{"entries":[]}')
            configured=root/'approved.json';configured.write_text(json.dumps({'entries':[self.entry()]}))
            output=root/'output';output.mkdir()
            with patch.dict(os.environ,{'NMT_MODEL_CATALOG':str(configured)}):
                copy_public_models(source,output)
                headers=importlib.reload(build_preview).HEADERS
            self.assertEqual(len(json.loads((output/'models/catalog.json').read_text())['entries']),1)
            self.assertIn('https://models.example.org',headers)
            self.assertIn('Cross-Origin-Embedder-Policy: require-corp',headers)
            self.assertNotIn('https://*.r2',headers)
        importlib.reload(build_preview)


if __name__=='__main__':unittest.main()
