import copy,json,unittest
from pathlib import Path
from gliner_onnx.entity_contract import validate_contract,app_schema,compare_records
ROOT=Path(__file__).resolve().parents[3]
class EntityContract(unittest.TestCase):
 def fixture(self):return json.loads((ROOT/'tests/fixtures/entity-contract.json').read_text())
 def test_declarative_contract_preserves_group_applicability(self):
  c=self.fixture();validate_contract(c);s=app_schema(c)
  self.assertIn('phase',s['families']['action']['fields']);self.assertNotIn('phase',s['families']['report']['fields'])
 def test_rejects_override_windowing_and_non_entity_applicability(self):
  for mutate in [lambda c:c.update(contextPolicy='window'),lambda c:c.update(maxEncodedTokens=2048),lambda c:c['attributes'][0].update(appliesTo=['owner: subject']),lambda c:c['attributes'][0].update(selection='multiple')]:
   c=self.fixture();mutate(c)
   with self.assertRaises(ValueError):validate_contract(c)
 def test_parity_rejects_attribute_defaults_and_confidence_drift(self):
  row={'family':'report','anchor':[{'start':0,'end':6,'text':'report'}],'fields':{'owner':'subject'},'score':.9,'attributeScores':{'owner':.7}}
  actual=copy.deepcopy(row);actual['score']+=1e-5;self.assertTrue(compare_records([row],[actual])['spansAndAttributesExact'])
  actual['fields']['phase']='later'
  with self.assertRaises(ValueError):compare_records([row],[actual])
