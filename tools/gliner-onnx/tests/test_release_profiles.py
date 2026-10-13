import unittest
from unittest.mock import patch
from gliner_onnx.release_profiles import p10_contract, PROFILES
from gliner_onnx.entity_contract import validate_contract

class Profiles(unittest.TestCase):
    def test_profiles_pin_distinct_base_releases(self):
        self.assertNotEqual(PROFILES['clinical-p10'][2],PROFILES['bpsd-base'][2])
        for repository,revision,base in PROFILES.values():
            self.assertTrue(repository.startswith('na399/'))
            self.assertEqual(len(revision),40);self.assertEqual(len(base),40)

    def test_p10_complete_ontology_compiles_without_v3_vocabulary(self):
        ontology={'families':{'finding':{'canonical':'finding_occurrence','model_label':'clinical_finding','description':'Observed finding'}},
                  'axes':{'assertion':['affirmed','planned'],'time_frame':['current','unspecified']}}
        with patch('gliner_onnx.release_profiles.verify_p10',return_value={'inference':{'threshold':.25}}),patch('pathlib.Path.read_text',return_value=__import__('json').dumps(ontology)):
            c=p10_contract('synthetic-release')
        self.assertEqual(c['maxWords'],384);self.assertEqual(c['maxEncodedTokens'],512)
        self.assertEqual(c['threshold'],.25);self.assertEqual(c['entities'][0]['label'],'clinical_finding')
        self.assertEqual(c['attributes'][0]['labels'][1]['value'],'planned')
        self.assertEqual(c['attributes'][1]['labels'][1]['value'],'unspecified')
        self.assertTrue(all(g['qualifyLabels'] for g in c['attributes']))
        self.assertEqual(validate_contract(c),c)
