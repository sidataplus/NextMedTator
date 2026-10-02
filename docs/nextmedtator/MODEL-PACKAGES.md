# External model-package handshake

Model training, LoRA preparation, merging, quantization and ONNX export stay in a separate project. This repository does not fine-tune models or call inference APIs.

`src/nextmedtator/model-package.mjs` validates:

- `format: nextmedtator-model-v1`, package ID/version and exact `onnxruntime-web` version.
- Immutable base model revision: a 40-character commit or 64-character content hash.
- Optional adapter SHA-256, matching base revision, `merged-export` or equivalent exported graph, and explicit separately trained-head identity (or `unchanged`).
- License identifier/notice; exact size and SHA-256 for every file.
- Provider-specific variants, graph paths, external weight data and numerical fixtures.
- App-owned codec identity. Model packages cannot supply arbitrary JavaScript or WASM.

The only implemented codec is `tensor-conformance-v1`. It can execute supplied tensor fixtures using the local ORT worker once dependencies are installed. It **cannot** tokenize clinical documents or reproduce GLiNER2.5 structured occurrence decoding. Both API and UI refuse to advertise it as clinical inference.

## Package layout

```text
manifest.json
encoder.onnx
encoder.weights
reference-fixture.json
```

A fixture has explicit input tensor type, shape and values, plus expected output tensors and declared absolute/relative tolerances. Keep fixtures synthetic or approved for distribution. Downloadable models must not contain clinical examples accidentally copied from development data.

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

Local file import is bounded to 1 GiB total and 512 MiB per member in this preview, but buffering and worker copies can require substantially more RAM. Large-package streaming/persistent installation and a public R2 catalog are not implemented. Runtime modules and WASM binaries must come from the same pinned ORT distribution. The worker never falls back to an HTTP inference service.
