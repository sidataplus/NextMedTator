# Bulk annotation: resource measurements and resumable work

This benchmark runs the real P10 and BPSD FP32 packages in desktop Chrome on
Windows. It measures the entire test browser process tree, including its
renderer, workers and GPU process. It does not substitute JavaScript heap size
for RAM or estimate CPU usage from elapsed time.

## Results — October 13, 2026

Windows, Chrome 155.0.8059.40, Intel Xeon Silver 4210R (20 logical processors), NVIDIA RTX A4000, approximately 64 GiB RAM. Original FP32 throughout; 100 short synthetic notes per run. CPU percentages below are averages of the whole 20-processor machine.

| Model | Mode | 100-note time | CPU time | Avg machine CPU | Peak resident RAM | Peak private commit |
|---|---|---:|---:|---:|---:|---:|
| P10 | Low CPU / WASM 1 | 424.4 s | 444.4 s | 5.2% | 5.81 GiB | 6.34 GiB |
| P10 | Balanced / WASM 4 | 131.3 s | 511.6 s | 19.5% | 5.89 GiB | 6.45 GiB |
| P10 | WebGPU | 74.8 s | 83.7 s | 5.6% | 6.62 GiB | 6.91 GiB |
| BPSD | Low CPU / WASM 1 | 418.8 s | 438.1 s | 5.2% | 6.64 GiB | 7.21 GiB |
| BPSD | Balanced / WASM 4 | 142.5 s | 560.5 s | 19.7% | 6.67 GiB | 8.29 GiB |
| BPSD | WebGPU | 141.6 s | 84.8 s | 3.0% | 8.04 GiB | 8.26 GiB |

Balanced was about three times faster than Low CPU, with roughly four times the instantaneous CPU load and similar peak resident memory. P10 WebGPU was fastest. BPSD WebGPU and Balanced had similar elapsed times in this single pass; WebGPU used much less total CPU time but more peak host RAM. GPU VRAM is not included.

### Memory after shutdown

Every run terminated its inference worker after both completion and cancellation. Values below are observed 30 seconds later, without forced garbage collection. Cancellation is a second job stopped after ten completed notes; the first job’s results remain loaded.

| Model | Mode | After completion | Cancellation peak | After cancellation |
|---|---|---:|---:|---:|
| P10 | Low CPU / WASM 1 | 1.45 GiB | 5.34 GiB | 1.45 GiB |
| P10 | Balanced / WASM 4 | 1.42 GiB | 5.36 GiB | 1.52 GiB |
| P10 | WebGPU | 1.45 GiB | 6.63 GiB | 1.49 GiB |
| BPSD | Low CPU / WASM 1 | 1.46 GiB | 5.36 GiB | 1.42 GiB |
| BPSD | Balanced / WASM 4 | 1.42 GiB | 5.37 GiB | 1.44 GiB |
| BPSD | WebGPU | 1.54 GiB | 6.64 GiB | 1.61 GiB |

Resident memory fell to **1.42–1.61 GiB**. The model, loaded notes and completed review history intentionally remain available; this is not a claim that every allocation is freed or that long-duration leak testing is complete. The JSON includes pre-import/model-loaded baselines, private commit, 0/5/15/30-second observations, and full-session peaks.

### Output comparison

| Model | Predictions per run | Notes with different spans/attributes, Balanced vs Low | WebGPU vs Low | Maximum matched confidence difference, WebGPU vs Low |
|---|---:|---:|---:|---:|
| P10 | 337 | 0 / 100 | 0 / 100 | 5.6028366e-06 |
| BPSD | 151 | 0 / 100 | 0 / 100 | 1.5616417e-05 |

All six runs completed 100/100 notes. Both WebGPU runs used the WebGPU backend rather than fallback. All six cancellation checks stopped after ten notes, retained completed results, and enabled Resume unfinished. No unexpected page errors, resource-counter errors or external note/model requests occurred. Short-lived process snapshot races are recorded separately in the JSON.

[Machine-readable measurements](validation/bulk-100-resources-2026-10-13.json) include hashes, runtime identity, CPU seconds, resident/private peaks, output differences and sampling limitations. Screenshots and full traces are saved locally under `temp/browser-validation/bulk-100/`.

All six measurements used one frozen build. The release adds one report-only
guard: a job originally run in Blind mode keeps prediction counts redacted even
after switching the current mode. The timed inference and checkpoint commit
code is identical; both asset versions are recorded in the release validation.

## Reproduce

1. Build with `node scripts/build_production.mjs` and serve `dist` on port 4299:
   `uv run --locked python scripts/serve_static.py --directory dist --port 4299`.
2. Put the original exported packages in `work/p10.nmt-model.zip` and
   `work/bpsd.nmt-model.zip`. The benchmark imports them explicitly through the UI.
3. Run `uv run --locked python tests/browser/benchmark_bulk_resources.py` on
   Windows with desktop Chrome installed. Optional `--profile p10|bpsd` and
   `--mode low|balanced|gpu` restrict the run. Do not run other inference workloads
   or rebuild the app during measurement.
4. Run `uv run --locked python scripts/report_bulk_resources.py` to generate the
   committed summary from the six raw reports. Raw traces, completion reports,
   and screenshots go to gitignored `temp/browser-validation/bulk-100/`.

Each model uses its committed 100-note corpus in `tests/fixtures/bulk-100-*.json`:
four fictional note templates with unique synthetic case IDs and filenames.
Both models receive the same text: 70–91 characters (11–15 whitespace-separated
words) per note, including the case prefix.
The corpus hash must match across the three execution modes. These short notes
exercise the workflow; they are not 100 diverse clinical cases or a clinical
accuracy evaluation.

## Measurement method

Each mode starts a fresh Chrome process and imports the same original FP32
package. Low CPU uses one WASM thread; Balanced uses four; WebGPU uses the
qualified FP32 GPU path with the Low CPU setting for any fallback. The test
explicitly selects CPU/WASM for the two CPU rows. The CPU-usage selector alone
does not disable automatic WebGPU in normal use. The test
requires actual WebGPU execution for the GPU comparison. Model initialization
and conformance checks are included in the 100-note job time. File import is
measured separately. Browser recovery is off during resource measurement; its
serialization and storage costs are not included.

The local export packages include their source-note conformance fixtures.
Public packages with a reduced fixture set can have different startup-check
overhead, even with the same model weights.

The sampler uses a 250 ms delay between Windows process-counter readings;
reading the counters adds overhead, and actual intervals are recorded. CPU time is the sum of
user and kernel time across the Chrome process tree. **100% core CPU** means one
logical processor occupied throughout the interval. **Machine CPU** divides
that figure by the machine's 20 logical processors. Low CPU limits ONNX WASM
threads; other browser work still uses CPU.

Resident memory is the sum of process working sets. Shared pages can be counted
more than once. Private bytes measure private committed memory, not resident
RAM. GPU VRAM is excluded. Sampled peaks are lower bounds; processes that exit
before their first sample may be missed. Observed snapshot/open races are
recorded in `transientProcessExits` rather than silently discarded. See
[Windows process memory counters](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-process_memory_counters_ex)
and [process CPU times](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes).

After completion, the test observes memory at 0, 5, 15 and 30 seconds. It then
starts a second 100-note job and pauses after at least ten finished notes,
checking the same intervals again. There is no forced garbage collection or
working-set trimming. The app must terminate its inference worker after both
paths. The loaded model, corpus, and completed prediction history remain
available and therefore still consume memory.

These are single-pass measurements on this machine, not statistical performance
guarantees. Output comparison checks all returned spans and attributes against
Low CPU and separately reports matched confidence differences.

## Queue behavior

The [local-model tutorial](../../tutorial/02-local-models.md#step-4--try-bpsd-or-a-batch)
covers selection, progress/ETA, per-note status, pause/resume, failed-note retry,
and the JSON completion report. Processing stays sequential and reuses one
inference session. Queue metadata does not copy source text or predictions.

Reload recovery is opt-in through **Local recovery & backups**. Checkpoints are
requested every ten processed notes and on pause/completion. Wait for the
verified checkpoint status before closing. A crash can require repeating work
since the last checkpoint. Recovery never starts a model download or inference
automatically. Resume validates source and model/settings identity, skips
completed notes, and allows changing the execution device or CPU limit.

Run `uv run --locked python tests/browser/test_resumable_queue.py` against the
local site to validate real-model pause, checkpoint/reload, resume without
replaying completed runs, settings mismatch rejection, retry after an injected
transient worker failure, and completion-report export. Only this fault test
injects an error; the resource benchmark uses unmodified real model execution.
