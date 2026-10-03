# External model-package handshake

Model training, LoRA preparation, merging, quantization and ONNX export stay in a separate project. This repository does not fine-tune models or call inference APIs.

`src/nextmedtator/model-package.mjs` validates:

- `format: nextmedtator-model-v1`, package ID/version and exact `onnxruntime-web` version.
- Immutable base model revision: a 40-character commit or 64-character content hash.
- Optional adapter SHA-256, matching base revision, `merged-export` or equivalent exported graph, and explicit separately trained-head identity (or `unchanged`).
- License identifier/notice; exact size and SHA-256 for every file.
- Provider-specific variants, graph paths, external weight data and numerical fixtures.
- App-owned codec identity. Model packages cannot supply arbitrary JavaScript or WASM.

Three application codecs are implemented:

- `tensor-conformance-v1` executes supplied tensor fixtures. It cannot read clinical text.
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

Prefer one loaded package at a time for baseline-versus-adapter comparison. Graph hashes and adapter lineage identify the artifact but do not authenticate an untrusted publisher. A future approved catalog needs a trusted release process.

## Runtime limitations

Local file import is bounded to 1 GiB total and 768 MiB per member in this preview, but buffering and worker copies can require substantially more RAM. Large-package streaming/persistent installation and a public R2 catalog are not implemented. Runtime modules and WASM binaries must come from the same pinned ORT distribution. The worker never falls back to an HTTP inference service.

Analyze selected sends the package once to a worker, validates its hashes and creates its ONNX sessions once, then processes notes sequentially with those sessions. The worker terminates after completion, failure, timeout, or cancellation. Finished note results remain available if a later note fails; unprocessed notes do not receive a completed run.
