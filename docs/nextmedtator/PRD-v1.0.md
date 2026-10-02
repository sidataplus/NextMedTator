# NextMedTator
## Product Requirements Document v1.0

**Date:** 2026-10-02  
**Product owner:** Max / SiData+  
**Status:** Specification for implementation, based on the confirmed product direction. No application, model export, deployment, or performance qualification is claimed by this document.  
**Upstream:** OHNLP/MedTator  
**First model integration:** GLiNER2.5 with Clinical-Evidence  
**Later integration:** CaseDistiller expert error adjudication and SQL revision feedback

---

## 1. Product definition

NextMedTator is a static, local-first clinical text annotation workbench that extends MedTator with browser-local model suggestions, occurrence-record review, blind human annotation followed by comparison, and provenance-preserving adjudication.

The product preserves MedTator's familiar annotation workflow. Its primary new workflow is assisted annotation with Clinical-Evidence. Its second workflow hides machine outputs while a human annotates, freezes that independent annotation, and then compares the results on the same schema. Manual annotation remains usable without an installed model.

Cloudflare delivers application assets and approved public model artifacts. Clinical text, predictions, annotations, review actions, and evaluation results are processed locally and are not uploaded by the application. There is no inference API, annotation backend, account system, or hosted clinical-data database.

Training, LoRA preparation, model merging, ONNX export, and reference-output generation belong to a separate model-preparation project. NextMedTator consumes validated browser model packages and supplies a browser-side conformance harness. It does not absorb the model-training pipeline.

### 1.1 Product promise

**Open a corpus, annotate with or without local assistance, compare independent results, and leave with a portable, inspectable research artifact.**

The product is a research and annotation tool, not a clinically validated diagnostic or treatment system. Model suggestions are not patient-care recommendations.

### 1.2 Changes from the preliminary direction

| Decision | Final direction for this PRD |
|---|---|
| First pilot data | Publicly redistributable or original synthetic examples, not a dependency on ACT or other private corpora |
| Model preparation | Separate project and release process; browser package consumption remains in NextMedTator |
| Baseline and fine-tuning | Develop against a pinned GLiNER2.5 baseline; support separately identifiable LoRA-derived packages and honest comparisons |
| Workflow | Assisted-first plus independent human annotation followed by machine comparison |
| UI change | Additive, familiar, and polished; no broad frontend rewrite before the pilot |
| CaseDistiller | Later expert review produces actionable SQL-revision feedback, with evaluation and promotion remaining outside NextMedTator |

## 2. Goals, users, and boundaries

### 2.1 Goals

Reduce repetitive annotation work without concealing errors or missing evidence. Preserve source text, occurrence structure, machine predictions, independent human judgments, and adjudicated outcomes as separate artifacts. Make the baseline-versus-Clinical-Evidence comparison reproducible. Provide a public walkthrough that works without private data, credentials, Python installation, or an inference service. Retain the interaction habits of existing MedTator users.

### 2.2 Users

**Annotator:** Opens local documents, reviews suggestions or labels independently, and exports work. Needs readable evidence, keyboard efficiency, recoverable mistakes, and unmistakable save status.

**Expert adjudicator:** Compares independent annotations and machine runs, resolves disagreements, and documents decisions. Later reviews CaseDistiller errors and explains necessary phenotype-rule changes.

**Study lead:** Defines schemas, freezes assignments and data splits, distributes file-based work packages, combines returned work, and exports analyses or training candidates.

**Model maintainer:** Publishes compatible baseline and LoRA-derived browser packages, preprocessing/decoding specifications, and reference fixtures. This role uses an external preparation toolchain.

**Developer/operator:** Maintains a small fork, builds static releases, checks browser compatibility, audits dependencies, and publishes public assets without handling users' clinical corpora.

### 2.3 Explicit non-goals for v0.1

No remote inference or fallback to hosted models. No browser training or general-purpose checkpoint/PEFT conversion. No automatic upload, analytics, session replay, cloud recovery, or account synchronization. No real-time multi-user collaboration. No autonomous schema generation using external LLMs. No patient-care recommendations. No execution of institutional SQL or automatic SQL promotion. No requirement to replace MedTator's frontend framework. No claim that public case reports establish performance on real institutional notes.

## 3. Scope and release definition

The **v0.1 assisted release** requires local baseline inference, occurrence-record suggestions, human review, blind-then-compare, file-based double annotation/adjudication, portable projects, MedTator interoperability, offline-after-installation, public synthetic walkthroughs, and conformance tests.

Support for identifying, installing, and comparing LoRA-derived packages is a v0.1 application requirement. An actual Clinical-Evidence adapter is an external artifact dependency. If that artifact is not yet qualified, baseline-assisted functionality may be released, but the adapter demonstration remains explicitly incomplete. A stub or cached example does not count as live adapter support.

Automatic relation extraction is enabled only for packages that declare and pass the required capability tests. Manual relations and imported relations remain supported. A span-only export must not be presented as a complete Clinical-Evidence occurrence parser.

Native small-adapter hot-swapping, first-time air-gapped installation, additional language/model qualification, and CaseDistiller integration are later milestones.

## 4. System boundaries and deployment

```text
SEPARATE MODEL-PREPARATION PROJECT

Pinned baseline checkpoint -----> Export / validate -----> Baseline package
          |
          + LoRA + saved heads --> Merge or equivalent ---> Adapted package
                                                           |
                           Public approved package OR local package file
                                                           |
                                                           v
PUBLIC STATIC DELIVERY                              USER'S DEVICE

Cloudflare Workers Static Assets ---- app files ---> Browser application
Cloudflare R2, approved artifacts --- model files --> Local model cache
                                                           |
Local documents ------------------------------------------>|
                                                           v
                                             Tokenize / infer / decode
                                                           |
                                             Suggest / annotate / compare
                                                           |
                                             Adjudicate / save / export
                                                           |
                                                           v
                                                   Local project files

No clinical-data path returns to Cloudflare.
```

### 4.1 Hosting requirements

Deploy the production application with Cloudflare Workers Static Assets. Do not introduce a Worker request handler unless a later, separately justified requirement needs one. Cloudflare documents direct static delivery without invoking Worker code. [S1]

Host large approved model files on R2 through a controlled custom domain; allow local-file model installation for private checkpoints. Workers Static Assets currently limits each file to 25 MiB, so deployment CI must enforce that limit on every app asset, including WASM binaries. R2 is artifact delivery, not an inference endpoint or clinical-data store. [S2, S3]

Bundle application libraries, fonts, runtime JS, and preprocessing code locally. Large WASM/runtime artifacts that exceed static-asset limits may use the same approved artifact distribution mechanism. Do not fetch executable dependencies from arbitrary third-party CDNs at runtime.

Application and model releases are independent and content-addressed. A project pins compatible identities, not a moving `latest` label. Installation must show the release identity, license, byte size, required storage, supported backends, and capabilities before download.

### 4.2 Offline operation

After explicit installation and an offline-readiness check, a user must be able to restart the installed app, import a local corpus, run an installed model, annotate, adjudicate, and export with the network blocked.

Cache all assets required for that selected runtime path before reporting readiness. Do not report offline readiness merely because the main HTML loaded. Defer application/model updates until the user has saved and chosen to update. An installation cancellation or corrupt download leaves the previous usable package intact.

First-time installation on a machine that has never had network access is not a v0.1 release gate. A local model file is supported, but does not by itself solve app-origin, secure-context, service-worker, and browser installation requirements.

## 5. User experience and interaction design

### 5.1 Preserve familiarity

Retain the document list, central source-text view, schema/tag controls, entity/relation interactions, annotation terminology, and access to comparison, adjudication, statistics, and export. Preserve existing shortcuts where practical. Add new functionality through a collapsible assistance panel, compact model/status controls, and an explicit workspace-mode selector.

MedTator already provides annotation, schemas, adjudication, IAA, statistics, and export. Its current source uses the existing HTML/Vue/CodeMirror-oriented application structure; this PRD extends rather than assumes a replacement for that foundation. [S4, S5]

Existing users must be able to import a familiar MedTator project and annotate without installing a model or understanding Clinical-Evidence. Changes to established interactions require a compatibility rationale and regression test.

### 5.2 Main screen

```text
+----------------------------------------------------------------------------+
| NextMedTator   Study: Demo   Assisted   Baseline v...   Runs on this device  |
| Analyze note   Analyze selected   Pause   Save project   Local recovery: OFF|
+----------------+-----------------------------------+-----------------------+
| Documents      | Source text                       | Evidence record       |
|                |                                   |                       |
| 001 Reviewed   | Her mother had diabetes.          | condition_occurrence  |
| 002 In review  | The patient denies diabetes.      | Anchor: diabetes      |
| 003 Not run    |                    ^^^^^^^^        | Experiencer: patient  |
|                |                                   | Assertion: negated    |
| Filters        | Suggestions / Human / Final       |                       |
| Coverage       | Accessible labels, not color only | Accept  Edit  Reject  |
|                |                                   | Add missed evidence   |
+----------------+-----------------------------------+-----------------------+
| 3 suggestions unresolved | Review completeness: PARTIAL | Unsaved changes   |
+----------------------------------------------------------------------------+
```

This wireframe defines information placement, not final visual styling.

### 5.3 Delight requirements

The first screen offers **Try a sample**, **Open local project**, and **Start annotation**. A concise privacy statement appears before any clinical file is opened. Installing a model is optional until assisted inference is requested.

Show meaningful progress: download bytes, model initialization, document/window completion, and cancellation state. Never show a fake percentage. Retain selection and scroll position after accepting/editing a record. Keyboard actions must be discoverable, reversible, and must not interfere with typing in fields. Use text labels and shape/line differences as well as color for provenance and status. Provide adjustable text size, visible focus, accessible field labels, sensible contrast, and reduced-motion behavior.

Status copy distinguishes **Unsaved changes**, **Recovery checkpoint saved on this browser**, and **Project export created**. Downloading a file does not justify claiming that a durable backup was verified. A device/storage panel shows models and project recovery data separately, with clear deletion controls.

### 5.4 Privacy copy

Suggested product copy:

> Your documents are processed on this device. NextMedTator does not upload their contents or annotations. The site downloads application and model files. Local recovery, when enabled, stores project data in this browser profile. Exported files may contain sensitive information.

The expanded notice explains that the host can observe ordinary asset-request metadata, and that browser extensions, operating-system access, cloud-synced download folders, and user-directed file sharing are outside the application's control. Do not claim that static hosting alone provides regulatory compliance.

## 6. Core workflows

### 6.1 Assisted annotation: primary

The user opens a project, confirms its schema, chooses a compatible installed model, and explicitly requests analysis of the current document or selected documents. The app validates the package and schema, reports planned coverage, and creates a frozen machine run.

The reviewer accepts, edits, rejects, splits, or merges occurrence records; corrects their fields and evidence spans; adds missing records; and records unresolved cases. Corrections create human records linked to the prediction. They never rewrite the original model output.

```text
Frozen prediction ------ Accept ------> Reviewed record
        |--------------- Edit --------> Corrected record
        |--------------- Reject ------> Rejection event
        |--------------- Defer -------> Unresolved review item

Missing evidence ------- Add ---------> Human-origin record

All original predictions remain available.
```

Accept-all applies only to an explicitly selected set, remains undoable, and does not mark the document exhaustively reviewed. A separate completeness action records which schema families and source ranges the human reviewed, including whether omissions were checked.

Inference and review run independently. New model results must not overwrite human edits. When the source, schema, decoder profile, thresholds, model, adapter, or backend changes, create a new run identity and visibly mark comparisons that are no longer like-for-like.

### 6.2 Blind annotation followed by comparison

The default blind session creates a human-only workspace under a frozen schema and ordered document assignment. It suppresses machine annotations, model scores, machine-derived hints, predictive counts, error flags, and machine-driven ordering. By default, machine inference occurs after the human snapshot is frozen. Imported predictions can remain unavailable to the annotator until reveal.

```text
Frozen source + schema
          |
          v
Human-only annotation
          |
    Freeze snapshot H0
          |
          +------> Generate/import machine run M0
          |                         |
          +------------+------------+
                       v
              Reveal and compare H0/M0
                       |
              Adjudicated snapshot A0

H0 remains unchanged after reveal.
```

Reveal requires an explicit action, records the exposure, and opens a new comparison/adjudication stage. Post-reveal edits do not become independent human labels retroactively. A project stores whether documents or suggestions were previously seen and which assistance was exposed.

Blinding is a workflow and study-design protection, not an access-control guarantee against a user inspecting local files or developer tools. For stronger study blinding, distribution bundles omit predictions entirely until the independent annotation is returned.

### 6.3 Two humans and an adjudicator

A study lead exports separate assignments with identical source and schema hashes. Returned work remains attributable to locally entered annotator identifiers. The app compares independent snapshots and produces a third adjudicated snapshot, preserving both originals and unresolved decisions. There is no last-write-wins merge of conflicting annotations.

Human-human IAA is calculated from pre-adjudication independent snapshots. Machine-human comparison is labeled as such and is not reported as independent human-human agreement.

### 6.4 Baseline versus LoRA-derived model

The user can run baseline and Clinical-Evidence packages against the same documents and effective schema, sequentially to control memory. The app retains each prediction layer and compares them to a frozen reference independently. It must also show differences directly without implying that one model is ground truth.

A demonstration may use readable model names. An evaluation can mask model identities as A/B until judgments are complete. Prefer separate reviewers or counterbalanced non-overlapping assignments for assisted-time comparisons; a reviewer seeing the same note twice is not a fresh independent comparison.

## 7. Clinical-Evidence and schema requirements

The primary review unit is a structured occurrence record, not an isolated label. The initial preset supports the five confirmed families:

| Family | Example subject of review |
|---|---|
| `condition_occurrence` | Condition/finding anchor and supported contextual fields |
| `measurement_occurrence` | Measurement anchor, value/unit evidence, time, and relevant fields |
| `treatment_occurrence` | Treatment/procedure anchor, status, and supporting attributes |
| `event_occurrence` | An event or behavior occurrence with contextual evidence |
| `function_occurrence` | Functional status or activity evidence and contextual attributes |

Exact field names, permissible values, and mappings come from a versioned Clinical-Evidence schema artifact. NextMedTator does not invent a competing medical ontology. Additional families can be introduced through compatible schema versions, not hard-coded UI changes.

Each record has a stable ID, family, anchor span, additional evidence spans as needed, schema-defined fields, provenance, and optional relations to stable record/span IDs. The UI distinguishes span-extracted values, schema-enumerated choices, unknown/unreviewed values, and explicitly normalized values. Unknown is not equivalent to absent or normal.

Schema editing remains available for general annotation. Assisted inference is enabled only when the model package supports the requested tasks, fields, constraints, and encoded schema budget. Unsupported capabilities fail visibly before running. Generic entity/attribute schemas continue to use familiar MedTator controls.

Schema changes create a new revision and a migration preview. Never silently reinterpret old annotations under new labels or treat differently hashed effective schemas as identical. Migration results retain the prior schema and mapping report.

## 8. Model integration and LoRA contract

### 8.1 Development baseline

Use a pinned `fastino/gliner2.5-base-v1` checkpoint as the initial English baseline candidate. The official repository identifies GLiNER2.5 as the boundary architecture and documents records, relations, attributes, and LoRA-related workflows. This establishes a source-model candidate, not verified browser compatibility. [S6]

A smaller checkpoint may be evaluated when necessary, but it must be named as a distinct baseline rather than silently substituted. English model quality is initially qualified; storage, rendering, selection, and offsets must support Unicode, including Thai. A multilingual UI fixture is not evidence of multilingual model quality.

### 8.2 External preparation versus application ownership

| External model-preparation project | NextMedTator |
|---|---|
| Training and adapter creation | Model package validation and installation |
| Base/adapter compatibility checks | Runtime capability detection |
| Merging/exporting all trained parameters | Local preprocessing, inference, decoding |
| Quantization and graph generation | Golden-fixture browser conformance runner |
| Tokenizer/schema/compiler specification | Record rendering and human review |
| Reference inputs and outputs | Comparison and provenance-preserving export |
| Release/license metadata | Local package selection and rollback |

Both sides share versioned package and evidence schemas. This boundary allows independent repositories and releases; it does not remove the need for an external browser-capable exporter.

### 8.3 Meaning of LoRA support

**v0.1 supports browser packages produced from a baseline plus a LoRA fine-tuned adapter.** The default preparation route merges the applicable adapter updates into the model before export, or uses an externally prepared graph that is numerically equivalent. It must also include any separately trained/saved task-head parameters. Adapter matrices alone are insufficient when training changed additional weights.

LoRA merging is a documented deployment approach in PEFT, but the correct route for the selected GLiNER implementation must be validated by its model maintainer. A generic PEFT call is not assumed to support every GLiNER checkpoint. [S7, S8]

The app records base revision, adapter revision/hash, trained-head identity where applicable, merge/export configuration, and final artifact hashes. The user sees **Baseline** and **Clinical-Evidence, LoRA-derived**, even when the latter is distributed as a full merged model.

Native runtime loading of arbitrary `adapter.safetensors`, instant adapter switching, and small incremental adapter-only downloads are not guaranteed by this design. They can be added as a separately qualified package type. Do not advertise their storage or latency advantages until implemented and measured.

### 8.4 Package requirements

A package manifest specifies format/version, runtime compatibility, source-model identity, base/adapter lineage, licenses, declared tasks and record capabilities, language claims, graph files, external weight files, hashes, sizes, backend/precision variants, required device features, tokenizer identity, word-splitting policy, schema compiler and decoder IDs, maximum input sizes, window policy, thresholds, and reference-fixture identities.

Preprocessing and decoder IDs select application-shipped implementations. A model package must not introduce arbitrary executable JS/WASM plugins or remote code. New executable runtime components are application releases, not trusted merely because a manifest supplies a hash.

A package is installed only after all declared files pass validation. Unknown major versions, missing graphs, unsupported custom operators, insufficient capabilities, and incompatible base/adapter identities fail with actionable messages. A release manifest must list exact hashes; placeholders are invalid.

The community ONNX project inspected for this PRD is experimental and documents NER/classification rather than a complete GLiNER2.5 structured-record browser runtime. It must not be cited as proof that this integration is already solved. [S9]

## 9. Browser execution, WASM, and performance

### 9.1 Execution policy

Establish a native-reference to browser-WASM correctness route before treating acceleration as qualified. Enable WebGPU for package variants that pass browser conformance. Select by capability and smoke test, not a hard-coded browser-name table. ONNX Runtime Web supports multiple providers, but graph support and behavior must be checked for the actual package. [S10]

Use a dedicated application-managed Web Worker for preprocessing, inference, decoding, and substantial comparison work. Do not block text editing while inference runs. ORT's proxy-worker option is not a universal WebGPU solution; its documented limitations include WebGPU and CSP considerations. [S11]

Use TypeScript for straightforward inspection-oriented logic. Package string/NLP components as locally bundled WASM when required for tokenizer parity, an existing reusable implementation, or demonstrated performance. Avoid Rust/WASM merely for its own sake. Any chosen implementation must preserve offsets and be covered by the same fixtures.

### 9.2 Long documents

Tokenization and schema encoding must match the package's reference path. Count schema tokens and other overhead against the actual model limit. Use a declared deterministic windowing/overlap policy. Map outputs back to the unmodified document. Deduplicate overlap records deterministically while preserving distinct occurrences and incompatible contextual interpretations.

Record coverage by source ranges/windows, with complete, partial, cancelled, unsupported, and failed states. Surface cross-window relation limitations and unresolved references. Empty predictions after a failed or partial run are not a negative result. Manual review remains available for uncovered text.

### 9.3 Backend failure and cancellation

A WebGPU failure can offer or perform a disclosed retry using a qualified WASM variant according to the user's setting. Preserve the failed run and create a separately identified retry; do not combine outputs under a misleading single-backend identity. If neither local path works, retain manual mode and explain the failure. Never call a remote model.

Cancellation must acknowledge promptly and stop at the next safe boundary. A user may force-stop an unresponsive inference worker; in-progress output remains partial, and committed annotations survive. Do not promise that a currently executing GPU kernel can always be interrupted immediately.

### 9.4 Qualification devices and targets

Primary qualification uses the M3 Pro MacBook and a documented ordinary Windows laptop with 16 GB RAM and no discrete GPU requirement. Current Chrome/Edge desktop builds are the initial release matrix. Other browsers remain manual-capable where tested, and inference-capable only where separately qualified.

Provisional engineering targets, not measured results: review actions provide visual acknowledgment within 150 ms at p95; cancel/pause requests acknowledge within 250 ms; document switching remains responsive in the agreed 1,000-document fixture. Inference runs outside the UI thread. One active model and bounded work queues are the default.

The first runtime milestone must publish cold load time, warm inference p50/p95, download size, peak memory, backend/precision, and tested document/schema sizes. A defensible latency and memory budget is fixed from those measurements before the assisted release. Unknown performance cannot pass as an unqualified claim of responsiveness. A model that only finishes outside the agreed budget is experimental even if numerically correct.

Multi-threaded WASM requires browser support and cross-origin isolation. Deployment must test the relevant headers and provide an explicit single-thread path when isolation is unavailable. [S11]

## 10. Data model, offsets, and provenance

### 10.1 Authoritative objects

| Object | Required information |
|---|---|
| `ProjectManifest` | Project/version IDs, schema and source identities, workflow, declared splits, assignments, ancestry, app compatibility |
| `SourceDocument` | Stable ID, original bytes or lossless source representation, encoding, text hash, source/license metadata, grouping/split metadata |
| `SchemaSnapshot` | Full schema, version/hash, grammar, field semantics, guidelines, explicit migrations |
| `ModelPackageIdentity` | Package/artifact hashes, base/adapter lineage, runtime/decoder/preprocessor identities |
| `PredictionRun` | Source/schema hashes, model package, backend/precision, thresholds, windows, coverage, outputs, timing, failures |
| `EvidenceRecord` | Stable ID, family, source spans, typed fields, optional relations, origin/run linkage |
| `HumanSnapshot` | Annotator, schema/source identity, human records, completeness, assistance/exposure status, parent snapshot |
| `ReviewEvent` | Local event ID, actor, action, affected IDs, before/after or reconstructable delta, snapshot ancestry |
| `AdjudicationSnapshot` | Compared inputs, final records, unresolved items, reason codes/comments, reviewer identity |
| `ComparisonReport` | Input snapshot hashes, matching/scoring configuration, coverage, metrics, disagreements |

IDs are separate from document text hashes. Matching content does not automatically mean matching patients or interchangeable source documents. Project IDs, hashes, and filenames stay local; they are not analytics identifiers.

### 10.2 Offset invariants

Canonical spans use zero-based, half-open Unicode code-point offsets `[start, end)` into the immutable canonical document string. Browser UTF-16 indices and model tokenizer offsets are explicitly converted and validated. Grapheme-aware visual selection must not create broken surrogate or combining-sequence boundaries accidentally.

Preserve original input bytes and their hash, decode using a declared encoding, and separately hash the canonical UTF-8 serialization when necessary. Reject or explicitly resolve invalid encoding; never silently substitute characters. Do not silently normalize CRLF/LF, Unicode normalization forms, whitespace, or case in the authoritative source.

Normalized views needed for a tokenizer or legacy interchange are derived representations with explicit reversible offset maps or reported information loss. Editing source text creates a new source-document revision and invalidates dependent offsets until an explicit remapping is validated; it never mutates the text beneath existing annotations. Every retained evidence span must resolve to the exact stored source substring. Discontinuous spans use an ordered span array. Empty or document-level labels must not be represented by fabricated source spans.

Offset qualification includes CRLF, LF, tabs, BOM handling, accented characters, combining marks, emoji/non-BMP characters, Thai, repeated identical phrases, XML-sensitive characters, discontinuous spans, and cross-line records. Imports with mismatched text or ambiguous offsets are quarantined for explicit resolution, not silently repaired by fuzzy matching.

### 10.3 Provenance rules

Machine outputs, independent human annotations, assisted edits, and adjudicated annotations are separate layers. Their vocabulary does not automatically include a claim of gold-standard status. A study lead declares an evaluation reference using a named protocol.

A run fingerprint includes source text, effective schema, model and adapter lineage, tokenizer, word splitter, decoder, thresholds, windowing policy, runtime version, backend, and precision. Changing these creates a new run or explicit derived snapshot. Re-thresholding stored scores creates a derived run rather than altering the original.

Keep the structured predictions and sufficient scores/evidence to reproduce review, not necessarily every intermediate model tensor. Confidence values are model scores unless independently calibrated; do not label them clinical probabilities.

Append-only history is a logical application invariant with undo represented by new events. Hashes detect corruption and identify artifacts but do not authenticate a person or prevent a malicious local editor from rewriting a bundle. Local timestamps are descriptive, not a trusted external clock.

## 11. Persistence, recovery, and portability

The `.nmt.zip` project is the canonical exchange and durable user-owned artifact. Browser storage is a working copy/cache, not the only backup.

```text
study.nmt.zip
|-- manifest.json
|-- schema.json
|-- documents/
|-- model-identities/
|-- machine-runs/
|-- human-snapshots/
|-- review-history/
|-- adjudication/
|-- comparisons/
|-- provenance/
`-- licenses/
```

Model weights are excluded by default. A project can be opened and reviewed without reinstalling the originating model, because its predictions and provenance are stored. Re-running inference requires the matching package or an explicitly recorded replacement.

Model/app caching is separate from clinical recovery. Clinical recovery is opt-in per device/project, with a clear shared-computer warning. No PHI-bearing preview, recent-file list, raw text, or annotation content is persisted through a different unconsented settings path. Retained file handles and metadata receive the same treatment.

Use Cache Storage for installed public assets and a narrow IndexedDB recovery store initially. OPFS may be used for model-file storage or measured large-file needs, but avoid redundant recovery authorities. The user can inspect storage usage, delete a project's recovery data, remove models, or clear all local application data. Explain that browser deletion is not a promise of forensic erasure.

Browser quotas, denial of persistence requests, and storage eviction are real constraints; quota errors must not be presented as a successful save. [S12] On recovery failure, keep current work in memory, display an unsaved warning, and offer an explicit project export. Use transactional checkpointing where available and verify the recovery payload after writing.

Do not claim receipt of a browser download that the browser cannot confirm. File-system saves may show a stronger verified status only when the relevant API and verification succeeded. Save reminders and before-close warnings supplement, but do not replace, recovery and explicit export.

Multiple tabs opening the same recoverable project must not overwrite each other. Use a local lock or an explicit read-only/branch choice. Bundle import validates path names, decompressed size limits, versions, schema, source hashes, and record references before altering an existing workspace. Retain previous usable state if validation fails.

## 12. Interoperability and exports

Import plain-text files, explicitly mapped JSONL documents, supported MedTator schemas/annotations/workspaces, and native `.nmt.zip` projects. A document ID field, text field, optional group ID, and split role must be explicit for structured imports.

Preserve MedTator interoperability for representable entities, attributes, relations, and document labels. Native provenance and grouped-record features that XML cannot represent remain in the native bundle. Legacy exports include a machine-readable loss report and a human-readable warning. Never silently flatten a rich occurrence graph and present it as lossless.

Imported legacy data is marked `imported` with known provenance retained and unknown provenance left unknown. Prior annotations must not be relabeled as newly human-adjudicated. Existing MedTator-specific behaviors outside the new assisted scope should remain available unless a documented security or integrity defect requires change.

Provide neutral JSONL evidence export, reference/candidate annotation export, comparison CSV/JSON, and review-event export. Preserve existing useful BioC/BIO/export routes, but test their mappings and report losses. MACCROBAT ingestion may use a small, deterministic offline dataset converter rather than require a general brat editor integration in v0.1.

**Training-candidate export is not automatic training.** It includes review completeness, assistance exposure, adjudication status, split/group IDs, source/model/schema provenance, and unresolved labels. Unreviewed evidence is not converted into a negative. Test and protected evaluation roles are excluded from training exports by default and cannot be silently changed; any authorized role reassignment creates an auditable project revision and invalidates the corresponding held-out claim.

The neutral Clinical-Evidence export is the stable boundary. A training-library-specific conversion belongs to the external training project unless a small versioned adapter is explicitly maintained.

## 13. Comparison, IAA, and adjudication semantics

Use a deterministic, documented one-to-one record-matching algorithm. Match occurrence family and compatible anchors first, then score fields and linked evidence. Do not double-count duplicate predictions or turn all partial matches into true positives.

Report exact-anchor precision/recall/F1 as the primary span metric, a separately labeled relaxed-overlap metric, record-level completeness, and field accuracy conditional on the declared matching policy. Also report end-to-end field/tuple performance so missed anchors are not hidden by high conditional attribute accuracy. Report relation metrics only where relation annotations and coverage are available.

Cohen's kappa is appropriate only where a fixed evaluation unit and label set have been defined, such as document-level categorical labels. Do not calculate it over an arbitrary universe of all possible spans. Show undefined or not-applicable metrics explicitly. Disagreement categories include missing record, extra record, boundary mismatch, wrong family, field mismatch, wrong linkage, and insufficient reference coverage.

All reports identify their input hashes, schema, matching configuration, evaluated source coverage, support counts, and excluded cases. Imported NER annotations lacking assertion or temporal fields do not become reference truth for those fields. A machine-only comparison without an independent reference is disagreement analysis, not an accuracy benchmark.

Adjudication supports choosing a candidate, creating a corrected third record, declaring insufficient evidence, retaining unresolved cases, and entering a rationale. It does not force agreement merely to clear a queue.

## 14. Public demonstrations and dataset policy

### 14.1 Required synthetic pack

Ship a small original synthetic corpus in the repository and built sample walkthrough, covering all five occurrence families and the most important failure modes: negation, family versus patient, historical versus current evidence, future plans, multiple occurrences of one phrase, uncertain statements, values/units, absent evidence, long-document coverage, and Unicode/offset edge cases.

Include a documented author-reviewed reference layer. Mark the entire pack as synthetic and distinguish intended reference annotations from independent clinical validation. Preserve generation/edit provenance when model-assisted creation was used. No private patient text, real patient identifiers, or copied restricted excerpts may enter synthetic fixtures. The owner must approve a redistribution license; synthetic content is not automatically a legal license grant.

The walkthrough must work with no model installed in manual or recorded-example mode. Recorded predictions must be visibly labeled with their origin and must never masquerade as live inference. The live path installs a qualified package and produces new local outputs. Baseline-versus-LoRA improvement may only be claimed from actual saved runs, not fabricated demonstration values.

### 14.2 MACCROBAT

MACCROBAT's primary Figshare v2 release contains 200 source text documents and 200 manually annotated brat standoff files and is labeled CC BY 4.0. It is a strong candidate for a small real-text walkthrough. [S13]

Before bundling, record the exact version/checksum, attribution, original document identifiers, and any underlying article-level rights or third-party exceptions relevant to redistribution. Keep original annotations and schema mappings distinguishable from newly added Clinical-Evidence annotations. Do not treat its existing labels as complete reference coverage for all new occurrence fields.

Include only a small documented subset in the app/repository unless a larger distribution has an explicit purpose. Pin acquisition and conversion inputs; do not make the deployed app retrieve patient-like text from an external dataset API.

### 14.3 PMC case reports

Treat “PMC Cases” as a proposed case-report source family until an exact dataset or article list is pinned. The exact collection was not unambiguously identified during preparation of this PRD. Do not assume a permissive license from PMC availability: NLM explicitly states that reuse terms vary by article. [S14]

For bundled samples, select articles with documented compatible redistribution/adaptation rights, retain PMCID/DOI and attribution, record extraction edits and source offsets where possible, and review third-party material separately. A CC BY/CC0-oriented allowlist is the default. Unknown, noncommercial-only, or no-derivatives cases stay out of the unrestricted public demo unless separately resolved. This is a conservative product distribution policy, not a blanket legal opinion about all possible reuse. CC BY itself requires attribution and indication of modifications. [S15]

### 14.4 Required provenance and separation

Every bundled real-text sample has a license/provenance record: dataset version, source identifier, license identifier and evidence, attribution, transformation history, text hash, annotation origin, and allowed distribution scope.

Demo examples are public teaching material. They are not hidden evaluation data. Benchmark partitions preserve patient/article grouping, near-duplicate checks, and training-exposure metadata. Do not claim baseline pretraining is free of public-data contamination when that cannot be established.

## 15. Privacy and security requirements

The app never sends clinical text, annotations, document IDs, filenames, text hashes, schema contents, review comments, or local event logs to a host or third party. Do not place them in URLs, request headers, analytics events, automatic exception reports, console diagnostics enabled in public builds, or telemetry. User-directed export is a local operation, not an upload.

App/model installation may request known public artifact URLs. Requests are credential-free where possible and contain no project information. Do not silently download a newly required package from within a sensitive review session. Use an explicit installation workflow and preserve the user's current work.

Apply restrictive CSP, HTTPS, appropriate content-type handling, safe parsing, and controlled cross-origin resource access. Support the narrow WASM compilation allowance where required; do not equate it with unrestricted JS evaluation. The legacy frontend may require targeted build/template changes to work under the chosen policy. Do not disable CSP wholesale to avoid fixing those incompatibilities. [S16]

COOP/COEP and artifact CORS/CORP behavior must be tested together when threaded WASM is used. Cloudflare static response headers can be supplied without an application API. [S17] Externally fetched resource URLs are installation-only data paths; no arbitrary remote executable plugins are allowed.

Treat all imported documents, schema descriptions, annotations, and comments as untrusted text. Prevent DOM/template injection, external XML entity resolution, prototype pollution, spreadsheet-formula injection in analysis exports, zip path traversal, decompression bombs, and model/package resource exhaustion. Do not embed or execute arbitrary HTML from clinical text. No secrets, private model credentials, or PHI may be committed into public static assets.

No Cloudflare Web Analytics, third-party session replay, remote error collection, or unreviewed edge script injection in the clinical workspace. The privacy claim is limited to application behavior on a trusted device/browser and release. Code supply-chain compromise, local malware, malicious extensions, and user-directed sharing remain outside that guarantee.

**Acceptance:** use distinctive synthetic canaries in text, filenames, IDs, schema fields, and review comments; instrument all browser requests through installation, inference, review, save, and error paths. No canary may appear in outbound traffic. After readiness, run the complete local workflow with network access blocked. Offline success and no-content-egress tests are complementary, not substitutes.

## 16. Future CaseDistiller expert error adjudication

Reserve an optional producer namespace and bundle extension now; do not build a SQL execution engine into v0.1.

```text
CaseDistiller selected SQL + evaluation results
                    |
          Versioned error-review bundle
                    |
                    v
NextMedTator expert review
  - inspect source and highlighted matches
  - adjudicate evidence and case judgment
  - classify the error and explain desired logic
  - propose a correction or SQL patch
                    |
          Versioned correction bundle
                    |
                    v
CaseDistiller Host
  - validate identities and protected data roles
  - apply candidate change in a development branch
  - compile, test, and measure independently
  - promote or reject under its existing authority
                    |
           New SQL version + receipt
```

Inputs include source and schema hashes, selected program/SQL identity, phenotype predictions, observed evidence/matches, declared evaluation role, and reference status. SQL and provenance are viewed as imported artifacts, not executed against a live hospital database.

Outputs include expert case judgment, corrected evidence, error category, rationale, related source spans, affected rule IDs, and optionally a proposed patch. Typical categories are a missing synonym, inappropriate negation/temporality/experiencer scope, a reference-label problem, or evidence insufficient for the phenotype definition. An expert's intent-level correction is valid even when the expert does not write SQL.

Source annotations and human reference corrections do not silently modify a protected label snapshot. CaseDistiller creates a new version under its own policy. Read-only assessment cannot mutate the selected program. SQL revisions remain candidates until CaseDistiller validates semantics, tests them, and performs its normal promotion process. Feedback from held-out test cases must be segregated; using it for subsequent optimization retires the prior held-out claim.

## 17. Architecture and repository strategy

Fork rather than reconstruct MedTator. Record the exact upstream commit at project bootstrap, retain copyright/license notices, and maintain a brief upstream-divergence ledger. Choose Apache-2.0 for original fork code; keep third-party data, model, dependency, and license notices separate. MedTator's repository identifies Apache-2.0 as its license. [S4]

Retain useful existing directories and UI code. The following is a proposed additive layout, not a requirement to relocate the entire upstream tree:

```text
NextMedTator/
|-- templates/                 Existing MedTator UI, minimally changed
|-- src/nextmedtator/
|   |-- contracts/             Project, evidence, run, review schemas
|   |-- runtime/               Package loading and browser model adapter
|   |-- workers/               Inference and heavy data operations
|   |-- text/                  Offsets and tokenizer/normalization mappings
|   |-- review/                Provenance layers and review transitions
|   |-- compare/               Matching, metrics, adjudication
|   |-- storage/               Recovery and portable bundles
|   `-- adapters/              MedTator and neutral evidence interchange
|-- wasm/                      Only required, measured local components
|-- samples/                   Synthetic and license-approved public examples
|-- tests/                     Fixtures, conformance, browser E2E
|-- docs/                      Product, compatibility, privacy, walkthroughs
`-- deployment/                Static build/header configuration
```

Use `pnpm` for new browser-module builds and dependency pinning. Build-time Python/Flask may remain where it minimizes upstream disruption; it is not a production service. Model-export/training repositories and their dependencies stay separate.

Retain libraries when safe and useful; patch, precompile, vendor, or replace specific components when required for correctness/security. Familiar UX does not require preserving vulnerable dependency versions. No framework migration is included unless a specific blocker cannot be resolved narrowly.

## 18. Evaluation plan and local instrumentation

Evaluate two independent questions.

**Model question:** Does the LoRA-derived Clinical-Evidence package improve evidence extraction relative to the pinned baseline under the same effective schema and declared inference settings? Run both against a held-out reference; report per-family span/record metrics, contextual-field errors, relation metrics when applicable, latency, memory, and any regressions. Verify adapter loading/merging against external reference fixtures; a passing load call is not proof that the adapter changed the intended weights.

**Workflow question:** Does assisted annotation reduce active review time without an unacceptable loss in independently assessed evidence quality? Compare manual/blind annotation, baseline-assisted annotation, and LoRA-assisted annotation when that package is available. Use randomized or counterbalanced assignments and protect against same-reviewer repeated-document exposure. Obtain independent adjudication for a subset or the full assessment set according to the study protocol.

Primary measures are active time per fully reviewed document and evidence quality against the independent reference. Secondary measures include omissions found, modifications/rejections/additions, completeness, IAA, unresolved cases, inference wait time, device failures, and task completion without developer help. Acceptance rate alone is not accuracy.

Record timing locally with configurable idle detection, page visibility, manual pause, and separate inference/download waiting time. Instrumentation is explicit and local; the user chooses whether to export it. Do not log raw keystrokes. Analysis exports retain sufficient grouping for document/annotator-aware uncertainty estimates without pretending repeated observations are independent.

A pilot estimates variance and feasibility. Its sample size, time-reduction target, and quality/non-inferiority margin must be prespecified before confirmatory collection. No universal percentage improvement or clinical equivalence claim is promised by the PRD. App performance thresholds are engineering gates; research results may legitimately show no benefit and must still be reportable.

## 19. Acceptance matrix

| ID | Release requirement | Required evidence |
|---|---|---|
| AC-01 | Familiar manual workflow | Original-style schema/import/annotate/save/export task passes without a model |
| AC-02 | Complete local path | Install, disconnect network, restart, infer, review, compare, export successfully |
| AC-03 | No clinical-data egress | Synthetic-canary network suite passes, including errors and cancellation |
| AC-04 | Source/offset integrity | Exact source/span round trips for Unicode, newline, duplicate, and XML-sensitive fixtures |
| AC-05 | Baseline browser inference | Pinned source/reference to native ONNX to browser path passes declared conformance |
| AC-06 | LoRA package support | Distinct lineage/install/run/compare paths pass; real adapter demo remains gated on its artifact |
| AC-07 | Structured records | All five initial families preserve supported fields and evidence through inference/review/export |
| AC-08 | Provenance separation | Accept/edit/reject/add and undo preserve frozen machine and independent human layers |
| AC-09 | Blind-then-compare | No machine cues before freeze; reveal recorded; independent snapshot unchanged afterward |
| AC-10 | Independent adjudication | A/B imports retain identities; final C snapshot never overwrites either input |
| AC-11 | Truthful coverage | Partial/cancelled/failed inference cannot be reported as a completed negative result |
| AC-12 | Recovery failure handling | Quota/permission/tab conflicts do not produce false save success or silent overwrite |
| AC-13 | Interchange honesty | MedTator supported-field round trip passes; lossy paths produce actionable loss reports |
| AC-14 | Public walkthrough | Complete synthetic sample works; real samples have approved manifests and attribution |
| AC-15 | Model comparison integrity | Effective schemas/settings pinned; reference coverage and unknown fields respected |
| AC-16 | Runtime health | Worker cancellation/retry works; latency/memory report and supported envelope approved |
| AC-17 | Evaluation export | Completeness, exposure, grouping, splits, and model/source identities survive export |
| AC-18 | Safe imported data | Injection, traversal, corrupted archives, oversized artifacts, and malformed manifests fail safely |
| AC-19 | Accessible review | Keyboard navigation, focus, status labels, text sizing, and non-color provenance are exercised |
| AC-20 | Release reproducibility | Pinned build, dependency notices, artifact hashes, compatibility manifest, and rollback drill |

Conformance separates exact requirements from numerical tolerances. Token IDs, source offsets, schema encoding, canonical identities, and deterministic preprocessing/decoding fixtures must match exactly. Floating-point scores use documented per-output tolerances fixed before evaluation. Reduced precision may change threshold-adjacent decisions; discrepancies require an explicit report and approval under a prespecified quality budget, not a blanket “parity passed.” Each backend/package variant is qualified separately.

No elapsed-time estimate replaces these gates. Use unit tests, deterministic contract fixtures, browser end-to-end tests, manual clinician workflows, and actual hardware runs. Browser simulation alone does not establish WebGPU behavior on the target devices.

## 20. Milestones and dependencies

| Milestone | Deliverable | Exit gate |
|---|---|---|
| M0: Fork and contracts | Upstream pin, additive UI plan, native bundle/schema/run contracts, synthetic fixtures | Manual compatibility and exact-offset tests pass |
| M1: External artifact handshake | Pinned baseline browser package, tokenizer/decoder contract, reference corpus from the separate project | Required structured capabilities and browser-WASM conformance demonstrated; performance envelope fixed |
| M2: Assisted workspace | Model installation, local inference worker, record suggestions, review history, explicit save/recovery | End-to-end offline assisted annotation passes |
| M3: Blind and adjudication | Human-only freeze, reveal, two-human comparison, metrics, final adjudication layer | Blinding, matching, snapshot-preservation tests pass |
| M4: Public v0.1 | Cloudflare static release, sample walkthroughs, compatibility matrix, privacy/security checks | Applicable AC-01 through AC-20 pass |
| M5: LoRA evidence demonstration | Qualified external adapter-derived package and fair A/B walkthrough/report | Both model and workflow claims trace to real held-out runs; report failures/regressions |
| M6: CaseDistiller extension | Error-bundle import, expert adjudication, correction/patch export | CaseDistiller validates and controls subsequent SQL promotion |

WebGPU qualification can proceed alongside M2-M4 but remains variant-specific. A WebGPU-only preview must be labeled as narrower than the CPU-capable release. MACCROBAT/PMC inclusion must not block the synthetic walkthrough if licensing or mapping work remains unresolved.

## 21. Risks, mitigations, and decision triggers

| Risk | Mitigation and decision trigger |
|---|---|
| GLiNER2.5 records/heads cannot yet run through the browser exporter | Treat M1 as a blocking external dependency; isolate graph/decoder failures. Do not ship NER-only under a full Clinical-Evidence claim. A manual/recorded-demo preview is allowed only with truthful labeling. |
| LoRA export omits trained heads or uses the wrong base | Require lineage and external live-adapter versus exported-output fixtures. Reject ambiguous packages. |
| Browser model is too large or slow | Bound schema/document work, measure a smaller separately named baseline, qualify quantization, load one model at a time. Never conceal a remote fallback. |
| Existing UI and strict security controls conflict | Make targeted template/build changes, preserve interactions, document dependency exceptions, and withhold sensitive-data claims until tested. |
| Automatic suggestions bias human reference | Freeze blind snapshots, track exposure, separate assisted outcomes from independent labels, and use independent adjudication. |
| Public corpora have incomplete evidence labels or unclear rights | Synthetic default; per-source approval; score only supported label coverage; retain mappings. |
| Browser data loss or shared-device residue | Explicit recovery consent, truthful save state, portable exports, storage inspection/deletion, tested failures. |
| New features disrupt familiar MedTator use | Additive controls, a manual path, original-workflow regression tests, and evaluation with existing users. |
| Product becomes a training/SQL platform | Keep model preparation and CaseDistiller execution external; integrate through versioned artifacts. |
| Hashes are mistaken for an authenticated audit trail | State their integrity role and local identity limitations; do not claim tamper-proof or regulated audit compliance. |

## 22. Operations, documentation, and definition of done

Release static assets from a locked, reviewed build. Separate public demo/model files from all private test material. Produce dependency/license notices and artifact hashes. Maintain previous compatible app and model releases long enough to reopen existing projects and rehearse rollback without destructive bundle migration.

Upgrade at explicit release boundaries, not during active review. Mark retired packages as retired without silently changing saved predictions or deleting locally needed files. New bundle versions use explicit migrations with before/after integrity reports. A future replacement client must be able to recover text, schema, annotations, provenance, and comparisons from documented JSON and source files without the original application.

Required documentation comprises this PRD; a MedTator-to-NextMedTator guide; assisted, blind, and adjudication walkthroughs; the public dataset manifest/license policy; model-package producer and consumer specifications; browser/runtime compatibility and performance reports; offset and interchange rules; privacy/recovery notices; evaluation/export instructions; static deployment/rollback instructions; and a future CaseDistiller bundle specification when M6 begins.

**Definition of done for the first public assisted release:** a new user completes a synthetic walkthrough and a real local project through the qualified browser baseline, retains exact evidence and provenance, can perform an independent blind comparison and adjudication, and exports a portable project with no application-driven clinical-data upload. An existing MedTator user completes a familiar manual task without model installation or framework-specific retraining. The actual LoRA comparison is released when its separately prepared package passes the same gates.

**First implementation decision:** establish the native project/evidence/model-package contracts and the external baseline-package conformance handshake before adding extensive UI features. This is the earliest point that tests whether the product's central local-inference promise is deliverable.

---

## Sources and verification notes

External technical and licensing observations were checked on 2026-10-02. These sources support specific factual statements; proposed product requirements and acceptance criteria are design decisions, not claims that the cited products already implement them. No application was deployed and no checkpoint was exported or benchmarked while preparing this PRD.

- **[S1] Cloudflare Workers Static Assets.** Direct static delivery and optional Worker behavior. https://developers.cloudflare.com/workers/static-assets/
- **[S2] Cloudflare Workers limits.** Static-asset file-size and deployment limits. https://developers.cloudflare.com/workers/platform/limits/
- **[S3] Cloudflare R2 public buckets.** Public artifact delivery and custom domains. https://developers.cloudflare.com/r2/buckets/public-buckets/
- **[S4] OHNLP/MedTator repository.** Existing scope, build workflow, and Apache-2.0 licensing. https://github.com/OHNLP/MedTator
- **[S5] MedTator configuration.** Existing frontend dependencies and local/CDN asset configuration. https://github.com/OHNLP/MedTator/blob/main/config.py
- **[S6] Fastino GLiNER2 official README.** Span/boundary architectures, GLiNER2.5 checkpoint candidates, tasks, and tokenizer considerations. https://github.com/fastino-ai/GLiNER2/blob/main/README.md
- **[S7] GLiNER2 LoRA tutorial.** Source-library adapter workflows, not browser-runtime qualification. https://github.com/fastino-ai/GLiNER2/blob/main/tutorial/10-lora_adapters.md
- **[S8] Hugging Face PEFT LoRA documentation.** General adapter merging and its limitations. https://huggingface.co/docs/peft/v0.21.0/package_reference/lora
- **[S9] lmoe/gliner2-onnx.** Experimental conversion/runtime scope; inspected README documents NER/classification and excludes other structured features. https://github.com/lmoe/gliner2-onnx
- **[S10] ONNX Runtime Web overview.** Browser runtime and execution-provider choices. https://onnxruntime.ai/docs/tutorials/web/
- **[S11] ONNX Runtime Web environment flags/session options.** Threading, cross-origin isolation, worker limitations, and runtime asset matching. https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html
- **[S12] MDN storage quotas and eviction criteria.** Browser persistence, quota, and eviction behavior. https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- **[S13] J. Harry Caufield, MACCROBAT, Figshare v2.** Primary release description and CC BY 4.0 license. DOI: 10.6084/m9.figshare.9764942. https://figshare.com/articles/dataset/MACCROBAT2018/9764942
- **[S14] NLM PMC Open Access Subset.** Article-specific reuse terms and supported retrieval mechanisms. https://pmc.ncbi.nlm.nih.gov/tools/openftlist/
- **[S15] Creative Commons Attribution 4.0 deed.** Redistribution/adaptation permissions and attribution/modification conditions. https://creativecommons.org/licenses/by/4.0/deed.en
- **[S16] MDN CSP script-src.** WASM-specific compilation allowance versus JavaScript unsafe evaluation. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src
- **[S17] Cloudflare static-asset headers.** Static response-header configuration. https://developers.cloudflare.com/workers/static-assets/headers/
