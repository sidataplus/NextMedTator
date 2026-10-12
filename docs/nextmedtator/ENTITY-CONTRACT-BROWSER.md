# Declarative entity/attribute browser codec

The `gliner25-entity-attributes-v1` codec uses a fixed complete prompt supplied
as a verified JSON model artifact. The app supplies all executable code. This
codec supports single-value softmax groups, explicit attribute applicability,
`allow` or `flat` overlap, and a declared 512- or 1024-token limit including
schema tokens. Oversized input returns `unsupported` with no predictions or
coverage; it is never cropped, truncated or windowed. Empty input is rejected.

Single-value groups retain native choice order when values tie and force one
softmax choice for each applicable entity. Inapplicable fields remain absent;
annotation defaults are not model predictions. The full entity descriptions and
sorted attribute queries are retained even when only some loaded annotation
families are represented. Custom clinical scope prompts require another codec;
the UI offers explicit scope removal while preserving old run provenance.
Literal binding, document labels and relations are not inferred.

## Local acquisition and export

Keep the adapter, base, external schema and outputs in ignored local folders.
Download immutable revisions rather than a moving branch. For the exact tested
BPSD adapter, use the acquisition pins in [BPSD-NATIVE.md](BPSD-NATIVE.md).
The external JSON compiler verifies the declared source artifact hashes and
reproduces the published model contract without reading a private DTD or
executing the downloaded inference helper:

```sh
uv run --locked --project tools/gliner-onnx python scripts/compile_entity_contract.py \
  --adapter work/bpsd-adapter --out work/bpsd-contract.json
uv run --locked --project tools/gliner-onnx gliner-onnx \
  --entity-contract work/bpsd-contract.json \
  --adapter work/bpsd-adapter --base-dir work/bpsd-base \
  --base-model fastino/gliner2.5-base-v1 \
  --base-revision ca906247640776a07753514055be9726f9080ead \
  --adapter-repository na399/bpsd-gliner2.5-base-lora-20261012 \
  --adapter-revision 5cb60383b4b8dd361841e307e54f6e17b68b6fa7 \
  --base-license Apache-2.0 \
  --adapter-license LicenseRef-No-Redistribution-Grant \
  --cases tests/fixtures/lora-clinical-samples.json \
  --out work/bpsd-browser.nmt-model.zip \
  --report work/bpsd-browser-export.json
```

The base folder must contain the five verified runtime files: `config.json`,
`model.safetensors`, `tokenizer.json`, `tokenizer_config.json` and
`encoder_config/config.json`. Their bytes are checked against the immutable Hub
revision. The exporter requires the exact GLiNER2 Git runtime in the lock. It
checks active-adapter versus merged-native outputs before ONNX parity; output
archives publish atomically only after the checks succeed. Output receipts contain
case text and predictions and must remain private.

Import the resulting local package in Models, verify its conformance, then use
Analyze. A loaded annotation schema must retain the complete applicable native
attribute vocabulary. Extra annotation-only fields/relations are not inferred.
The package supplies its frozen threshold and Boolean main-graph mask interface;
these cannot be changed by a per-view threshold override. Model-store restoration
revalidates and reconstructs the same contract from its hashed artifact.

The public regression fixture uses generic synthetic `action`/`report` entities,
`phase`/`owner` attributes and toy spans. The exact BPSD contract, model weights,
private DTD and real-model parity receipts are external local test inputs. Run
`tests/browser/test_entity_contract_model.py` with `NMT_ENTITY_PACKAGE`,
`NMT_ENTITY_REPORT`, `NMT_ENTITY_CAPACITY`, `NMT_ENTITY_PROJECT` and
`NMT_ENTITY_END_FIXTURE` pointing to authorized local synthetic artifacts.

## Tested boundaries

The exact BPSD revision completed active-native, merged-native and CPU ONNX
comparisons on 30 synthetic cases, producing 139 spans. Attribute presence and
labels were exact; maximum active/merged and merged/ONNX score differences were
1.63e-5 and 1.26e-5. Chromium 151 passed the corresponding browser fixtures and
full 30-case comparison. Separate 1024/1025-token cases matched complete/rejected
behavior. The 1024-token filler case produced zero spans; this is a reproducibility
result, not evidence that long-context phenotype recall is good. A learned
attribute-head numerical fixture checks positions beyond word 512 independently
of whether that capacity note produces an entity.

Initial local import/conformance took approximately 66 seconds on the tested
17 GiB Linux host with four WASM threads and cross-origin isolation. Peak renderer
PSS was approximately 5.4 GiB for that gate. This is a large desktop model. Do not
claim mobile, low-memory, Firefox, Safari, WebGPU or non-isolated execution has
been qualified from these results. The 32-case browser batch took about 153 seconds. Model/contract restoration, actual offline Analyze, human acceptance, portable export/reopen and original-UI inference with the external private schema also passed. Detailed local receipts retain those measurements.

The application remains a static site. Model weights are imported/stored on the
user's device, never served as app assets. The public model metadata allowlist
continues to reject unreviewed weights or schemas added under `models/`.
Cloudflare Pages' individual asset limit also precludes placing this large graph
in the static app output. No backend, paid job or model training is required.

The adapter owner subsequently authorized model delivery. The repository still
declares no general public reuse license. [R2 delivery](R2-MODEL-DELIVERY.md)
uses the unchanged qualified graphs and public HF schema while stripping all
source-note fixtures; it preserves base/third-party notices and keeps private
DTD additions and screenshots out of public assets. The verified destination and
access level remain required before uploading. Tensor/offset parity, correct
controls and synthetic reference agreement do not establish clinical validity.
