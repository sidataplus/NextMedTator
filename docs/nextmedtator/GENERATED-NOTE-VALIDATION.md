# Generated-note validation

The user-supplied `generated_p40_gemini-3_1-pro-high.jsonl` is now a reproducible
validation corpus in [lora-clinical-samples.json](../../tests/fixtures/lora-clinical-samples.json).
Its original SHA-256 is
`8c825be914305eb89c2adb30d9c063769d228f9478b5febfc0ab39a7c7434dea`.
The fixture preserves all 27 nursing notes, 618 occurrence anchors, all choice
labels and 507 literal spans. Context strings disambiguate repeated mentions;
every reference span resolves uniquely without a nearest-occurrence fallback.
Generation conversation IDs, token usage and seed descriptions are omitted.

These are Gemini-generated references. Their completeness, correctness and
overlap with adapter training data are unverified. They are not a clinical gold
standard or an independent held-out test set. Instructions within note text
are data and never control the validation program.

## Actual model/browser checks

The current 790 MB package uses
`na399/gliner2.5-clinical-evidence-lora-p4@43e8dbd6d9b240498b891c74202d3e869d317c26`.
It replaces mixv1 under the same validation protocol. All 17 package conformance
fixtures pass in Chromium 151 with ORT Web 1.23.2 WASM. All 27 notes complete
offline with full source coverage and valid code-point offsets, each in one
window. The portable corpus exports and reopens with identical source texts
and all 27 machine runs; adapter identity is retained. Requests are local
GETs with no note bodies. Cloud median inference time is 4.90 seconds per
note, maximum 7.30 seconds; this is not target-device qualification.

The original MedTator UI now runs all 27 notes through **Analyze selected**.
All runs complete with full source coverage, valid offsets and the pinned
adapter lineage. They produce 494 predictions, including 380 exact generated
reference matches. A compact suggestion list shows every prediction while
the header separately counts machine suggestions and annotation tags. Detailed
cards and explicit review/write controls remain available. Counts and lists
remain hidden on protected blind notes.

The [original-UI corpus report](qualification/clinical-p4-original-corpus-ui.json)
records every note's results and the screenshot selection. Legacy `time_text`
CDATA stores text; its exact retained model evidence span is used only for
temporal agreement scoring. No model output is rewritten or located by guessing.

## Representative machine suggestion screenshots

These captures show complete, unreviewed machine lists in the original UI.
Their annotation tables are empty because no predictions were auto-accepted.
The browser viewport was resized until every list row was visible. We selected
the reported pain-miss note, the lowest-agreement note, a successful negated-pain
anchor and the note with the most predictions; this includes weak results.

| Note | Selection | Machine suggestions | Exact matches / generated references | Anchor F1 agreement | Screenshot |
|---|---|---:|---:|---:|---|
| syn7_00007 | Reported "Denies pain" miss | 17 | 15 / 25 | 71.4% | [View](qualification/clinical-p4-syn7_00007-suggestions.png) |
| syn7_00002 | Lowest anchor agreement | 17 | 10 / 26 | 46.5% | [View](qualification/clinical-p4-syn7_00002-suggestions.png) |
| syn7_00023 | Negated pain anchor and assertion detected | 20 | 15 / 25 | 66.7% | [View](qualification/clinical-p4-syn7_00023-suggestions.png) |
| syn7_00014 | Most machine suggestions | 26 | 19 / 26 | 73.1% | [View](qualification/clinical-p4-syn7_00014-suggestions.png) |

**"Denies pain" is a real pipeline miss at threshold 0.5.** Of seven supplied
negated-pain reference spans, only one has an exact predicted anchor and the
negated assertion. Six are omitted, including the reported note. The same note
also omits "resisting morning care". These screenshots demonstrate inference
and its errors, and do not establish complete behavioral or negation recall.
The negated-pain example's other attributes remain unreviewed and can be wrong.

The earlier [four-tag acceptance screenshot](qualification/clinical-p4-generated-notes-ui.png)
exercises writing pacing, verbal aggression, yelling and striking out into
native annotations, correcting experiencer to patient, and exporting all four.
It shows accepted tags rather than the full prediction list. That workflow
remains recorded in the [generated-note report](qualification/clinical-p4-generated-notes.json).
Behavioral events use `event_occurrence` in the supplied six-family schema;
there is no dedicated BPSD tag type.

Both adapters were rerun after PR review found a lost word mask in attribute
scoring. The encoder mask now reaches the attribute head, and padded word
states remain masked. The tables and JSON reports below use these corrected
runs; package weights, schema and threshold remain the same. All 120 app,
10 packager and four generated-note unit tests pass.

## Generated-reference agreement

The declared schema uses the six supplied family names unchanged. It evaluates
occurrence anchors, assertion, time frame and experiencer, plus condition
`time_text` evidence. Anchor matching requires an exact family and half-open
code-point range, with multiset matching for duplicates. Threshold remains
0.5; no tuning was performed on these notes.

| Measure | mixv1 | ClinicalEvidence P4 |
|---|---:|---:|
| Predicted occurrences | 326 | 494 |
| Exact matched reference anchors | 224 / 618 | 380 / 618 |
| Micro precision agreement | 68.7% | 76.9% |
| Micro recall agreement | 36.2% | 61.5% |
| Micro F1 agreement | 47.5% | 68.3% |
| Assertion on matched, labeled anchors | 41 / 223 (18.4%) | 288 / 379 (76.0%) |
| Experiencer on matched, labeled anchors | 17 / 87 (19.5%) | 74 / 146 (50.7%) |
| Time frame on matched, labeled anchors | 44 / 85 (51.8%) | 95 / 134 (70.9%) |
| Exact condition time evidence on matched, labeled anchors | 2 / 26 | 11 / 41 |

Anchor F1 increases by **20.9 percentage points**. The context rows above use
each adapter's own matched anchors, so their denominators differ. To control
for that selection, we also score the 204 exact anchors matched by both:

| Common-anchor attribute | Labeled common anchors | mixv1 | ClinicalEvidence P4 |
|---|---:|---:|---:|
| Assertion | 203 | 19.7% | 74.9% |
| Experiencer | 78 | 17.9% | 50.0% |
| Time frame | 75 | 50.7% | 65.3% |

The [comparison report](qualification/adapter-comparison.json) retains full
counts, per-family/per-note results, source hashes and both adapter identities.
The [mixv1 baseline report](qualification/mixv1-generated-notes.json) also
includes the corrected-mask rerun. Experiencer and exact time evidence remain
weak despite improvement.

Unlabeled attributes are not assumed negative. Per-family and per-note results
are retained in the report. These results describe the current app schema,
prompt and decoder, not an isolated assessment of the adapter or every official
GLiNER record-decoding policy. The Phase 4 card describes a separate
ClinicalEvidence `per_anchor`/`hybrid` decoder; this gate retains the existing
app decoder for a controlled comparison. Runtime success does not establish
clinical readiness. No improvement over an unadapted base model is claimed.

Other supplied fields remain in the fixture but are outside this run's scope.
The combined `status` field has 17 choices; the current attribute head permits
eight. The browser gate asserts an explicit rejection rather than truncating
the values. Automatic relations and source-exclusive global record assignment
retain their existing limitations.

## Reproduction

Build the original app and engineering preview, and export the supplied adapter
using [the standalone packager](../../tools/gliner-onnx/README.md). Then run:

```sh
uv run --locked python -m unittest discover -s tests/validation
NMT_LORA_PACKAGE=/path/to/clinical-p4.nmt-model.zip uv run --locked python tests/browser/test_lora_samples.py
NMT_LORA_PACKAGE=/path/to/clinical-p4.nmt-model.zip uv run --locked python tests/browser/test_lora_samples_legacy.py
NMT_LORA_PACKAGE=/path/to/clinical-p4.nmt-model.zip uv run --locked python tests/browser/test_lora_corpus_ui.py
```

The real-weight gates require the package and never silently skip or substitute
mock predictions. CI runs four bounded source-offset/agreement tests. Reports,
predictions and portable exports are generated under ignored `test-results/`;
the checked-in report and screenshot capture this Cloud run. The fixture can
be regenerated from the original upload with:

```sh
uv run --locked python scripts/prepare_validation_notes.py generated_p40_gemini-3_1-pro-high.jsonl --out tests/fixtures/lora-clinical-samples.json
```
