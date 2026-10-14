# Model precision choices

Three explicit download formats are available for each model. Open **Assistance →
Load the model → Model options → Download format**.
Changing the choice starts no download and does not replace the active model.
Unload an active model, then click **Download** to use a different format. Installed packages can be selected again
without a network transfer.

| Choice | Intended benefit | Execution and limitations |
|---|---|---|
| FP32 | Original numerical reference | Automatic WebGPU with FP32 WASM fallback; CPU can be selected explicitly |
| FP16 | Roughly half the download | Main graph FP16 with required FP32 operations and FP32 input/output; separate attribute graph stays FP32. Needs `shader-f16` WebGPU support |
| INT8 weights (experimental) | Smallest download | Per-channel encoder matrix weights and per-row embeddings stored as INT8, dequantized for FP32 computation; task heads remain FP32. Slower in this browser, with changed spans; individual review only |

| Model | FP32 package | FP16 package | INT8 weight package |
|---|---:|---:|---:|
| P10 | 721.4 MiB | 368.7 MiB | 198.1 MiB |
| BPSD | 724.9 MiB | 372.2 MiB | 201.6 MiB |

The app shows the **actual backend and precision**, including after fallback.
The device recommendation chooses FP16 for compatible WebGPU or FP32 otherwise. Precision variants keep the same complete model prompt,
threshold, tokenizer, applicability rules, and token budget.

## Downloads and automatic recovery

Website load, opening a practice note, and changing precision never fetch weights.
**Download** requests metadata and the selected package.

For an installed FP16 package, an explicit **Analyze** request may load the
original FP32 WASM fallback if the GPU is missing, lacks FP16, fails initialization
or conformance, or fails during inference. Selecting CPU also uses this original
FP32 package. If it is missing from browser storage, the app downloads and caches
it with progress and transfer ETA. This additional download is about 721 MiB for
P10 or 725 MiB for BPSD and is disclosed before choosing FP16.

Install the matching FP32 package in advance for **offline WASM fallback**.
Otherwise GPU inference can work offline from an installed FP16 package, but
recovery cannot fetch a missing FP32 package without a connection. Pause cancels
both a pending fallback download and inference. Completed notes are not replayed.
Experimental INT8 is never selected automatically as fallback.

Every run records the actual package hash, variant, precision, runtime, and any
graph correction. FP16 recovery additionally records the requested FP16 package
and fallback reason, while the producer identifies the actual original FP32 model.
Review, export, and reopen preserve these identities.

## Browser measurements

Measured on 2026-10-13 in installed Chrome 155.0.8059.40, Windows,
NVIDIA RTX A4000, Intel Xeon Silver 4210R. WASM uses four threads with cross-origin
isolation. Each model uses four fictional notes, including Unicode and cases
with/without predicted entities. Three passes were run; warm times are medians
of passes two and three, excluding loading and first-pass shader compilation.
The app starts a fresh session per analysis batch, so one-note wall time also
includes model initialization and precision-specific conformance checks.

FP16 kept **all spans and attribute choices on all eight notes**. Maximum
confidence differences versus browser FP32 WASM were **0.00417 for P10** and
**0.02723 for BPSD**. These are small regression cases, not a clinical accuracy
evaluation or a guarantee of agreement on other notes.

| Model / cases | FP32 WebGPU | FP16 WebGPU | FP32 WASM | INT8 weights / WASM |
|---|---:|---:|---:|---:|
| P10, four notes | 0.50–0.59 s | 0.63–0.66 s | 1.11–1.17 s | 1.87–2.06 s |
| BPSD, no FP32 entities | 0.27–0.28 s | 0.29–0.31 s | 0.85–0.86 s | 1.63–1.67 s |
| BPSD, FP32 entities and attributes | 2.02–2.25 s | 2.05–2.30 s | 1.45–1.51 s | 2.22–2.47 s |

FP16 improves download size, **not warm inference speed on this machine**.
The runtime may place unsupported operators on CPU; selecting WebGPU does not
claim every operator runs on the GPU.

See [the complete measured results](validation/precision-2026-10-13.json) for
package sizes, initialization, individual timings, output differences, GPU
submission counts, and actual synthetic predictions.

## INT8 experiments

Dynamic INT8 activation quantization changed too many outputs to use as automatic
recovery. Quantizing only encoder matrices while preserving FP32 embeddings and
task heads still changed spans in two P10 notes and three BPSD notes. Quantizing
embeddings as well reduced bytes further but did not resolve output disagreement.

The published experimental option therefore uses **weight-only INT8** with FP32
activations. Its purpose is download compression; it does not claim INT8 compute
acceleration or reduced runtime memory. WASM can expand weights to FP32 internally.
Spans and attributes matched in three of four P10 notes and two of four BPSD
notes. P10's remaining note gained one span; BPSD lost one span in each of its
two nonempty notes. Maximum confidence changes among matching spans were 0.184
and 0.200 respectively. The different outputs also change the work performed,
so INT8 timing is not a comparison of identical predictions.
Its separate synthetic fixtures check reproduction of its own outputs, not
equivalence to FP32. Auto apply and bulk application are unavailable for this
experimental option; individual suggestion review remains available.

An additional mixed FP16 conversion retaining normalization and task heads in
FP32 passed ONNX checking but failed browser initialization, so it was not published.

## Reproduce

With the original pinned public exports under `work/final-r2-{p10,bpsd}`:

```powershell
uv run --project tools/gliner-onnx --locked python tools/gliner-onnx/convert_precision.py
uv run --locked python tests/browser/benchmark_webgpu.py --repeats 3
uv run --locked python tests/browser/benchmark_webgpu.py --precision fp16 --backend webgpu --repeats 3
uv run --locked python tests/browser/benchmark_webgpu.py --precision int8 --backend wasm --repeats 3
uv run --locked python scripts/package_precision_models.py
uv run --locked python scripts/report_precision_benchmark.py
node scripts/build_production.mjs
uv run --locked python tests/browser/test_precision_workflow.py
```

Use `--int8-mode dynamic` only to reproduce the rejected activation-quantization
experiment. `package_precision_models.py --archives` additionally writes local
model ZIPs. Publication copies only public artifacts and explicitly fictional
fixtures into immutable R2 prefixes; no research notes are included.

The workflow test requests downloads, runs real inference, injects an unavailable
GPU adapter, downloads and verifies the original FP32 fallback, reviews a suggestion,
exports, and reopens each precision run. It asserts zero model/catalog requests
at startup and no note egress. `--live` repeats against the deployed site and R2.
Raw screenshots and receipts are kept in gitignored
`temp/browser-validation/precision-{local,live}/`.

All six local flows and all six live flows passed. The committed
[workflow receipts](validation/precision-workflow-2026-10-13.json) record the
production deployment, real runtime provenance, startup download checks, and
review/export/reopen results for both models and all three execution paths.
