import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from prepare_validation_notes import agreement, contextual_span


class GeneratedNotes(unittest.TestCase):
    def test_context_disambiguates_repeated_anchors_with_unicode_offsets(self):
        text = '👩‍⚕️ Mother has diabetes. Patient denies diabetes.'
        span = contextual_span(text, 'Patient denies diabetes.', 'diabetes')
        self.assertEqual(span['start'], text.rindex('diabetes'))
        self.assertEqual(text[span['start']:span['end']], 'diabetes')
        with self.assertRaises(ValueError):
            contextual_span(text, text, 'diabetes')
        with self.assertRaises(ValueError):
            contextual_span(text, 'Missing context', 'diabetes')

    def test_all_supplied_note_references_have_exact_source_spans(self):
        fixture = json.loads((ROOT/'tests/fixtures/lora-clinical-samples.json').read_text())
        anchors = literals = 0
        ids = set()
        for note in fixture['notes']:
            self.assertNotIn(note['id'], ids)
            ids.add(note['id'])
            for reference in note['references']:
                for span in [reference['anchor'], *reference['literals']]:
                    self.assertEqual(note['text'][span['start']:span['end']], span['text'])
                anchors += 1
                literals += len(reference['literals'])
        self.assertEqual((len(ids), anchors, literals), (27, 618, 507))
        self.assertFalse(fixture['source']['clinicalGoldStandard'])
        self.assertEqual(fixture['source']['referenceCompleteness'], 'unverified')
        self.assertEqual(len(fixture['allReferenceEnums']['status']), 17)
        for family in fixture['schema']['families'].values():
            for field in family['fields'].values():
                if field['type']=='enum':
                    self.assertLessEqual(len(field['values']), 8)

    def test_agreement_requires_family_and_offsets_and_ignores_unlabeled_attributes(self):
        note = {'id':'test', 'references':[
            {'family':'event_occurrence', 'anchor':{'start':0,'end':4}, 'choices':{'assertion':'negated'}, 'literals':[]},
            {'family':'event_occurrence', 'anchor':{'start':10,'end':14}, 'choices':{}, 'literals':[]}]}
        result = {'status':'complete', 'windows':[{}], 'records':[
            {'family':'event_occurrence', 'anchor':[{'start':0,'end':4}], 'fields':{'assertion':'negated'}},
            {'family':'condition_occurrence', 'anchor':[{'start':10,'end':14}], 'fields':{'assertion':'affirmed'}}]}
        report = agreement([note], [result])
        self.assertEqual(report['exactAnchors']['f1Agreement'], .5)
        self.assertEqual(report['exactAnchors']['matched'], 1)
        self.assertEqual(report['enumAgreementOnExactMatchedAnchors']['assertion']['fractionAgree'], 1)
        self.assertIn('not clinical accuracy', report['interpretation'])

    def test_duplicate_predictions_do_not_inflate_matching(self):
        reference = {'family':'event_occurrence', 'anchor':{'start':0,'end':4}, 'choices':{}, 'literals':[]}
        prediction = {'family':'event_occurrence', 'anchor':[{'start':0,'end':4}], 'fields':{}}
        report = agreement([{'id':'test','references':[reference]}],
                           [{'status':'complete','windows':[{}], 'records':[prediction,prediction]}])
        self.assertEqual(report['exactAnchors']['matched'], 1)
        self.assertEqual(report['exactAnchors']['precisionAgreement'], .5)


if __name__ == '__main__':
    unittest.main()
