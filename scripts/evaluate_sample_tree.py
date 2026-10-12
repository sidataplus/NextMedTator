"""Aggregate-only GLiNER2 v3 evaluation over the pinned MedTator sample tree.

Run one adapter per process. This reads the XML text locally, writes only
aggregate metrics, and never serializes document text, IDs, or predictions.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import yaml


FORMAT = "nextmedtator-sample-adapter-evaluation-v1"
EXPECTED_USAGE_SHA256 = "f63e63d649ea52f16c22a0573b11070c333374e5ac1be935e2d66fbc5f0a1986"
EXPECTED_THRESHOLDS = {"small": 0.7, "base": 0.6}
CERTAINTY_TO_ASSERTION = {
    "positive": "affirmed",
    "negated": "negated",
    "hypothetic": "hypothetical",
    "hypothetical": "hypothetical",
    "possible": "uncertain",
}

# This crosswalk is deliberately explicit. It supports only the broad v3
# families that can be defended from the sample labels; all other labels are
# reported as unsupported instead of being forced into a nearby category.
NATIVE_FAMILY_CROSSWALK = {
    "SYMP": "clinical_condition",
    "AE": "clinical_condition",
    "OTHER_AE": "clinical_condition",
    "OTHER_SYMP": "clinical_condition",
    "CHILL": "clinical_condition",
    "COUGH": "clinical_condition",
    "DIARRHEA": "clinical_condition",
    "DIZZINESS": "clinical_condition",
    "PAIN": "clinical_condition",
    "SORENESS": "clinical_condition",
    "Symptom": "clinical_condition",
    "Chill": "clinical_condition",
    "Cough": "clinical_condition",
    "Delirium": "clinical_condition",
    "Diarrhea": "clinical_condition",
    "Dizziness": "clinical_condition",
    "Dyspnea": "clinical_condition",
    "Fatigue": "clinical_condition",
    "FATIGUE": "clinical_condition",
    "Fever": "clinical_condition",
    "HEADACHE": "clinical_condition",
    "Headache": "clinical_condition",
    "Hypersomnia": "clinical_condition",
    "Myalgia": "clinical_condition",
    "NAUSEA": "clinical_condition",
    "Nasal_obstruction": "clinical_condition",
    "Nausea": "clinical_condition",
    "OTHER": "clinical_condition",
    "Other": "clinical_condition",
    "PAIN": "clinical_condition",
    "Pain": "clinical_condition",
    "PYREXIA": "clinical_condition",
    "SORENESS": "clinical_condition",
    "Sore_throat": "clinical_condition",
    "Vomiting": "clinical_condition",
    "VAX": "clinical_treatment",
    "Vaccine": "clinical_treatment",
    "MEDICATION": "clinical_treatment",
    "Medication": "clinical_treatment",
}


@dataclass(frozen=True)
class AttributeSpec:
    kind: str
    choice_count: int = 0


@dataclass(frozen=True)
class SchemaInventory:
    entities: tuple[str, ...]
    relations: tuple[str, ...]
    entity_attributes: dict[str, dict[str, AttributeSpec]]
    relation_attributes: dict[str, dict[str, AttributeSpec]]
    source_hash: str
    source_kind: str


@dataclass(frozen=True)
class GoldSpan:
    label: str
    start: int
    end: int
    attributes: dict[str, str]


@dataclass
class ParsedAnnotation:
    text: str
    spans: list[GoldSpan] = field(default_factory=list)
    relations: int = 0
    document_level: int = 0
    discontinuous: int = 0
    discontinuous_segments: int = 0
    invalid_offsets: int = 0
    unchecked_surfaces: int = 0
    unknown_tags: int = 0

    @property
    def span_data_quality_eligible(self) -> bool:
        return not any((self.discontinuous, self.invalid_offsets,
                        self.unchecked_surfaces, self.unknown_tags))

    @property
    def span_scoring_eligible(self) -> bool:
        unsupported_span_coverage = not self.span_data_quality_eligible
        document_only = self.document_level and not self.spans and not self.discontinuous
        return not unsupported_span_coverage and not document_only

    @property
    def native_scoring_eligible(self) -> bool:
        return self.span_scoring_eligible

    @property
    def span_exclusion_reasons(self) -> tuple[str, ...]:
        reasons = []
        if self.document_level:
            reasons.append("document_level_annotations")
        if self.discontinuous:
            reasons.append("discontinuous_spans")
        if self.invalid_offsets:
            reasons.append("invalid_offsets")
        if self.unchecked_surfaces:
            reasons.append("unchecked_surfaces")
        if self.unknown_tags:
            reasons.append("unknown_tags")
        return tuple(reasons)


@dataclass
class AnnotationSet:
    task: str
    group: str
    schema: SchemaInventory
    annotations: list[ParsedAnnotation]
    source_files: int
    parse_errors: Counter[str] = field(default_factory=Counter)
    raw_text_files: int = 0


def _enum_count(spec: str) -> AttributeSpec:
    text = spec.strip()
    if text.startswith("(") and ")" in text:
        values = text[1:text.index(")")]
        return AttributeSpec("enum", sum(bool(value.strip()) for value in values.split("|")))
    return AttributeSpec(text.split()[0] if text else "unknown")


def _schema_from_dtd(path: Path) -> SchemaInventory:
    entities: set[str] = set()
    relations: set[str] = set()
    entity_attrs: dict[str, dict[str, AttributeSpec]] = defaultdict(dict)
    relation_attrs: dict[str, dict[str, AttributeSpec]] = defaultdict(dict)
    element_re = re.compile(r"<!ELEMENT\s+([^\s]+)\s+(.+?)\s*>", re.IGNORECASE)
    attlist_re = re.compile(
        r"<!ATTLIST\s+([^\s]+)\s+([^\s]+)\s+(\([^)]*\)|[^\s>]+)", re.IGNORECASE
    )
    raw = path.read_bytes()
    for line in raw.decode("utf-8").splitlines():
        element = element_re.search(line)
        if element:
            name, content = element.groups()
            if content.strip().upper() == "EMPTY":
                relations.add(name)
            elif "#PCDATA" in content.upper():
                entities.add(name)
        attribute = attlist_re.search(line)
        if attribute:
            name, field_name, value_spec = attribute.groups()
            destination = relation_attrs if name in relations else entity_attrs
            destination[name][field_name] = _enum_count(value_spec)
    return SchemaInventory(
        tuple(sorted(entities)), tuple(sorted(relations)),
        {name: dict(fields) for name, fields in sorted(entity_attrs.items())},
        {name: dict(fields) for name, fields in sorted(relation_attrs.items())},
        hashlib.sha256(raw).hexdigest(), "dtd",
    )


def _schema_from_json(path: Path) -> SchemaInventory:
    raw = path.read_bytes()
    value = json.loads(raw)
    entities: list[str] = []
    relations: list[str] = []
    entity_attrs: dict[str, dict[str, AttributeSpec]] = {}
    relation_attrs: dict[str, dict[str, AttributeSpec]] = {}
    for row in value.get("etags", []):
        name = row["name"]
        entities.append(name)
        entity_attrs[name] = {
            attr["name"]: AttributeSpec(attr.get("vtype", "unknown"), len(attr.get("values", [])))
            for attr in row.get("attrs", [])
        }
    for row in value.get("rtags", []):
        name = row["name"]
        relations.append(name)
        relation_attrs[name] = {
            attr["name"]: AttributeSpec(attr.get("vtype", "unknown"), len(attr.get("values", [])))
            for attr in row.get("attrs", [])
        }
    return SchemaInventory(
        tuple(sorted(entities)), tuple(sorted(relations)), entity_attrs, relation_attrs,
        hashlib.sha256(raw).hexdigest(), "json",
    )


def _schema_from_yaml(path: Path) -> SchemaInventory:
    """Read a MedTator schema through a safe, structured YAML parser."""
    raw = path.read_bytes()
    value = yaml.safe_load(raw)
    if not isinstance(value, dict):
        raise ValueError("YAML schema root must be a mapping")
    entities: list[str] = []
    relations: list[str] = []
    entity_attrs: dict[str, dict[str, AttributeSpec]] = {}
    relation_attrs: dict[str, dict[str, AttributeSpec]] = {}
    for section_name, names, attrs_by_name in (
        ("etags", entities, entity_attrs), ("rtags", relations, relation_attrs)
    ):
        rows = value.get(section_name, [])
        if not isinstance(rows, list):
            raise ValueError(f"YAML {section_name} must be a list")
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("name"), str):
                raise ValueError(f"YAML {section_name} contains a malformed tag")
            name = row["name"]
            names.append(name)
            attrs = row.get("attrs", [])
            if not isinstance(attrs, list):
                raise ValueError(f"YAML attributes for {name} must be a list")
            attrs_by_name[name] = {}
            for attr in attrs:
                if not isinstance(attr, dict) or not isinstance(attr.get("name"), str):
                    raise ValueError(f"YAML attributes for {name} contain a malformed entry")
                values = attr.get("values", [])
                if not isinstance(values, list):
                    raise ValueError(f"YAML values for {name}.{attr['name']} must be a list")
                attrs_by_name[name][attr["name"]] = AttributeSpec(
                    str(attr.get("vtype", "unknown")), len(values)
                )
    return SchemaInventory(
        tuple(sorted(set(entities))), tuple(sorted(set(relations))),
        {name: dict(fields) for name, fields in sorted(entity_attrs.items())},
        {name: dict(fields) for name, fields in sorted(relation_attrs.items())},
        hashlib.sha256(raw).hexdigest(), "yaml",
    )


def load_schema(task_dir: Path) -> SchemaInventory:
    dtds = sorted(task_dir.glob("*.dtd"))
    if dtds:
        return _schema_from_dtd(dtds[0])
    json_schemas = [path for path in sorted(task_dir.glob("*.json"))
                    if path.name not in {"error_labels.json"}]
    if json_schemas:
        return _schema_from_json(json_schemas[0])
    yamls = [path for path in sorted(task_dir.glob("*.yaml"))
             if path.name not in {"error_definition.yaml"}]
    if yamls:
        return _schema_from_yaml(yamls[0])
    raise ValueError("sample task has no readable schema")


def _utf16_boundaries(text: str) -> dict[int, int]:
    boundaries = {0: 0}
    units = 0
    for index, char in enumerate(text):
        units += len(char.encode("utf-16-le")) // 2
        boundaries[units] = index + 1
    return boundaries


def parse_med_tator_xml(path: Path, schema: SchemaInventory) -> ParsedAnnotation:
    raw = path.read_bytes()
    upper = raw.upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise ValueError("DTD/entity declarations are not accepted in sample XML")
    root = ET.fromstring(raw)
    text_node = next((child for child in root if child.tag == "TEXT"), None)
    tags_node = next((child for child in root if child.tag == "TAGS"), None)
    if text_node is None or tags_node is None:
        raise ValueError("sample XML is missing TEXT or TAGS")
    source = "".join(text_node.itertext())
    result = ParsedAnnotation(text=source)
    entity_names = set(schema.entities)
    relation_names = set(schema.relations)
    boundaries = _utf16_boundaries(source)
    for tag in list(tags_node):
        name = tag.tag
        raw_spans = tag.get("spans")
        if name in relation_names or raw_spans is None and name in relation_names:
            result.relations += 1
            continue
        if name not in entity_names:
            result.unknown_tags += 1
            continue
        if raw_spans is None:
            result.invalid_offsets += 1
            continue
        if raw_spans == "-1~-1":
            result.document_level += 1
            continue
        try:
            units = [tuple(int(number) for number in part.split("~"))
                     for part in raw_spans.split(",")]
            if not units or any(len(pair) != 2 for pair in units):
                raise ValueError
            if len(units) != 1:
                result.discontinuous += 1
                result.discontinuous_segments += len(units)
                continue
            start_unit, end_unit = units[0]
            if start_unit not in boundaries or end_unit not in boundaries or start_unit >= end_unit:
                raise ValueError
            start, end = boundaries[start_unit], boundaries[end_unit]
            expected = tag.get("text")
            if expected is None:
                result.unchecked_surfaces += 1
                continue
            if source[start:end] != expected:
                result.invalid_offsets += 1
                continue
            result.spans.append(GoldSpan(
                name, start, end,
                {key: value for key, value in tag.attrib.items()
                 if key not in {"id", "spans", "text"}},
            ))
        except (TypeError, ValueError):
            result.invalid_offsets += 1
    return result


def _annotation_groups(task_dir: Path) -> list[tuple[str, list[Path]]]:
    if task_dir.name == "ERROR_ANALYSIS_TASK":
        gold_dir = task_dir / "gold_standard_corpus"
        return [("gold", sorted(gold_dir.glob("*.xml")))] if gold_dir.is_dir() else []
    ann_dir = task_dir / "ann_xml"
    if not ann_dir.is_dir():
        return []
    subgroups = sorted(path for path in ann_dir.iterdir() if path.is_dir())
    if subgroups:
        return [(path.name, sorted(path.rglob("*.xml"))) for path in subgroups]
    files = sorted(ann_dir.glob("*.xml"))
    split: dict[str, list[Path]] = defaultdict(list)
    for path in files:
        match = re.match(r"^([AB])_", path.name)
        split[match.group(1) if match else "all"].append(path)
    return [(name, rows) for name, rows in sorted(split.items())]


def load_annotation_sets(sample_root: Path) -> list[AnnotationSet]:
    sets: list[AnnotationSet] = []
    for task_dir in sorted(path for path in sample_root.iterdir() if path.is_dir()):
        try:
            schema = load_schema(task_dir)
        except Exception as error:
            sets.append(AnnotationSet(task_dir.name, "schema_error", SchemaInventory(
                (), (), {}, {}, "", "unavailable"), [], 0,
                parse_errors=Counter({type(error).__name__: 1})))
            continue
        for group, files in _annotation_groups(task_dir):
            annotations: list[ParsedAnnotation] = []
            errors: Counter[str] = Counter()
            for path in files:
                try:
                    annotations.append(parse_med_tator_xml(path, schema))
                except Exception as error:
                    errors[type(error).__name__] += 1
            raw_text_files = len(list((task_dir / "raw_txt").glob("*.txt"))) \
                if (task_dir / "raw_txt").is_dir() else 0
            sets.append(AnnotationSet(task_dir.name, group, schema, annotations,
                                      len(files), errors, raw_text_files))
    return sets


def _counter_for(spans: list[GoldSpan], label_map: Callable[[str], str | None] | None = None) -> Counter:
    counts: Counter = Counter()
    for span in spans:
        label = label_map(span.label) if label_map else span.label
        if label is not None:
            counts[(label, span.start, span.end)] += 1
    return counts


def _counter_from_predictions(rows: list[dict[str, Any]], text: str,
                              label_key: str = "entity_type") -> tuple[Counter, dict[tuple[str, int, int], list[dict[str, Any]]]]:
    counts: Counter = Counter()
    attrs: dict[tuple[str, int, int], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        label = row.get(label_key)
        start, end, surface = row.get("start"), row.get("end"), row.get("text")
        if not isinstance(label, str) or isinstance(start, bool) or isinstance(end, bool) \
                or not isinstance(start, int) or not isinstance(end, int) \
                or not isinstance(surface, str) or not 0 <= start < end <= len(text) \
                or text[start:end] != surface:
            raise ValueError("model returned invalid source offsets")
        key = (label, start, end)
        counts[key] += 1
        attrs[key].append(row)
    return counts, attrs


def _direct_predictions(loaded: Any, schema_type: type, labels: tuple[str, ...], text: str) -> tuple[Counter, dict]:
    trained_groups = getattr(loaded.schema, "_entity_attribute_groups", {})
    expected_groups = {"assertion", "experiencer", "time frame"}
    if set(trained_groups) != expected_groups:
        raise ValueError("loaded adapter does not expose the complete trained v3 axes")
    caller_schema = schema_type().entities(list(labels))
    caller_schema.entity_attributes(trained_groups)
    if caller_schema._entity_attribute_groups != trained_groups:
        raise ValueError("caller schema did not preserve trained v3 axes")
    result = loaded.model.extract(
        text, caller_schema, threshold=loaded.threshold,
        include_confidence=True, include_spans=True, overlap_policy="flat",
    )
    if not isinstance(result, dict) or not isinstance(result.get("entities"), dict):
        raise ValueError("model returned an unexpected direct-schema result")
    entities = result["entities"]
    if set(entities) != set(labels):
        raise ValueError("model result labels differ from the declared sample schema")
    rows: list[dict[str, Any]] = []
    for label, spans in entities.items():
        if not isinstance(spans, list):
            raise ValueError("model returned a malformed sample-label result")
        rows.extend({**span, "label": label} for span in spans)
    return _counter_from_predictions(rows, text, "label")


def _native_predictions(loaded: Any, text: str) -> tuple[Counter, dict]:
    result = loaded.predict(text)
    if not isinstance(result, dict) or not isinstance(result.get("spans"), list):
        raise ValueError("model returned an unexpected native-v3 result")
    return _counter_from_predictions(result["spans"], text, "entity_type")


def _scores(gold: Counter, predicted: Counter, *, labels: set[str] | None = None,
            matched: Counter | None = None) -> dict[str, Any]:
    if labels is None:
        labels = {key[0] for key in set(gold) | set(predicted)}
    if matched is None:
        matched = gold & predicted

    def summarize(g: int, p: int, m: int) -> dict[str, int | float]:
        precision = m / p if p else 0.0
        recall = m / g if g else 0.0
        return {"gold": g, "predicted": p, "matched": m,
                "precision": precision, "recall": recall,
                "f1": 2 * precision * recall / (precision + recall)
                if precision + recall else 0.0}

    def count(counter: Counter, label: str) -> int:
        return sum(value for key, value in counter.items() if key[0] == label)

    return {
        **summarize(sum(gold.values()), sum(predicted.values()), sum(matched.values())),
        "byLabel": {
            label: summarize(count(gold, label), count(predicted, label), count(matched, label))
            for label in sorted(labels)
        },
    }


def _certainty_value(span: GoldSpan) -> str | None:
    value = span.attributes.get("certainty")
    return CERTAINTY_TO_ASSERTION.get(value.lower()) if value else None


def _assertion_value(row: dict[str, Any]) -> str | None:
    value = row.get("assertion")
    if value is None:
        attributes = row.get("attributes")
        value = attributes.get("assertion") if isinstance(attributes, dict) else None
    if isinstance(value, dict):
        value = value.get("value", value.get("label"))
    return value if isinstance(value, str) else None


def _attribute_agreement(spans: list[GoldSpan], predicted_attrs: dict,
                         label_map: Callable[[str], str | None] | None = None) -> dict[str, int | float]:
    compatible_gold = matched = agreed = unsupported = 0
    # Repeated exact anchors remain a multiset; pair in source order.
    used: Counter = Counter()
    for span in spans:
        expected = _certainty_value(span)
        if "certainty" in span.attributes and expected is None:
            unsupported += 1
            continue
        if expected is None:
            continue
        label = label_map(span.label) if label_map else span.label
        if label is None:
            unsupported += 1
            continue
        key = (label, span.start, span.end)
        compatible_gold += 1
        rows = predicted_attrs.get(key, [])
        index = used[key]
        if index >= len(rows):
            continue
        used[key] += 1
        output = _assertion_value(rows[index])
        matched += 1
        agreed += output == expected
    return {"compatibleGold": compatible_gold + unsupported, "matched": matched,
            "agree": agreed, "unsupportedGold": unsupported,
            "agreementOnExactMatches": agreed / matched if matched else 0.0}


def _schema_summary(schema: SchemaInventory) -> dict[str, Any]:
    def fields(values: dict[str, dict[str, AttributeSpec]]) -> dict[str, dict[str, dict[str, Any]]]:
        return {
            tag: {name: {"kind": spec.kind, "choiceCount": spec.choice_count}
                  for name, spec in sorted(attrs.items())}
            for tag, attrs in sorted(values.items())
        }
    return {
        "sourceKind": schema.source_kind,
        "sha256": schema.source_hash,
        "entityLabels": list(schema.entities),
        "relationLabels": list(schema.relations),
        "entityAttributes": fields(schema.entity_attributes),
        "relationAttributes": fields(schema.relation_attributes),
    }


def _native_label_status(schema: SchemaInventory) -> dict[str, str]:
    status = {}
    for label in schema.entities:
        family = NATIVE_FAMILY_CROSSWALK.get(label)
        if family:
            status[label] = family
        elif label in {"DATE"}:
            status[label] = "unsupported_metadata"
        elif label in {"Severity", "SVRT"}:
            status[label] = "unsupported_attribute_span"
        elif label == "DataSource":
            status[label] = "nonclinical"
        else:
            status[label] = "unmapped"
    return status


def _sum_attribute_metrics(total: dict[str, int], row: dict[str, Any]) -> None:
    for key in ("compatibleGold", "matched", "agree", "unsupportedGold"):
        total[key] += int(row[key])


def _render_attribute_metrics(total: dict[str, int]) -> dict[str, int | float]:
    return {**total,
            "agreementOnExactMatches": total["agree"] / total["matched"]
            if total["matched"] else 0.0}


def _boundary_counter(families: Counter) -> Counter:
    result: Counter = Counter()
    for (_, start, end), count in families.items():
        result[("anchor", start, end)] += count
    return result


def _evaluate_set(annotation_set: AnnotationSet, loaded: Any, schema_type: type,
                  direct_cache: dict, native_cache: dict) -> dict[str, Any]:
    direct_gold: Counter = Counter()
    direct_predicted: Counter = Counter()
    direct_matched: Counter = Counter()
    native_gold: Counter = Counter()
    native_predicted: Counter = Counter()
    native_matched: Counter = Counter()
    native_boundary_gold: Counter = Counter()
    native_boundary_predicted: Counter = Counter()
    native_boundary_matched: Counter = Counter()
    direct_attribute_totals = Counter()
    native_attribute_totals = Counter()
    direct_failures: Counter[str] = Counter()
    native_failures: Counter[str] = Counter()
    direct_exclusions: Counter[str] = Counter()
    native_exclusions: Counter[str] = Counter()
    direct_success = native_success = 0
    direct_scored = native_scored = 0
    direct_eligible_gold = native_eligible_gold = 0
    native_unmapped_gold: Counter[str] = Counter()
    native_unmapped_gold_quarantined: Counter[str] = Counter()
    native_out_of_scope = 0
    gold_relations = gold_document_level = gold_discontinuous = 0
    gold_discontinuous_segments = gold_invalid_offsets = gold_unchecked = 0
    span_mode = any(annotation.spans and annotation.span_data_quality_eligible
                    for annotation in annotation_set.annotations)

    # Native prediction scope comes from every schema-declared label in the
    # explicit crosswalk, including labels absent from this gold annotation.
    native_families = {
        family for label in annotation_set.schema.entities
        if (family := NATIVE_FAMILY_CROSSWALK.get(label)) is not None
    }

    for annotation in annotation_set.annotations:
        gold_relations += annotation.relations
        gold_document_level += annotation.document_level
        gold_discontinuous += annotation.discontinuous
        gold_discontinuous_segments += annotation.discontinuous_segments
        gold_invalid_offsets += annotation.invalid_offsets
        gold_unchecked += annotation.unchecked_surfaces
        for span in annotation.spans:
            if span.label not in NATIVE_FAMILY_CROSSWALK:
                target = (native_unmapped_gold if span_mode and annotation.span_data_quality_eligible
                          else native_unmapped_gold_quarantined)
                target[span.label] += 1

        text_key = hashlib.sha256(annotation.text.encode("utf-8")).hexdigest()
        direct_key = (text_key, annotation_set.schema.entities)
        if direct_key not in direct_cache:
            try:
                direct_cache[direct_key] = ("ok", *_direct_predictions(
                    loaded, schema_type, annotation_set.schema.entities, annotation.text))
            except Exception as error:
                direct_cache[direct_key] = (type(error).__name__, Counter(), {})
        direct_status, direct_counts, direct_attr_rows = direct_cache[direct_key]
        if direct_status == "ok":
            direct_success += 1
        else:
            direct_failures[direct_status] += 1

        if text_key not in native_cache:
            try:
                native_cache[text_key] = ("ok", *_native_predictions(loaded, annotation.text))
            except Exception as error:
                native_cache[text_key] = (type(error).__name__, Counter(), {})
        native_status, native_counts, native_attr_rows = native_cache[text_key]
        if native_status == "ok":
            native_success += 1
        else:
            native_failures[native_status] += 1

        if not annotation.span_data_quality_eligible:
            direct_exclusions.update(annotation.span_exclusion_reasons)
            native_exclusions.update(annotation.span_exclusion_reasons)
            continue
        if not span_mode:
            reason = "document_level_only_task" if annotation.document_level else "no_span_gold_in_set"
            direct_exclusions[reason] += 1
            native_exclusions[reason] += 1
            continue

        # Failed inference is scored as an empty prediction, preserving every
        # eligible gold mention as a false negative in the recall denominator.
        direct_scored += 1
        direct_gold_doc = _counter_for(annotation.spans)
        direct_pred_doc = direct_counts if direct_status == "ok" else Counter()
        direct_eligible_gold += sum(direct_gold_doc.values())
        direct_gold.update(direct_gold_doc)
        direct_predicted.update(direct_pred_doc)
        direct_matched.update(direct_gold_doc & direct_pred_doc)
        _sum_attribute_metrics(direct_attribute_totals, _attribute_agreement(
            annotation.spans, direct_attr_rows if direct_status == "ok" else {}))

        native_scored += 1
        mapping = NATIVE_FAMILY_CROSSWALK.get
        native_gold_doc = _counter_for(annotation.spans, mapping)
        # Keep the prediction scope schema-derived, not gold-derived.
        native_pred_doc = Counter({key: count for key, count in native_counts.items()
                                   if key[0] in native_families}) \
            if native_status == "ok" else Counter()
        native_out_of_scope += sum(count for key, count in native_counts.items()
                                   if key[0] not in native_families) \
            if native_status == "ok" else 0
        native_boundary_gold_doc = _boundary_counter(native_gold_doc)
        native_boundary_pred_doc = _boundary_counter(native_pred_doc)
        native_eligible_gold += sum(native_gold_doc.values())
        native_gold.update(native_gold_doc)
        native_predicted.update(native_pred_doc)
        native_matched.update(native_gold_doc & native_pred_doc)
        native_boundary_gold.update(native_boundary_gold_doc)
        native_boundary_predicted.update(native_boundary_pred_doc)
        native_boundary_matched.update(native_boundary_gold_doc & native_boundary_pred_doc)
        _sum_attribute_metrics(native_attribute_totals, _attribute_agreement(
            annotation.spans, native_attr_rows if native_status == "ok" else {}, mapping))

    direct_report = {
        "attemptedDocuments": len(annotation_set.annotations),
        "successfulDocuments": direct_success,
        "scoredDocuments": direct_scored,
        "excludedDocumentsByReason": dict(sorted(direct_exclusions.items())),
        "eligibleGoldSpans": direct_eligible_gold,
        "exactLabelAndOffset": _scores(direct_gold, direct_predicted,
                                       labels=set(annotation_set.schema.entities),
                                       matched=direct_matched),
        "certaintyToAssertionOnExactMatches": _render_attribute_metrics(direct_attribute_totals),
        "failureTypes": dict(sorted(direct_failures.items())),
    }
    native_report = {
        "attemptedDocuments": len(annotation_set.annotations),
        "successfulDocuments": native_success,
        "scoredDocuments": native_scored,
        "excludedDocumentsByReason": dict(sorted(native_exclusions.items())),
        "eligibleGoldSpans": native_eligible_gold,
        "unmappedGoldSpansByLabel": dict(sorted(native_unmapped_gold.items())),
        "unmappedGoldSpansInQuarantinedDocumentsByLabel": dict(
            sorted(native_unmapped_gold_quarantined.items())
        ),
        "exactFamilyAndOffset": _scores(native_gold, native_predicted, labels=native_families,
                                         matched=native_matched),
        "exactOffsetIgnoringFamily": _scores(
            native_boundary_gold, native_boundary_predicted, labels={"anchor"},
            matched=native_boundary_matched),
        "certaintyToAssertionOnExactMatches": _render_attribute_metrics(native_attribute_totals),
        "predictionsOutsideMappedFamilies": native_out_of_scope,
        "failureTypes": dict(sorted(native_failures.items())),
    }
    return {
        "annotationGroup": annotation_set.group,
        "annotationFiles": annotation_set.source_files,
        "unreadAnnotationFiles": max(0, annotation_set.source_files - len(annotation_set.annotations)),
        "rawTextFilesAvailable": annotation_set.raw_text_files,
        "spanScoringStatus": "available" if span_mode else "unavailable_no_span_gold",
        "documentsRead": len(annotation_set.annotations),
        "uniqueEmbeddedTexts": len({hashlib.sha256(a.text.encode("utf-8")).digest()
                                     for a in annotation_set.annotations}),
        "annotationParseFailures": dict(sorted(annotation_set.parse_errors.items())),
        "goldEntitySpans": sum(len(a.spans) for a in annotation_set.annotations),
        "goldSpanAnnotations": sum(
            len(a.spans) + a.discontinuous + a.invalid_offsets + a.unchecked_surfaces
            for a in annotation_set.annotations),
        "goldRelationAnnotations": gold_relations,
        "goldDocumentLevelAnnotations": gold_document_level,
        "goldDiscontinuousAnnotations": gold_discontinuous,
        "goldDiscontinuousSegmentsUnscored": gold_discontinuous_segments,
        "goldInvalidOffsets": gold_invalid_offsets,
        "goldUncheckedSurfaces": gold_unchecked,
        "directSchema": direct_report,
        "nativeV3": native_report,
    }


def _load_usage(package_dir: Path) -> Any:
    usage_path = package_dir / "usage.py"
    actual_hash = hashlib.sha256(usage_path.read_bytes()).hexdigest()
    if actual_hash != EXPECTED_USAGE_SHA256:
        raise ValueError("adapter usage.py hash does not match the reviewed helper")
    spec = importlib.util.spec_from_file_location("clinical_evidence_v3_usage", usage_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load the selected adapter helper")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _input_hash_inventory(sample_root: Path) -> dict[str, Any]:
    schema_files: set[Path] = set()
    annotation_files: set[Path] = set()
    raw_text_files: set[Path] = set()
    for task_dir in sorted(path for path in sample_root.iterdir() if path.is_dir()):
        try:
            selected = load_schema(task_dir)
            schema_files.update(
                path for path in task_dir.iterdir()
                if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == selected.source_hash
            )
        except Exception:
            pass
        for _group, files in _annotation_groups(task_dir):
            annotation_files.update(files)
        raw_dir = task_dir / "raw_txt"
        if raw_dir.is_dir():
            raw_text_files.update(path for path in raw_dir.rglob("*") if path.is_file())

    roles = {
        "readme": [sample_root / "README.md"],
        "schemas": sorted(schema_files),
        "gold_annotation_xml": sorted(annotation_files),
        "raw_text_inventory": sorted(raw_text_files),
    }
    result: dict[str, Any] = {}
    for role, paths in roles.items():
        result[role] = {
            "fileCount": len(paths),
            "sha256": sorted(hashlib.sha256(path.read_bytes()).hexdigest() for path in paths),
        }
    manifest = "\n".join(
        f"{role}:{digest}"
        for role in sorted(result)
        for digest in result[role]["sha256"]
    ).encode("ascii")
    return {"byRole": result, "manifestSha256": hashlib.sha256(manifest).hexdigest()}


def evaluate(sample_root: Path, model_name: str, package_dir: Path,
             adapter_dir: Path, base_dir: Path, sample_revision: str,
             device: str = "cpu") -> dict[str, Any]:
    if not re.fullmatch(r"[0-9a-f]{40}", sample_revision):
        raise ValueError("--sample-revision must be the full 40-character Git commit SHA")
    if model_name not in EXPECTED_THRESHOLDS:
        raise ValueError("unknown adapter threshold policy")
    sample_root = sample_root.resolve()
    package_dir = package_dir.resolve()
    usage = _load_usage(package_dir)
    loaded = usage.load_model(model_name, package_dir=package_dir,
                              adapter_dir=adapter_dir, base_dir=base_dir, device=device)
    if float(loaded.threshold) != EXPECTED_THRESHOLDS[model_name]:
        raise ValueError("loaded adapter threshold differs from the frozen evaluation policy")
    schema_type = type(loaded.schema)
    sets = load_annotation_sets(sample_root)
    direct_cache: dict = {}
    native_cache: dict = {}
    tasks: dict[str, Any] = {}
    for annotation_set in sets:
        task = tasks.setdefault(annotation_set.task, {
            "schema": _schema_summary(annotation_set.schema),
            "nativeCrosswalkStatus": _native_label_status(annotation_set.schema),
            "annotationSets": [],
        })
        task["annotationSets"].append(_evaluate_set(
            annotation_set, loaded, schema_type, direct_cache, native_cache))
    return {
        "format": FORMAT,
        "source": {"repository": "sidataplus/NextMedTator",
                   "revision": sample_revision,
                   "sampleReadmeSha256": hashlib.sha256((sample_root / "README.md").read_bytes()).hexdigest(),
                   "inputFileHashes": _input_hash_inventory(sample_root),
                   "readmeCorpusClaim": "sample texts are extracted from VAERS data sets"},
        "aggregationOnly": True,
        "rowLevelPredictionsWritten": False,
        "model": {
            "name": loaded.model_name,
            "threshold": loaded.threshold,
            "usageHelperSha256": EXPECTED_USAGE_SHA256,
            "adapterFingerprint": loaded.adapter_fingerprint,
            "baseModel": loaded.base_model_id,
            "baseRevision": loaded.base_revision,
            "baseTrainingFingerprint": loaded.base_training_fingerprint,
            "baseRuntimeAssetFingerprint": loaded.base_runtime_asset_fingerprint,
            "registryHash": loaded.registry_hash,
            "runtimeVersions": loaded.runtime_versions,
            "nativeAttributeGroups": {
                name: {"choiceCount": len(group.labels), "threshold": group.threshold,
                       "multiLabel": group.multi_label}
                for name, group in sorted(loaded.schema._entity_attribute_groups.items())
            },
        },
        "tasks": tasks,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample-root", type=Path,
                        default=Path(__file__).resolve().parents[1] / "sample")
    parser.add_argument("--model", choices=("base", "small"), required=True)
    parser.add_argument("--package-dir", type=Path, required=True)
    parser.add_argument("--adapter-dir", type=Path, required=True)
    parser.add_argument("--base-dir", type=Path, required=True)
    parser.add_argument("--sample-revision", required=True,
                        help="full pinned Git SHA for the NextMedTator sample checkout")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--output", type=Path,
                        help="optional aggregate JSON path; no text or row predictions are written")
    args = parser.parse_args()
    report = evaluate(args.sample_root, args.model, args.package_dir,
                      args.adapter_dir, args.base_dir, args.sample_revision, args.device)
    rendered = json.dumps(report, ensure_ascii=True, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
