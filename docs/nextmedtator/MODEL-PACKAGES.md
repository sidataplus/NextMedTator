# External model-package handshake

Model preparation stays separate from the web app. The standalone [GLiNER2.5 LoRA packager](../../tools/gliner-onnx/README.md) has its own Python project and locked dependencies; it merges compatible PEFT adapters and exports verified ONNX packages. The web app imports the resulting package. This repository does not fine-tune models or call inference APIs.

## Auto annotation model selection

Both annotation views default to
`na399/clinical-evidence-gliner2.5-small-lora-v3-act-sol` at the immutable
revision recorded by the exporter. The model-source selector also offers the
clinical base adapter, original Fastino small/base checkpoints, a custom Hub
adapter with an immutable commit, and local PEFT adapter files. Threshold
overrides belong to the exact selected source, not the previous model.

The Hub adapters contain PEFT weights, not browser-ready ONNX packages. Convert
once with the [standalone exporter](../../tools/gliner-onnx/README.md), import
the ZIP, and optionally install it for offline use. The selector exposes the
matching export command. Selecting local files hashes their config and weights
on the device; it does not upload them or execute adapter-supplied code.
Existing package imports remain supported and retain their complete lineage.

Only a package matching the selected base/adapter identity may analyze text.
An installed matching package is hash-verified again when loaded. Multiple
matching packages require an explicit choice. First visit and opening the
selector do not create model storage or persist preferences; changing the
source is an explicit preference action. The reviewed public download catalog
is unchanged. Clinical adapter weights are not bundled or redistributed;
their release LICENSE restricts use to the research group.

`src/nextmedtator/model-package.mjs` validates:

- `format: nextmedtator-model-v1`, package ID/version and exact `onnxruntime-web` version.
- Immutable base model revision: a 40-character commit or 64-character content hash.
- Optional adapter SHA-256, matching base revision, `merged-export` or equivalent exported graph, and explicit separately trained-head identity (or `unchanged`).
- License identifier/notice; exact size and SHA-256 for every file.
- Provider-specific variants, graph paths, external weight data and numerical fixtures.
- App-owned codec identity. Model packages cannot supply arbitrary JavaScript or WASM.

Live runs retain the manifest hash, package ID, complete base/adapter/head lineage, artifact hashes, and the selected variant declaration alongside backend, precision, and runtime version. The worker result must match that package and variant before a run is accepted. These identities enter run fingerprints and portable exports; machine comparison snapshots reject mixed package or variant configurations even when their model name/version match.

Five application codecs are implemented:

- `gliner25-small-records-v5` consumes the requested small export with combined encoder/boundary/classification graph plus attributes, records and relation heads. It runs exact anchors, enum scoring and anchored text/span fields with supporting evidence. `recordParent` and `recordAnchorLabel` in a family declare explicit external record-query mappings. Source-score discrepancies withhold automatic relations in this release; packages declaring `automaticRelations: true` are rejected. See `QUALIFICATION.md` for the pinned export, source checks and limitations.
- `tensor-conformance-v1` executes supplied tensor fixtures. It cannot read clinical text.
- `gliner25-records-v1` consumes the standalone export. Adapted packages require merged adapter lineage; original checkpoints declare `unadapted-export` and unchanged heads. Both require a masked 512-word axis, source null logits and an explicit abstention threshold. It shares the app's anchored-record decoder while keeping the small-package contract unchanged. The exporter checks source occurrence spans/scores and all four graph outputs; structured-head numerical checks do not qualify every source record-decoding policy. Automatic relations remain disabled.
- `gliner25-boundary-span-v1` tokenizes with the package's Unigram `tokenizer.json`, builds the GLiNER2 entity prompt, and runs a boundary ONNX pair (`encoder` then `boundary`) in the local ORT worker. Decoding is half-open word spans, sigmoid threshold 0.5, abstention when the null head exceeds 0.5, and the `flat` overlap policy. The largest member may be 768 MiB so the published fp32 base encoder fits. The archive stays within 1 GiB.
- `gliner25-boundary-structured-v1` adds `explicit.onnx`, the `score_explicit_spans` head exported from `fastino/gliner2.5-base-v1`. Enum fields are prompt labels of the form `field: value`, scored at each retained span and reduced with softmax. The word axis of that graph is fixed at 512 and shorter windows are masked.

The span codec fills occurrence anchors, concept text, and a score. The structured codec also fills schema enum attributes. Neither predicts measurement value or unit, or relations, and neither is a Clinical-Evidence LoRA evaluation. `*` in `capabilities` means any schema family may be used as a zero-shot span label. A conformance-only package still fails `qualifyForSchema` with `CLINICAL_RUNTIME_UNQUALIFIED`.

## Package layout

```text
manifest.json
encoder.onnx
encoder.weights
reference-fixture.json
```

A fixture has explicit input tensor type, shape and values, plus expected output tensors and declared absolute/relative tolerances. Keep fixtures synthetic or approved for distribution. Downloadable models must not contain clinical examples accidentally copied from development data.

Span fixtures instead declare `kind: gliner25-boundary-span-v1`, source `text`, prompt `labels`, and the complete `expected` occurrence list. Each expected occurrence must include `label`, `text`, and exact half-open Unicode code-point `start`/`end` offsets. Conformance compares the full occurrence multiset: extra spans, missing repeated mentions, and misplaced mentions fail. Older text-only fixtures must be regenerated with offsets and their package hashes updated. Span scores are reported but this fixture does not qualify numerical scores or enum attributes.

The flat overlap policy resolves candidates across all family labels and again across document windows. Identical boundaries with different labels cannot both survive.

Do not use the synthetic unit-test graph bytes as a real ONNX model. Those bytes exercise validation only; no numerical inference success is claimed.

## Qualification required from the external exporter

1. Native baseline outputs for the agreed Clinical-Evidence grammar.
2. Exact tokenizer, word segmentation, schema encoding and sequence budgeting.
3. All structured heads, constrained decoding, contextual fields and relations needed for the advertised capabilities.
4. Long-note windowing and source-offset mappings, with cross-window limitations.
5. Browser WASM parity against native outputs and numerical fixtures; WebGPU separately qualified.
6. Baseline and merged-LoRA packages tied to the same source/schema evaluation protocol.
7. Real package sizes, latency and peak memory on target machines.

Prefer one loaded package at a time for baseline-versus-adapter comparison. Graph hashes and adapter lineage identify the artifact but do not authenticate an untrusted publisher. The checked-in catalog is application-owned and reviewed with the static release; untrusted projects cannot add installation URLs.

## Runtime limitations

Local file import is bounded to 1 GiB total and 768 MiB per member in this preview, but buffering and worker copies can require substantially more RAM. Public artifacts download through an allowlisted, pinned Hugging Face catalog with byte progress and cancellation; hash-verified installation uses a separate IndexedDB store with old versions retained. Local ZIP import and ORT worker transfers still buffer bytes and need RAM. R2 publication requires operator infrastructure. Runtime modules and WASM binaries must come from the same pinned ORT distribution. The worker never falls back to an HTTP inference service.

Analyze selected sends the package once to a worker, validates its hashes and creates its ONNX sessions once, then processes notes sequentially with those sessions. The worker terminates after completion, failure, timeout, or cancellation. Finished note results remain available if a later note fails; unprocessed notes do not receive a completed run.

Live analysis first runs public fixtures once per selected package/variant in the current session. A conformance failure prevents document analysis. Browser restart revalidates selected installed files and conformance; it does not substitute cached predictions for live inference.
