# Implementation status

This file distinguishes working code from qualification. It is not a claim that the entire PRD is finished.

## Implemented

- Immutable project/source, schema and prediction-run contracts with exact Unicode code-point spans.
- Explicit textarea display-normalization mapping back to unmodified CRLF/CR source.
- Grapheme-safe new selections; BOM, emoji, Thai and combining-character handling.
- Structured occurrence review for all five demonstration families and schema-defined attributes.
- Accept/edit/reject/defer, missing human records, reversible review and separate completeness.
- Blind assignment exclusion, independent freeze, explicit reveal and exposure provenance.
- Same-configuration machine comparison snapshots, human snapshots and third-layer adjudication.
- Deterministic one-to-one exact/overlap matching, evaluated-field tuples and fixed-unit kappa.
- Training export filtered to completely reviewed `train` records; test/demo/protected excluded.
- Bounded ZIP import/export with CRC, member hashes, path and expansion checks.
- MedTator XML interoperability for representable spans/text fields; explicit loss reports.
- Local JSONL/text/project inputs; no background clinical-data upload.
- Opt-in IndexedDB recovery with CAS and optional Web Locks, read-back integrity checks.
- Local active-time/event exports; no keystroke telemetry.
- Explicit static app cache installation using an immutable asset inventory.
- Synthetic walkthrough and license/source manifest, with authored suggestions clearly labeled.
- External model-package validation, immutable baseline/LoRA/head provenance and tensor conformance worker code.
- Additive fork build, selected dependency refreshes, local asset copying, Vue precompilation and static security headers.

## Executed validation in this environment

- **50 Node unit tests passed**, using actual Node WebCrypto and no third-party test dependencies.
- **4 Chromium DOM-only workflows passed** on an in-memory `about:blank` page: assisted review/edit/undo, blind freeze/reveal/compare, untrusted text rendering and XML CRLF/Unicode interoperability. The DOM-only harness substitutes hash/UUID functions because opaque origins lack WebCrypto. It does **not** validate CSP, secure-context storage, service workers or inference.
- **5 real-origin Chromium workflows passed** at `http://127.0.0.1:4173/`: assisted review/edit/undo/export, blind freeze/reveal/compare, opt-in recovery plus offline export, synthetic canary import/export with no content egress, and XML CRLF/Unicode round trip with XXE rejection.
- The legacy MedTator page built with local dependencies loaded in Chromium, including opening and closing the evidence workspace.
- A local `gliner25-boundary-span-v1` package built from the published fp32 `fastino/gliner2.5-base-v1` ONNX export was imported in Chromium. Analyze locally returned two machine spans for “diabetes” (scores 0.991 and 0.984) with concept text only. Assertion, experiencer, and the negated-family distinction were not predicted. Weights are not in the repository.
- Direct npm pins were checked against the registry. `pnpm-lock.yaml` is generated from that resolution. `pnpm audit --audit-level high` passed after moving js-yaml to 4.3.2. Moderate transitive findings remain.
- Static `dist/` asset inventory passed, including the 25 MiB file limit and no remote or inline executable scripts.

## Still not qualified

- Analyze locally runs only after import of a GLiNER2.5 package. The app ships the tokenizer, prompt, boundary decoder, and span-attribute decoder; it does not ship weights. A span package returns span text plus score. A structured package also fills enum attributes from `explicit.onnx`. Measurement value, unit, and relations stay empty. Authored sample suggestions remain labeled as authored. There are no baseline-versus-LoRA results.
- Group-aware relation editing, CaseDistiller SQL review, approved model download/cache, and a clinical pilot remain later work.

## Required before a clinical pilot

1. Qualify the external structured GLiNER2.5 export, tokenizer/schema encoding, all heads, windowing and decoder. No qualified model or adapter package is supplied here.
2. Run genuine baseline-versus-LoRA comparisons. This implementation does not contain model-performance results.
3. The live path is local GLiNER2.5 boundary span extraction, windowed at 512 tokens, plus softmax enum attributes when the package includes the exported span-attribute head. Record binding for measurement value and unit, relation decoding, and a qualified LoRA package are still absent.
4. Validate the original MedTator UI after precompilation and dependency changes. The isolated workspace is not evidence that the legacy integration passes.
5. Audit/rework remaining legacy HTML sinks and vendored dependencies, including spreadsheet/NLP/toolkit paths; no full PHI security approval is claimed.
6. Run real-origin storage, multi-tab recovery, service-worker/offline, cancellation and egress-canary tests.
7. Add group-aware relation editing, relation metrics, complete legacy schema/relation mapping, and working-context preservation through broader clinician tests.
8. Move expensive comparisons off the main thread, replace full-draft undo receipts with compact deltas for larger projects, measure realistic memory and latency.
9. Add approved model download/cache management and R2 distribution. The first model-package path is local-file, in-memory import.
10. Complete accessibility, original keyboard-flow and device qualification, including an ordinary Windows CPU laptop.

## Deliberately later

CaseDistiller error bundles and expert SQL proposals remain a later integration. NextMedTator must never execute or promote SQL. Public MACCROBAT/PMC material is not bundled until exact source/license review; synthetic examples are included now.
