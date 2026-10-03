# Implementation and qualification status

Validated on 2026-10-03 against checked-in PRD v1.0. This is a baseline engineering preview; the full public/clinical release is not yet qualified.

## Supplied LoRA follow-up

The supplied mixv1 PEFT adapter now has a reproducible export through the separate [locked Python packager](../../tools/gliner-onnx/README.md). Its metadata pins `fastino/gliner2.5-base-v1@ca906247640776a07753514055be9726f9080ead`; all 144 adapter tensors were loaded exactly. Active-adapter versus merged encoder output differs by at most 7.3e-6. The approximately 790 MB package passes six synthetic English source occurrence cases and numerical checks for the main, attribute, record and relation graphs. Actual ORT Web WASM conformance, offline installation/restart/inference, review, comparison, portable export/reopen, lineage and native Vue/CodeMirror annotation are exercised by `tests/browser/test_lora_model.py`. User weights are not committed or published. Technical conformance does not establish clinical accuracy; source-exclusive record assignment and automatic relations remain outside this app codec.

## Generated-note validation

The [generated-note follow-up](GENERATED-NOTE-VALIDATION.md) validates all 27
supplied notes offline and in portable exports, and exercises a representative
note in the original UI. Exact-anchor agreement with the 618 generated labels
is 47.5% micro F1; assertion/experiencer agreement is low. These unverified
references do not qualify clinical accuracy. The full 17-choice status union
is explicitly rejected by the current eight-choice attribute head.

## WASM architecture follow-up

The requested browser-local backend is implemented while retaining the original Vue 2/CodeMirror annotation UI. Rust-WASM workers provide bulk schema/record/source-span validation, Unicode offsets/literal search and compatible snapshot comparison. Official SQLite-WASM in OPFS supplies atomic, hash-verified recovery, bound queries and selected-project SQLite exports. The original assistance panel adds opt-in multi-document recovery and debounced Vue-edit autosave. Native child-project model/snapshot/exposure identities are retained. Legacy IndexedDB recovery migration is explicit, hash-preserving and keeps the old copy; subsequent writes use SQLite only. See [WASM-BACKEND.md](WASM-BACKEND.md).

**110 unit tests passed with no skips** on the WASM branch, including the actual downloaded tokenizer, instantiated Rust/SQLite WASM, 160 varied comparison graphs/policies, actual `SQLITE_FULL`, atomic rollback, worker cancellation and source isolation. Both static inventories pass (5,072 original-UI assets; 55 engineering-preview assets). Actual Chromium OPFS reload, simultaneous storage-worker CAS, selected-project SQLite export/integrity, legacy migration, network-blocked core/storage reads and writes, original-screen autosave and corpus restart gates pass. The seven review workflows, original-UI worker/sanitizer/charts, installed-package rollback/XML/timing/performance and four DOM gates pass. Actual ONNX offline and original-screen model regression gates pass. Registry pin verification, frozen pnpm installation and the high-severity audit pass; the documented Vue advisories remain.

The latest cloud-only 1,000-document switch probe measured 29.67 ms p95 over 30 samples. Different runs are not a controlled JavaScript-versus-WASM benchmark, and no general speedup or target-laptop claim is made. Shared validation and transactional recovery are the implemented gains. Mac/Windows browser, assistive-technology, clinical pilot and public-release gates remain unchanged.

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

**95 unit tests passed with no skips**, including the independent real-tokenizer check. Both static builds, asset audit, seven real-origin review workflows, legacy workflow/real synthetic-WASM worker tests, four recovery faults, installed-model rollback/XML-relations/performance tests and four DOM-only checks passed. The actual downloaded model passed browser conformance against native CPU outputs for the encoder and all three exported heads, plus exact source tokenizer/NER and anchored record fixtures. Real-weight install, network-blocked restart, inference, review, comparison, native export/reimport and canary checks passed in Chromium 151 on Linux. The real-weight original-screen acceptance/provenance-export test also passed. Official source contextual-attribute outputs match; they contain baseline clinical errors and are not reference truth.

A 1,000-document browser probe measured 101–165 ms p95 synchronous switching over 30 samples. Native CPU load/inference and browser reports describe this cloud environment; they do not qualify target laptops or establish whole-process peak memory. Dependency pins were registry-verified and the high-severity audit passed. Two inherited Vue 2 advisories remain documented in `DEPENDENCIES.md`.

## PR review follow-up

All six review findings have regression coverage: document-wide flat window reconciliation; ordered, deduplicated supporting-evidence coverage; relation disagreements gated on declared coverage; atomic linked-occurrence merge and undo; incompatible schema-migration edges reported as losses; and refreshed adjudication candidates whose origins match the selected parents. The real-model workflows and both static builds passed after these changes.

PR #5's two review findings are covered: SQLite failure no longer hides readable legacy IndexedDB copies, and undefined/non-finite request values are rejected before Rust transport. Real Chromium tests remove cross-origin isolation or deny the SQLite WASM asset and still list, restore, export and reopen the legacy checkpoint without changing its hash or enabling recovery. Independent listing failures retain the available store, and dual failure reports an error. The compiled core and browser validateProject reject lossy JSON values while accepting explicit nulls.

## Acceptance matrix

| PRD IDs | Evidence and scope |
|---|---|
| AC-01, 04, 13 | Familiar legacy smoke/worker review, exact Unicode/XML tests and binary-relation round trip. Broader clinician workflow review remains required. |
| AC-02 | Real downloaded small package: install, disconnect, restart, infer, review, native export/reimport. Existing real-origin suite also compares offline layers. |
| AC-03, 18 | Canary requests stay local; injection, XXE, archive/member corruption and bounds tests pass. No complete inherited-asset security approval is claimed. |
| AC-05 | Source/native/browser NER and record outputs, contextual labels and numerical exported-head checks pass in WASM. Automatic relation qualification is withheld; see discrepancy below. |
| AC-06 | Distinct baseline/adapter/head identities, install/run/compare contracts pass. The actual fine-tuned LoRA is pending from the user. |
| AC-07–11, 15 | Five-family record contracts, immutable layers, exposure, linked review/adjudication, completeness and failure coverage tests pass. Zero-shot outputs are not guaranteed to fill or correctly interpret every clinical field. |
| AC-12 | Actual SQLite-WASM/OPFS reload, concurrent-worker CAS, tab lock, `SQLITE_FULL`, transaction rollback, cancellation, unavailable storage, original-UI autosave and hash-preserving migration pass. |
| AC-14 | Original synthetic corpus and walkthrough; public patient/case corpora are not redistributed. |
| AC-16 | Worker timeout/cancellation/retry contracts and Linux performance probe pass. Target-device envelopes and peak-memory approval remain external gates. |
| AC-17 | Native/evaluation/training exports preserve grouping, splits, coverage and immutable identities. |
| AC-19 | Keyboard/focus/status/text-size paths exercised in Chromium. Assistive-technology and clinician usability qualification remain required. |
| AC-20 | Locked builds, hash inventory, notices and model-storage rollback tested. Cloudflare/R2 account/domain rollout and deployed-release rollback require operator infrastructure. |

## Withheld capabilities and external dependencies

The official-source relation fixture returns `Tim Cook → leads → Apple`. After correcting role-query routing, the ONNX host returns the same edge, but confidence is about 0.631821 versus source 0.627179: absolute difference 0.004642, above the 1e-4 numerical budget. **Automatic small-model relations are disabled and a package cannot enable them in this app release.** Manual/imported relations, review and coverage-aware metrics work. Random-input native/browser relation-head parity does not resolve this source-pipeline discrepancy. Independent source-scorer diagnosis now isolates a defect in the published graph: its distance normalization divides by a traced constant `48`, whereas source inference divides by the actual word count. At 48 words, the identical-input native/source head error is 1.49e-7; at 6, 16 and 96 words it exceeds the fixed 1e-4 tolerance. A corrected, separately versioned producer export and reviewed source fixtures are required; the app does not patch public model graphs.

Anchorless inference, cross-window relations and WebGPU are not qualified for this package. The baseline measurement example leaves value/unit empty when the source model does; the app does not invent missing fields. The final Clinical-Evidence ontology requires external producer fixtures. The supplied LoRA is technically validated by the follow-up above; held-out clinical-schema evaluation remains required. Actual held-out model comparisons, clinical pilot outcomes, M3 Mac/ordinary Windows hardware, assistive-technology review, comprehensive inherited-library security approval, and public Cloudflare/R2 operations remain release gates. CaseDistiller SQL feedback/execution stays a later, external integration as specified by the PRD.
