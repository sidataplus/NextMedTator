# Implementation and qualification status

Validated on 2026-10-03 against checked-in PRD v1.0. This is a baseline engineering preview; the full public/clinical release is not yet qualified.

## Implemented in this parity follow-up

The requested small ONNX export is pinned to `nicolasembleton/gliner2.5-small-v1-onnx@5e2e3f51adfb0eeb7c1f83464400b4d498d41659`. Its four graphs and tokenizer are consumed locally with ORT Web 1.23.2, single-thread fp32 WASM. The app owns the compiler/decoder; packages cannot install code. Live analysis requires the selected package's public fixtures to pass. Weights are downloaded separately and are not committed or bundled as static assets.

- Separate public-model IndexedDB installation with per-file hashes, read-back verification, cancellable allowlisted download, installed-version selection/deletion and rollback. Optional clinical recovery remains a separate store.
- Exact anchors, schema enums and anchored text/span field binding with supporting evidence. Unsupported field types/schema budgets fail explicitly. Unknown fields stay unknown. Window accounting includes record prompts and terminal punctuation.
- Durable legacy evidence projects containing loaded-schema identities, manual annotations, binary relations, document labels, prediction histories, blind snapshots, exposure and review decisions. Explicit native export/open synchronizes the current working copy.
- Compact undo receipts and successive undo; anchor/evidence editing, split/merge, explicit linked-set suggestion acceptance, manual relation editing and linked adjudication candidate copying.
- Worker comparison; supporting-evidence/complete-record metrics and relation metrics conditional on declared coverage; explicit reference and matching protocol; portable comparison reports, CSV, unresolved adjudication and reason codes.
- Explicit schema-migration preview with losses and prior project/schema retained; stale previews cannot silently overwrite newer work.
- Group/split JSONL mappings, frozen assignment order, training exclusions and evaluation exports retaining source/schema/model/exposure identities.
- Quota/storage/CAS failures preserve the prior recovery copy and truthful save state. Public-model installation aborts atomically on synchronous storage failures.
- Adjustable idle cutoff, manual timing pause, per-document/annotator grouping, visibility handling and separate operation/inference waiting time; local export only, no keystroke log.
- Keyboard focus restoration and dialog wrapping, existing source text sizing, explicit status/provenance labels. Disabled inherited clinical network-analysis helpers.
- Eight original synthetic examples, including uncertainty, missing evidence and a long note. Authored suggestions remain labeled as authored.

## Executed evidence

See `QUALIFICATION.md` for commands, immutable model/source identities and numerical policies. Generated raw reports live in ignored `test-results/` and CI artifacts.

**89 unit tests passed with no skips**, including the independent real-tokenizer check. Both static builds, asset audit, five real-origin review workflows, legacy workflow/real synthetic-WASM worker tests, four recovery faults, installed-model rollback/XML-relations/performance tests and four DOM-only checks passed. The actual downloaded model passed browser conformance against native CPU outputs for the encoder and all three exported heads, plus exact source tokenizer/NER and anchored record fixtures. Real-weight install, network-blocked restart, inference, review, comparison, native export/reimport and canary checks passed in Chromium 151 on Linux. The real-weight original-screen acceptance/provenance-export test also passed. Official source contextual-attribute outputs match; they contain baseline clinical errors and are not reference truth.

A 1,000-document browser probe measured 101–165 ms p95 synchronous switching over 30 samples. Native CPU load/inference and browser reports describe this cloud environment; they do not qualify target laptops or establish whole-process peak memory. Dependency pins were registry-verified and the high-severity audit passed. Two inherited Vue 2 advisories remain documented in `DEPENDENCIES.md`.

## Acceptance matrix

| PRD IDs | Evidence and scope |
|---|---|
| AC-01, 04, 13 | Familiar legacy smoke/worker review, exact Unicode/XML tests and binary-relation round trip. Broader clinician workflow review remains required. |
| AC-02 | Real downloaded small package: install, disconnect, restart, infer, review, native export/reimport. Existing real-origin suite also compares offline layers. |
| AC-03, 18 | Canary requests stay local; injection, XXE, archive/member corruption and bounds tests pass. No complete inherited-asset security approval is claimed. |
| AC-05 | Source/native/browser NER and record outputs, contextual labels and numerical exported-head checks pass in WASM. Automatic relation qualification is withheld; see discrepancy below. |
| AC-06 | Distinct baseline/adapter/head identities, install/run/compare contracts pass. The actual fine-tuned LoRA is pending from the user. |
| AC-07–11, 15 | Five-family record contracts, immutable layers, exposure, linked review/adjudication, completeness and failure coverage tests pass. Zero-shot outputs are not guaranteed to fill or correctly interpret every clinical field. |
| AC-12 | Real Web Lock conflict, stale CAS, synchronous quota fault and denied storage pass; old checkpoint remains available. |
| AC-14 | Original synthetic corpus and walkthrough; public patient/case corpora are not redistributed. |
| AC-16 | Worker timeout/cancellation/retry contracts and Linux performance probe pass. Target-device envelopes and peak-memory approval remain external gates. |
| AC-17 | Native/evaluation/training exports preserve grouping, splits, coverage and immutable identities. |
| AC-19 | Keyboard/focus/status/text-size paths exercised in Chromium. Assistive-technology and clinician usability qualification remain required. |
| AC-20 | Locked builds, hash inventory, notices and model-storage rollback tested. Cloudflare/R2 account/domain rollout and deployed-release rollback require operator infrastructure. |

## Withheld capabilities and external dependencies

The official-source relation fixture returns `Tim Cook → leads → Apple`. After correcting role-query routing, the ONNX host returns the same edge, but confidence is about 0.631821 versus source 0.627179: absolute difference 0.004642, above the 1e-4 numerical budget. **Automatic small-model relations are disabled and a package cannot enable them in this app release.** Manual/imported relations, review and coverage-aware metrics work. Random-input native/browser relation-head parity does not resolve this source-pipeline discrepancy. Independent source-scorer diagnosis now isolates a defect in the published graph: its distance normalization divides by a traced constant `48`, whereas source inference divides by the actual word count. At 48 words, the identical-input native/source head error is 1.49e-7; at 6, 16 and 96 words it exceeds the fixed 1e-4 tolerance. A corrected, separately versioned producer export and reviewed source fixtures are required; the app does not patch public model graphs.

Anchorless inference, cross-window relations and WebGPU are not qualified for this package. The baseline measurement example leaves value/unit empty when the source model does; the app does not invent missing fields. The final Clinical-Evidence ontology and LoRA-derived package require external producer fixtures. Actual held-out model comparisons, clinical pilot outcomes, M3 Mac/ordinary Windows hardware, assistive-technology review, comprehensive inherited-library security approval, and public Cloudflare/R2 operations remain release gates. CaseDistiller SQL feedback/execution stays a later, external integration as specified by the PRD.
