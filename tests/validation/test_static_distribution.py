"""Ensure static model metadata cannot accidentally distribute local private files."""
import tempfile, unittest
from pathlib import Path
from scripts.backend_assets import copy_public_models
class StaticDistribution(unittest.TestCase):
 def test_public_metadata_allowed_and_model_weights_rejected(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);source=root/'source';source.mkdir();out=root/'out'
   (source/'catalog.json').write_text('{"entries":[]}')
   copy_public_models(source,out);self.assertTrue((out/'models/catalog.json').is_file())
   (source/'adapter_model.safetensors').write_bytes(b'synthetic-placeholder')
   with self.assertRaisesRegex(ValueError,'Unreviewed file'):copy_public_models(source,root/'blocked')
   self.assertFalse((root/'blocked/models').exists())
 def test_metadata_symlinks_rejected(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);source=root/'source';source.mkdir();(root/'private.json').write_text('{}')
   try:(source/'catalog.json').symlink_to(root/'private.json')
   except OSError as error:self.skipTest('Host denies symlink creation: '+str(error))
   with self.assertRaisesRegex(ValueError,'Unreviewed file'):copy_public_models(source,root/'out')
