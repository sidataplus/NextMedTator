# Small-model qualification and reproduction

This report qualifies the executed Linux Chromium/WASM paths and records remaining gates. It does not certify clinical quality, target-device performance or a LoRA that has not been supplied.

## Artifact identities

| Artifact | Pin |
|---|---|
| Requested ONNX export | `nicolasembleton/gliner2.5-small-v1-onnx@5e2e3f51adfb0eeb7c1f83464400b4d498d41659` |
| Independently loaded source checkpoint | `fastino/gliner2.5-small-v1@7132dc4561c3f94563c6147e75ffa8ef34c4964a` |
| Official source inference code | `fastino-ai/GLiNER2@55656fbfa01d3d4a77485e1a1eeeaf682990ccdf` |
| Adapted host modules | `Pastel-Org/gliner2.5-onnx-webgpu@9f8173223d84bb65e6952d070137a990f93ef298` |
| Browser runtime | ORT Web 1.23.2, `wasm-fp32`, one thread |
| Executed browser | Chromium 151.0.7922.173, Linux cloud CPU |
| Native reference runtime | ONNX Runtime CPU 1.30.0 |

Apache-2.0 notices are retained. Artifact paths, bytes and SHA-256 appear in `models/catalog.json`. The consumer archive is 313,519,734 bytes (about 299 MiB); installation may need at least twice that space and considerably more RAM while importing/running. Do not confuse installed bytes or JS heap with total browser/worker peak memory.

## Reproduce the consumer path

From the repository root with locked development dependencies installed:

```sh
uv tool run --from huggingface_hub==2.1.1 hf download \
  nicolasembleton/gliner2.5-small-v1-onnx \
  --revision 5e2e3f51adfb0eeb7c1f83464400b4d498d41659 --local-dir work/small
uv run --locked python scripts/package_gliner25_small.py \
  --source work/small --out work/small.nmt-model.zip
pnpm build
pnpm build:preview
NMT_SMALL_PACKAGE="$PWD/work/small.nmt-model.zip" uv run --locked python tests/browser/test_real_small.py
NMT_SMALL_PACKAGE="$PWD/work/small.nmt-model.zip" uv run --locked python tests/browser/test_legacy_assist.py
uv run --locked python tests/browser/test_recovery_faults.py
uv run --locked python tests/browser/test_parity_edges.py
```

The real-model test fails if the artifact is absent; it never substitutes constant graphs or reports an absent artifact as a pass. CI offers a `workflow_dispatch` `real_model` switch to execute this gate, while normal PR CI runs all weight-free contract, recovery and browser tests. Local model weights and clinical projects are ignored.

Independent native tensor references can be regenerated in an isolated **external validation** environment, without training/exporting weights:

```sh
uv run --no-project --with onnxruntime==1.30.0 --with tokenizers==0.22.2 --with numpy==2.5.3 \
  python scripts/qualify_gliner25_small.py --source work/small --out tests/fixtures/gliner-small-native.json
uv run --no-project --with onnxruntime==1.30.0 --with numpy==2.5.3 \
  python scripts/qualify_gliner25_heads.py --source work/small
```

The optional `check_gliner25_source.py` and `check_gliner25_source_heads.py` accept `--source` pointing to the pinned original checkpoint and require the pinned official source runtime separately. The executed external runtime used PyTorch 2.6.0 CPU and Transformers 4.57.6. Source results are frozen as public/synthetic fixtures. Model preparation, adapter merging and export remain external.

## Conformance policy and observed results

Token IDs, source offsets, compiler fixtures and retained anchor/field/evidence outputs match exactly. Independent native outputs specify absolute and relative tolerances of 1e-4 per output; the browser checks shapes and finite values as well as numerical error. Every graph is tested, including fixed-shape attributes and dynamic record/relation heads. Those tensor checks test graph execution; source-output fixtures separately test preprocessing and host decoding.

The source card has four exact entities, with source/browser confidence differences below 1e-4. The source record example preserves `MacBook Pro`, `$1999` and `Liquid Retina display`, including exact supporting spans. The contextual fixture retains both diabetes mentions and the source's negated/unknown/patient labels. The mother/patient label is a source-model error, demonstrating why conformance cannot establish clinical accuracy.

The source relation edge matches after correcting query routing, but confidence differs by 0.004642. This exceeds the existing budget and is **not passed numerical source parity**. Automatic relations are disabled; their source preparation/decoding discrepancy must be resolved and new fixtures reviewed before enabling them. The app supports manual/imported relations independently.

The published `heads.onnx` distance feature has a frozen divisor of 48. The official source scorer divides by the current word dimension. `diagnose_gliner25_relations.py` compared both scorers with identical deterministic inputs at 6, 16, 48 and 96 words: only 48 passed the prespecified tolerance (maximum logit error 1.49e-7). Other lengths had errors 0.014005, 0.002928 and 0.000607. This identifies an external export defect; it does not qualify a special 48-word application mode or alter the downloaded graph. The diagnostic intentionally requires that the known defect reproduce and must be revisited for a new artifact.

To reproduce in the pinned official-source runtime with `onnx==1.20.1` and `onnxruntime==1.30.0`:

```sh
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 python scripts/diagnose_gliner25_relations.py \
  --source work/source-checkpoint --export work/small
```

A corrected producer release must preserve dynamic distance normalization and pass source fixtures at multiple input lengths before the application enables automatic relations. Model export and preparation remain in the separate project required by the PRD.

Native CPU cold session creation was about 1.0 s; warm encoder inference about 23–25 ms for the small source card. The 1,000-document Chromium switch probe was 165 ms p95 in the final concurrent-suite run (101 ms in the earlier run), 30 samples, under the 300 ms engineering threshold. Neither result is a target-device or clinical-workflow claim. Repeat on the required Mac and Windows devices and measure whole-process peak memory, model cold/warm browser inference, long-note behavior and cancellation under real load before release approval.

## Operational rollback

Install a new package as a separate immutable manifest identity. Keep the old installed package. Select the old version, run its fixtures and reopen a portable project; saved prediction layers retain their original package identity. Failed/cancelled/corrupt installation must not remove the prior version. `test_parity_edges.py` exercises cancellation, quota rollback, two installed versions and deletion of the new version while reopening the old one.

For app rollback, retain the previous immutable `dist/` artifact and deploy it at an explicit release boundary using the operator's Cloudflare release process. Never migrate private projects destructively or replace an active review silently. Reopen an exported native project under the retained compatible app/model. No production account/domain or R2 bucket was provided or deployed in this change; a production rollback drill remains an operator gate.

Executed numerical maxima and workflow results are retained in `qualification-results.json`; full generated records/videos are excluded from version control and remain local/CI artifacts.
