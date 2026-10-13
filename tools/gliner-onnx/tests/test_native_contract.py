import json, tempfile, unittest, zipfile
from pathlib import Path
from gliner_onnx.inputs import verify_browser_contract, read_adapter
class NativeContractTests(unittest.TestCase):
 def test_legacy_export_rejects_every_changed_declared_setting(self):
  with tempfile.TemporaryDirectory() as root:
   p=Path(root)/'inference_settings.json'
   for settings in [{'maxEncodedTokens':256},{'maxEncodedTokens':-1},{'maxEncodedTokens':None},{'threshold':.7},{'threshold':None},{'overlapPolicy':'unknown'},{'overlapPolicy':None}]:
    with self.subTest(settings=settings):
     p.write_text(json.dumps(settings))
     with self.assertRaisesRegex(ValueError,'unsupported by the browser exporter'):verify_browser_contract(root)
   for settings in [{},{'maxEncodedTokens':512,'overlapPolicy':'flat','threshold':.5}]:
    p.write_text(json.dumps(settings));verify_browser_contract(root)

 def test_rejects_declared_overlapping_1024_token_native_contract(self):
  with tempfile.TemporaryDirectory() as root:
   p=Path(root)/'inference_settings.json'
   for settings in [{'maxEncodedTokens':1024},{'overlapPolicy':'allow'}]:
    p.write_text(json.dumps(settings))
    with self.assertRaisesRegex(ValueError,'unsupported by the browser exporter'):verify_browser_contract(root)
   p.write_text(json.dumps({'maxEncodedTokens':512,'overlapPolicy':'flat'}));verify_browser_contract(root)

 def test_zipped_contract_cannot_bypass_the_native_guard(self):
  with tempfile.TemporaryDirectory() as root:
   archive=Path(root)/'adapter.zip'
   for settings in [{'maxEncodedTokens':1024,'overlapPolicy':'allow'},{'maxEncodedTokens':256},{'threshold':.7}]:
    with self.subTest(settings=settings):
     with zipfile.ZipFile(archive,'w') as z:
      z.writestr('adapter/adapter_config.json','{}')
      z.writestr('adapter/adapter_model.safetensors',b'fixture')
      z.writestr('adapter/inference_settings.json',json.dumps(settings))
     with self.assertRaisesRegex(ValueError,'unsupported by the browser exporter'):read_adapter(archive,Path(root)/'out')
     self.assertFalse((Path(root)/'out').exists())
