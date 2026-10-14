# Model precision choices

Two explicit download formats are available for each model. Open **Assistance →
Load the model → Model options → Download format**.
Changing the choice starts no download and does not replace the active model.
Unload an active model, then click **Download** to use a different format. Installed packages can be selected again
without a network transfer.

| Choice | Intended benefit | Execution and limitations |
|---|---|---|
| FP32 | Original numerical reference | Automatic WebGPU with FP32 WASM fallback; CPU can be selected explicitly |
| FP16 | Roughly half the download | Main graph FP16 with required FP32 operations and FP32 input/output; separate attribute graph stays FP32. Needs `shader-f16` WebGPU support |

| Model | FP32 package | FP16 package |
|---|---:|---:|
| P10 | 721.4 MiB | 368.7 MiB |
| BPSD | 724.9 MiB | 372.2 MiB |

The app shows the **actual backend and precision**, including after fallback.
The device recommendation chooses FP16 for compatible WebGPU or FP32 otherwise. Precision variants keep the same complete model prompt,
threshold, tokenizer, applicability rules, and token budget.

### Diagnosing a Mac GPU conformance failure

Chrome on an M3 Pro / macOS 26 has been reported to initialize both FP16 models
but fail their reference checks. That message alone does not establish whether
the mismatch is numerical or changes predicted spans/attributes. The FP16
synthetic references were recorded on the Windows/NVIDIA device described below;
the record score tolerance is currently `0.0001`. It has not been widened based
on the Mac report.

Preview.17 adds **Model Options → Check GPU Compatibility**. Load the FP16 package
first; if it is cached, no model download is needed. This checks only the model's
reference fixtures, returns the actual mismatches, releases its worker, and never
downloads a CPU fallback or analyzes the open note. **Save GPU Report**
exports model/runtime identity, browser version, fixture pass/fail status and
numeric differences. It excludes note text, annotations and predicted records.
Reports from an ordinary Analyze failure are also available there.

Confidence-only differences are distinguished from changed spans, changed
attributes, token counts and tensor mismatches. A failed diagnostic does not
authorize inference: Analyze still runs its mandatory checks and retains WASM
fallback. Native Mac acceptance remains pending actual device measurements.

On 2026-10-14, both real FP16 packages passed this diagnostic in Chrome 155 on
the Windows/NVIDIA test machine. A separately injected confidence-only mismatch
verified the failure report and export UI. Neither check downloaded model files,
analyzed the open note, or retained its inference worker. The test is
`tests/browser/test_gpu_check.py`; screenshots and reports are saved in ignored
`temp/browser-validation/gpu-check/`.

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

| Model / cases | FP32 WebGPU | FP16 WebGPU | FP32 WASM |
|---|---:|---:|---:|
| P10, four notes | 0.50–0.59 s | 0.63–0.66 s | 1.11–1.17 s |
| BPSD, no FP32 entities | 0.27–0.28 s | 0.29–0.31 s | 0.85–0.86 s |
| BPSD, FP32 entities and attributes | 2.02–2.25 s | 2.05–2.30 s | 1.45–1.51 s |

FP16 improves download size, **not warm inference speed on this machine**.
The runtime may place unsupported operators on CPU; selecting WebGPU does not
claim every operator runs on the GPU.

See [the complete measured results](validation/precision-2026-10-13.json) for
package sizes, initialization, individual timings, output differences, GPU
submission counts, and actual synthetic predictions.

## INT8 experiments (removed)

INT8 was offered as an experimental download from Preview.7 and removed on
2026-10-14. It changed predicted spans, was slower than FP32 WASM on the test
machine (1.63–2.47 s versus 0.85–1.51 s warm), and could not use Auto Apply,
which is now the default review mode. The app rejects INT8 packages on import or
load. The findings below are kept as a record.

Dynamic INT8 activation quantization changed too many outputs to use as automatic
recovery. Quantizing only encoder matrices while preserving FP32 embeddings and
task heads still changed spans in two P10 notes and three BPSD notes. Quantizing
embeddings as well reduced bytes further but did not resolve output disagreement.

The published experimental option therefore used **weight-only INT8** with FP32
activations. Its purpose is download compression; it does not claim INT8 compute
acceleration or reduced runtime memory. WASM can expand weights to FP32 internally.
Spans and attributes matched in three of four P10 notes and two of four BPSD
notes. P10's remaining note gained one span; BPSD lost one span in each of its
two nonempty notes. Maximum confidence changes among matching spans were 0.184
and 0.200 respectively. The different outputs also change the work performed,
so INT8 timing is not a comparison of identical predictions.
Its separate synthetic fixtures checked reproduction of its own outputs, not
equivalence to FP32. Auto Apply and bulk application were unavailable for it.

An additional mixed FP16 conversion retaining normalization and task heads in
FP32 passed ONNX checking but failed browser initialization, so it was not published.

## Reproduce

With the original pinned public exports under `work/final-r2-{p10,bpsd}`:

```powershell
uv run --project tools/gliner-onnx --locked python tools/gliner-onnx/convert_precision.py
uv run --locked python tests/browser/benchmark_webgpu.py --repeats 3
uv run --locked python tests/browser/benchmark_webgpu.py --precision fp16 --backend webgpu --repeats 3
uv run --locked python scripts/package_precision_models.py
uv run --locked python scripts/report_precision_benchmark.py
node scripts/build_production.mjs
uv run --locked python tests/browser/test_precision_workflow.py
```

`package_precision_models.py --archives` additionally writes local
model ZIPs. Publication copies only public artifacts and explicitly fictional
fixtures into immutable R2 prefixes; no research notes are included.

The workflow test requests downloads, runs real inference, injects an unavailable
GPU adapter, downloads and verifies the original FP32 fallback, reviews a suggestion,
exports, and reopens each precision run. It asserts zero model/catalog requests
at startup and no note egress. `--live` repeats against the deployed site and R2.
Raw screenshots and receipts are kept in gitignored
`temp/browser-validation/precision-{local,live}/`.

On 2026-10-13, all six local flows and all six live flows passed, including the
since-removed INT8 path. The committed
[workflow receipts](validation/precision-workflow-2026-10-13.json) record the
production deployment, real runtime provenance, startup download checks, and
review/export/reopen results for both models and those three execution paths.
The current workflow test covers FP16 WebGPU and the FP32 WASM fallback.
