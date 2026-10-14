# WebGPU and automatic WASM fallback

This page records the original FP32 qualification. Preview.7 adds selectable
FP16 packages; see [precision choices and fresh benchmarks](PRECISION.md).
FP16 falls back to the original FP32 WASM package, downloading it on an explicit
Analyze request if it is not already installed. Install FP32 first for offline recovery.

NextMedTator preview.6 runs both pinned P10 and BPSD packages through WebGPU,
including entity extraction, attribute scoring and final decoding. **Automatic**
is the default. Under **Assistance → Load the Model → Model Options → Run On**, select
**CPU · WASM** to use the CPU explicitly. The panel and exported run record the
backend actually used.

Downloading remains explicit. Opening the site or choosing a practice task
does not download weights. Existing installed packages work without downloading
a replacement package.

## Measurements on this machine

Measured October 13, 2026, on Windows, NVIDIA RTX A4000 (Ampere), Intel Xeon
Silver 4210R, Chrome 155.0.8059.40, ONNX Runtime Web 1.23.2. WASM used four
threads with cross-origin isolation. Each backend processed the same four
fictional notes three times. The table uses the median of passes two and three.

| Model / synthetic case | Records | WebGPU | WASM | WASM time ÷ GPU time |
|---|---:|---:|---:|---:|
| P10 / 0 | 2 | 516 ms | 1,147 ms | 2.22× |
| P10 / 1 | 2 | 510 ms | 1,112 ms | 2.18× |
| P10 / 2 | 5 | 568 ms | 1,129 ms | 1.99× |
| P10 / 3 | 3 | 621 ms | 1,159 ms | 1.87× |
| BPSD / 0 | 0 | 297 ms | 865 ms | 2.92× |
| BPSD / 1 | 0 | 275 ms | 862 ms | 3.13× |
| BPSD / 2 | 5 | 2,252 ms | 1,513 ms | 0.67× |
| BPSD / 3 | 2 | 2,022 ms | 1,452 ms | 0.72× |

**GPU is not always faster.** P10 benefited across these cases. BPSD's attribute
work outweighed the GPU encoder savings on the two notes with detected entities;
WASM was faster on those notes. These are small technical benchmarks, not
performance guarantees for other note lengths, browsers or devices.

Times include tokenization, both graph stages, decoding and worker messaging.
They exclude weight download and session initialization. Loading and verifying
the in-memory package took about 9.5 seconds on GPU versus 9.1–9.2 seconds on
WASM. The first GPU inference also compiles shaders. The UI creates a fresh
worker for each analysis batch and releases it afterward; a single-note click
therefore includes initialization. Batch notes share sessions.

Across all 24 note executions per backend, spans, offsets, entity families and
attribute values/presence matched exactly. Maximum absolute GPU/WASM confidence
differences were **0.00000230 for P10** and **0.00001121 for BPSD**, below the
declared `1e-4` tolerance. Native source comparisons also passed. Actual GPU
queue submissions were observed in both attribute fixtures (84 P10, 35 BPSD)
and every full inference. WASM submitted none. The WebGPU execution provider
can place unsupported operators on CPU; this is not a claim that every operator
runs on GPU.

The [machine-readable report](validation/webgpu-2026-10-13.json) includes all
synthetic texts, timings, confidence differences and GPU submission counts.
Synthetic parity checks do not establish clinical accuracy.

## BPSD axis correction

The original BPSD attribute export encodes two `CumSum` axes as `int64`.
The pinned runtime's native WebGPU path raises a tensor type mismatch at that
boundary. P10 already encodes the equivalent axes as `int32`.

The application applies a deterministic conversion only to the exact qualified
BPSD attribute graph. It adds two scalar `int32` axis initializers and rewires
those two inputs. Learned weights, thresholds, schemas and numerical precision
are unchanged. Original package and manifest hashes remain intact. The worker
verifies both the original graph hash and the transformed graph hash before
creating a GPU session. WASM uses the original graph.

- Source attribute SHA-256: `ac37764700eabbb6ccd1fd95cdc8041836439a86dbf98ecf1c913cc67281909c`
- GPU attribute SHA-256: `1b382abf7125fe2d97cc2d3f006af1fca692222eec6dfee720e66ca5c1e19ae8`
- Transformation: `bpsd-cumsum-axis-int32-v1`

The native attribute fixture is bit-for-bit identical before and after the
conversion. Exported GPU run provenance records the transformation and both
hashes, as well as the original package identity. The conversion is application
code, not executable code accepted from model packages.

## Recovery behavior

If WebGPU is unavailable, initialization fails, conformance fails, or inference
fails/times out, automatic execution switches to a fresh WASM worker. It verifies
the CPU session before continuing. Only the unfinished note is retried; completed
notes and human review decisions are preserved. A failed GPU backend stays
disabled for that package in the current runner. Reloading the app permits a new
attempt. Cancellation stops work without triggering a fallback.

The UI reports **WASM · automatic fallback**, and portable exports retain the
fallback reason. Changing **Run On** to CPU bypasses GPU attempts.

## Reproduce

With the existing pinned exports in `work/` and a production build:

```powershell
uv run --project tools/gliner-onnx --locked python tools/gliner-onnx/qualify_webgpu_axes.py
uv run --locked python tests/browser/benchmark_webgpu.py --repeats 3
uv run --locked python tests/browser/test_webgpu_workflow.py
node --test tests/unit/worker.test.mjs
```

The workflow test runs Analyze → review → export → reopen for both models, then
repeats with GPU adapter failure deliberately injected in the worker. Predictions
always come from the real model. Screenshots and raw reports are saved under
gitignored `temp/browser-validation/`. Deployment verification uses the same
test with `--live` and previously installed public packages.

Runtime references: [ONNX Runtime WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
and the upstream [CumSum tensor-type issue](https://github.com/microsoft/onnxruntime/issues/26618).
