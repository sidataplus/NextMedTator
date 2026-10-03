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

The existing 790 MB mixv1 package was used unchanged. All 17 package conformance
fixtures pass in Chromium 151 with ORT Web 1.23.2 WASM. All 27 notes complete
offline with full source coverage and valid code-point offsets, each in one
window. The portable corpus exports and reopens with identical source texts
and all 27 machine runs; adapter identity is retained. Requests are local
GETs with no note bodies. Cloud median inference time is 4.80 seconds per
note, maximum 7.07 seconds; this is not target-device qualification.

The original MedTator UI also loads all 27 notes. A representative note passes
real inference, CodeMirror span location, acceptance into a native tag and
evidence export with its original text and adapter lineage. See the
[screenshot](qualification/mixv1-generated-notes-ui.png) and
[full report](qualification/mixv1-generated-notes.json).

## Generated-reference agreement

The declared schema uses the six supplied family names unchanged. It evaluates
occurrence anchors, assertion, time frame and experiencer, plus condition
`time_text` evidence. Anchor matching requires an exact family and half-open
code-point range, with multiset matching for duplicates. Threshold remains
0.5; no tuning was performed on these notes.

| Measure | Result |
|---|---:|
| Predicted occurrences | 326 |
| Exact matched reference anchors | 224 / 618 |
| Micro precision agreement | 68.7% |
| Micro recall agreement | 36.2% |
| Micro F1 agreement | 47.5% |
| Assertion agreement on matched, labeled anchors | 40 / 223 (17.9%) |
| Experiencer agreement on matched, labeled anchors | 17 / 87 (19.5%) |
| Time-frame agreement on matched, labeled anchors | 43 / 85 (50.6%) |
| Exact condition time evidence on matched, labeled anchors | 2 / 26 |

Unlabeled attributes are not assumed negative. Per-family and per-note results
are retained in the report. These results describe the current app schema,
prompt and decoder, not an isolated assessment of the adapter or every official
GLiNER record-decoding policy. Runtime success does not establish suitable
clinical predictions: contextual fields in particular need further review.
No baseline-versus-adapter improvement is claimed.

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
NMT_LORA_PACKAGE=/path/to/mixv1.nmt-model.zip uv run --locked python tests/browser/test_lora_samples.py
NMT_LORA_PACKAGE=/path/to/mixv1.nmt-model.zip uv run --locked python tests/browser/test_lora_samples_legacy.py
```

The real-weight gates require the package and never silently skip or substitute
mock predictions. CI runs four bounded source-offset/agreement tests. Reports,
predictions and portable exports are generated under ignored `test-results/`;
the checked-in report and screenshot capture this Cloud run. The fixture can
be regenerated from the original upload with:

```sh
uv run --locked python scripts/prepare_validation_notes.py generated_p40_gemini-3_1-pro-high.jsonl --out tests/fixtures/lora-clinical-samples.json
```
