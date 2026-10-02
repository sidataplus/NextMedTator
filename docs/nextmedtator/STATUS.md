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
- **4 Chromium DOM-only workflows passed** on an in-memory `about:blank` page: assisted review/edit/undo, blind freeze/reveal/compare, untrusted text rendering and XML CRLF/Unicode interoperability.
- The DOM-only harness explicitly substitutes hash/UUID functions because opaque origins lack WebCrypto. It does **not** validate CSP, secure-context storage, service workers or inference.
- Static preview build, source syntax checks and preview asset inventory passed.

## Blocked validation, not passed

- Real-origin browser suite: managed Chromium rejected localhost navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`. No browser policy was disabled.
- Full fork dependency installation/build: runtime networking was unavailable, so new npm/PyPI packages and the full repository checkout could not be fetched into the runtime.
- Dependency locks are **not fabricated**. Exact direct pins are supplied, with a registry verification command. The transitive lock, audit and original-workflow build must be generated and checked in a connected runner.
- GitHub writes: both tree and branch creation returned `403 Resource not accessible by integration`. No commits, branches or PRs were created in the fork or upstream.

## Required before a clinical pilot

1. Qualify the external structured GLiNER2.5 export, tokenizer/schema encoding, all heads, windowing and decoder. No qualified model or adapter package is supplied here.
2. Run genuine baseline-versus-LoRA comparisons. This implementation does not contain model-performance results.
3. Implement the live clinical codec and batch inference orchestration. The shipped codec is tensor-fixture diagnostics only; Analyze is intentionally disabled.
4. Validate the original MedTator UI after precompilation and dependency changes. The isolated workspace is not evidence that the legacy integration passes.
5. Audit/rework remaining legacy HTML sinks and vendored dependencies, including spreadsheet/NLP/toolkit paths; no full PHI security approval is claimed.
6. Run real-origin storage, multi-tab recovery, service-worker/offline, cancellation and egress-canary tests.
7. Add group-aware relation editing, relation metrics, complete legacy schema/relation mapping, and working-context preservation through broader clinician tests.
8. Move expensive comparisons off the main thread, replace full-draft undo receipts with compact deltas for larger projects, measure realistic memory and latency.
9. Add approved model download/cache management and R2 distribution. The first model-package path is local-file, in-memory import.
10. Complete accessibility, original keyboard-flow and device qualification, including an ordinary Windows CPU laptop.

## Deliberately later

CaseDistiller error bundles and expert SQL proposals remain a later integration. NextMedTator must never execute or promote SQL. Public MACCROBAT/PMC material is not bundled until exact source/license review; synthetic examples are included now.
