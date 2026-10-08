import tempfile
import unittest
from pathlib import Path

from scripts import evaluate_sample_tree as evaluator


class FakeSchema:
    def __init__(self):
        self._entity_attribute_groups = {
            "assertion": object(), "experiencer": object(), "time frame": object()
        }
        self.declared = ()

    def entities(self, labels):
        self.declared = tuple(labels)
        return self

    def entity_attributes(self, groups):
        self._entity_attribute_groups = groups
        return self


class FakeModel:
    def __init__(self, direct_rows=None, raise_direct=False):
        self.direct_rows = direct_rows or {}
        self.raise_direct = raise_direct
        self.received_schema = None

    def extract(self, text, schema, **kwargs):
        if self.raise_direct:
            raise RuntimeError("synthetic inference failure")
        self.received_schema = schema
        labels = {
            label: [row for row in self.direct_rows.get(text, []) if row["entity_type"] == label]
            for label in schema.declared
        }
        return {"entities": labels}


class FakeLoaded:
    def __init__(self, direct_rows=None, native_rows=None, raise_inference=False):
        self.schema = FakeSchema()
        self.model = FakeModel(direct_rows, raise_inference)
        self.native_rows = native_rows or {}
        self.threshold = 0.7

    def predict(self, text):
        return {"spans": self.native_rows.get(text, [])}


def _annotation(text, spans):
    return evaluator.ParsedAnnotation(text=text, spans=spans)


def _set(entities, annotations):
    schema = evaluator.SchemaInventory(
        entities=tuple(entities), relations=(), entity_attributes={},
        relation_attributes={}, source_hash="schema-hash", source_kind="test",
    )
    return evaluator.AnnotationSet(
        task="synthetic", group="A", schema=schema, annotations=annotations, source_files=len(annotations)
    )


def _direct_row(label, start, end, text, assertion=None):
    row = {"entity_type": label, "start": start, "end": end, "text": text}
    if assertion is not None:
        row["assertion"] = assertion
    return row


class SampleTreeEvaluatorTests(unittest.TestCase):
    def test_cross_document_same_offsets_do_not_match(self):
        annotations = [
            _annotation("abc", [evaluator.GoldSpan("Symptom", 0, 3, {})]),
            _annotation("xyz", []),
        ]
        loaded = FakeLoaded(
            direct_rows={"xyz": [_direct_row("Symptom", 0, 3, "xyz")]},
            native_rows={"xyz": [_direct_row("clinical_condition", 0, 3, "xyz")]},
        )
        result = evaluator._evaluate_set(_set(["Symptom"], annotations), loaded,
                                         FakeSchema, {}, {})

        direct = result["directSchema"]["exactLabelAndOffset"]
        native = result["nativeV3"]["exactFamilyAndOffset"]
        self.assertEqual((direct["gold"], direct["predicted"], direct["matched"]), (1, 1, 0))
        self.assertEqual((native["gold"], native["predicted"], native["matched"]), (1, 1, 0))

    def test_native_prediction_scope_comes_from_schema_not_present_gold(self):
        annotations = [_annotation("abc", [evaluator.GoldSpan("Symptom", 0, 3, {})])]
        loaded = FakeLoaded(native_rows={
            "abc": [_direct_row("clinical_treatment", 0, 3, "abc")]
        })
        result = evaluator._evaluate_set(_set(["Symptom", "VAX"], annotations), loaded,
                                         FakeSchema, {}, {})
        native = result["nativeV3"]
        self.assertEqual(native["exactFamilyAndOffset"]["predicted"], 1)
        self.assertEqual(native["exactFamilyAndOffset"]["matched"], 0)
        self.assertEqual(native["predictionsOutsideMappedFamilies"], 0)

    def test_native_scoring_keeps_mapped_spans_beside_unsupported_gold_labels(self):
        annotations = [_annotation("abc xyz", [
            evaluator.GoldSpan("Symptom", 0, 3, {}),
            evaluator.GoldSpan("Severity", 4, 7, {}),
        ])]
        loaded = FakeLoaded(native_rows={
            "abc xyz": [_direct_row("clinical_condition", 0, 3, "abc")]
        })
        result = evaluator._evaluate_set(
            _set(["Symptom", "Severity", "VAX"], annotations), loaded,
            FakeSchema, {}, {},
        )
        native = result["nativeV3"]
        self.assertEqual(native["scoredDocuments"], 1)
        self.assertEqual(native["eligibleGoldSpans"], 1)
        self.assertEqual(native["exactFamilyAndOffset"]["matched"], 1)
        self.assertEqual(native["unmappedGoldSpansByLabel"], {"Severity": 1})

    def test_native_boundary_metrics_preserve_duplicate_anchor_multiplicity(self):
        annotations = [_annotation("abc", [
            evaluator.GoldSpan("Symptom", 0, 3, {}),
            evaluator.GoldSpan("AE", 0, 3, {}),
        ])]
        loaded = FakeLoaded(native_rows={
            "abc": [
                _direct_row("clinical_condition", 0, 3, "abc"),
                _direct_row("clinical_condition", 0, 3, "abc"),
            ]
        })
        result = evaluator._evaluate_set(
            _set(["Symptom", "AE"], annotations), loaded, FakeSchema, {}, {}
        )
        native = result["nativeV3"]
        self.assertEqual(native["exactFamilyAndOffset"]["gold"], 2)
        self.assertEqual(native["exactOffsetIgnoringFamily"]["gold"], 2)
        self.assertEqual(native["exactOffsetIgnoringFamily"]["matched"], 2)

    def test_failed_inference_preserves_gold_as_false_negative(self):
        annotations = [_annotation("abc", [evaluator.GoldSpan("Symptom", 0, 3, {})])]
        loaded = FakeLoaded(raise_inference=True)
        result = evaluator._evaluate_set(_set(["Symptom"], annotations), loaded,
                                         FakeSchema, {}, {})
        direct = result["directSchema"]
        self.assertEqual(direct["scoredDocuments"], 1)
        self.assertEqual(direct["eligibleGoldSpans"], 1)
        self.assertEqual(direct["exactLabelAndOffset"]["matched"], 0)
        self.assertEqual(direct["exactLabelAndOffset"]["recall"], 0.0)
        self.assertEqual(direct["failureTypes"], {"RuntimeError": 1})

    def test_bad_gold_document_is_quarantined_from_exact_span_metrics(self):
        good = _annotation("abc", [evaluator.GoldSpan("Symptom", 0, 3, {})])
        bad = _annotation("xyz", [evaluator.GoldSpan("Symptom", 0, 3, {})])
        bad.invalid_offsets = 1
        loaded = FakeLoaded(direct_rows={
            "abc": [_direct_row("Symptom", 0, 3, "abc")],
            "xyz": [_direct_row("Symptom", 0, 3, "xyz")],
        })
        result = evaluator._evaluate_set(_set(["Symptom"], [good, bad]), loaded,
                                         FakeSchema, {}, {})
        direct = result["directSchema"]
        self.assertEqual(direct["scoredDocuments"], 1)
        self.assertEqual(direct["eligibleGoldSpans"], 1)
        self.assertEqual(direct["exactLabelAndOffset"]["matched"], 1)
        self.assertEqual(direct["excludedDocumentsByReason"], {"invalid_offsets": 1})

    def test_span_entities_remain_eligible_beside_document_level_tags(self):
        annotation = _annotation("abc", [evaluator.GoldSpan("Symptom", 0, 3, {})])
        annotation.document_level = 1
        loaded = FakeLoaded(direct_rows={"abc": [_direct_row("Symptom", 0, 3, "abc")]})
        result = evaluator._evaluate_set(_set(["Symptom"], [annotation]), loaded,
                                         FakeSchema, {}, {})
        self.assertEqual(result["goldDocumentLevelAnnotations"], 1)
        self.assertEqual(result["directSchema"]["scoredDocuments"], 1)
        self.assertEqual(result["directSchema"]["exactLabelAndOffset"]["matched"], 1)

    def test_document_only_note_is_zero_gold_when_task_has_span_annotations(self):
        annotations = [
            _annotation("abc", [evaluator.GoldSpan("Symptom", 0, 3, {})]),
            _annotation("xyz", []),
        ]
        annotations[1].document_level = 1
        loaded = FakeLoaded()
        result = evaluator._evaluate_set(_set(["Symptom"], annotations), loaded,
                                         FakeSchema, {}, {})
        self.assertEqual(result["spanScoringStatus"], "available")
        self.assertEqual(result["directSchema"]["scoredDocuments"], 2)
        self.assertEqual(result["directSchema"]["eligibleGoldSpans"], 1)

    def test_document_level_only_task_has_no_exact_span_score(self):
        annotation = _annotation("abc", [])
        annotation.document_level = 1
        result = evaluator._evaluate_set(_set(["Symptom"], [annotation]), FakeLoaded(),
                                         FakeSchema, {}, {})
        self.assertEqual(result["spanScoringStatus"], "unavailable_no_span_gold")
        self.assertEqual(result["directSchema"]["scoredDocuments"], 0)
        self.assertEqual(result["directSchema"]["excludedDocumentsByReason"],
                         {"document_level_only_task": 1})

    def test_direct_schema_preserves_all_trained_attribute_axes(self):
        loaded = FakeLoaded()
        evaluator._direct_predictions(loaded, FakeSchema, ("Symptom",), "abc")
        self.assertEqual(
            set(loaded.model.received_schema._entity_attribute_groups),
            {"assertion", "experiencer", "time frame"},
        )
        self.assertEqual(loaded.model.received_schema.declared, ("Symptom",))

    def test_attribute_gold_denominator_includes_unmatched_mentions(self):
        span = evaluator.GoldSpan(
            "Symptom", 0, 3, {"certainty": "Positive"}
        )
        result = evaluator._attribute_agreement([span], {})
        self.assertEqual(result["compatibleGold"], 1)
        self.assertEqual(result["matched"], 0)

    def test_assertion_agreement_reads_release_normalized_native_attributes(self):
        annotation = _annotation("abc", [evaluator.GoldSpan(
            "SYMP", 0, 3, {"certainty": "Positive"}
        )])
        loaded = FakeLoaded(
            direct_rows={"abc": [{
                **_direct_row("SYMP", 0, 3, "abc"),
                "assertion": {"value": "affirmed", "label": "affirmed"},
            }]},
            native_rows={"abc": [{
                **_direct_row("clinical_condition", 0, 3, "abc"),
                "attributes": {
                    "assertion": {"value": "affirmed", "label": "affirmed",
                                  "confidence": 0.9}
                },
            }]},
        )
        result = evaluator._evaluate_set(_set(["SYMP"], [annotation]), loaded,
                                         FakeSchema, {}, {})
        self.assertEqual(result["directSchema"]["certaintyToAssertionOnExactMatches"]["agree"], 1)
        self.assertEqual(result["nativeV3"]["certaintyToAssertionOnExactMatches"]["matched"], 1)
        self.assertEqual(result["nativeV3"]["certaintyToAssertionOnExactMatches"]["agree"], 1)

    def test_utf16_offsets_and_bad_offset_quarantine(self):
        schema = evaluator.SchemaInventory(
            entities=("Symptom",), relations=(), entity_attributes={},
            relation_attributes={}, source_hash="schema-hash", source_kind="test",
        )
        xml = (
            '<ROOT><TEXT>A😀B</TEXT><TAGS>'
            '<Symptom id="1" spans="3~4" text="B" certainty="Positive"/>'
            '<Symptom id="2" spans="0~1" text="wrong"/>'
            '</TAGS></ROOT>'
        )
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "note.xml"
            source.write_text(xml, encoding="utf-8")
            parsed = evaluator.parse_med_tator_xml(source, schema)
        self.assertEqual((parsed.spans[0].start, parsed.spans[0].end), (2, 3))
        self.assertEqual(parsed.invalid_offsets, 1)
        self.assertFalse(parsed.span_scoring_eligible)
        self.assertEqual(parsed.span_exclusion_reasons, ("invalid_offsets",))

    def test_yaml_schema_uses_structured_values(self):
        path = Path(__file__).resolve().parents[2] / "sample" / "OLEA_TASK" / "OLEA_TASK.yaml"
        schema = evaluator._schema_from_yaml(path)
        self.assertEqual(schema.entities, ("DataSource", "Symptom"))
        self.assertEqual(schema.entity_attributes["Symptom"]["data_type"].choice_count, 3)

    def test_usage_helper_hash_is_checked_before_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            helper = Path(directory) / "usage.py"
            helper.write_text("raise RuntimeError('must not execute')\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "hash does not match"):
                evaluator._load_usage(Path(directory))

    def test_sample_inventory_keeps_names_out_of_hash_manifest(self):
        root = Path(__file__).resolve().parents[2] / "sample"
        inventory = evaluator._input_hash_inventory(root)
        self.assertEqual(inventory["byRole"]["gold_annotation_xml"]["fileCount"], 71)
        rendered = str(inventory)
        self.assertNotIn("536553", rendered)
        self.assertEqual(len(inventory["manifestSha256"]), 64)


if __name__ == "__main__":
    unittest.main()
