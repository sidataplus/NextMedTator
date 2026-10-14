# Browser model storage and FP16 fallback

Preview.16 fixes a failure reported on an M3 Pro with 36 GB RAM running macOS 26:
an installed FP16 model switched to FP32 WASM, then analysis stopped with
“Model storage write failed” or “Model installation cancelled or storage unavailable”.

FP16 is a WebGPU package. If GPU initialization or reference checks fail, automatic
execution needs the separate original FP32 package for WASM. The GPU error was
previously hidden, and successful persistent installation was required before the
downloaded fallback could run. RAM capacity does not establish the cause of a GPU
or browser-storage failure. The original Mac's GPU error has not been captured.

## Behavior

- Model downloads still require an explicit Load or Analyze request.
- Storage writes and read-back checks use at most 16 MiB per chunk, with one write
  transaction in flight. The writer no longer queues a whole model or allocates a
  second complete model buffer for read-back verification.
- Package metadata is published after every chunk passes verification. A failed
  replacement preserves the previous installation; cancellation removes partial
  writes. Web Locks serialize installations across tabs and allow a subsequent
  install to reclaim unpublished chunks left by a crashed tab. Older browsers
  without Web Locks clean up ordinary failures but defer crash-orphan cleanup.
- A verified public download remains usable in memory when caching fails.
  **Ready for this session** explains that it is not installed for offline use.
  An explicit offline-install request still reports failure if storage fails.
- After fallback, the active model becomes FP32. Repeat analysis reuses it without
  downloading again or immediately retrying the failed GPU. Unload releases the
  model reference, and completed/cancelled inference terminates its worker.
- **Why was CPU used?** preserves the actual GPU error in the panel. WebGPU uses
  the same high-performance adapter that passed its FP16 capability check.
- Hash validation, reference checks and cancellation remain mandatory. A storage
  failure is not permission to execute a corrupt package.

## Validation on 2026-10-14

All tests below ran on Windows. They do not establish native Safari or M3 Pro GPU
compatibility.

| Check | Result |
|---|---|
| Chrome 155, Firefox 155, WebKit 26: 140 MiB synthetic artifact | Install/read/remove passed; largest serialized buffer 16 MiB |
| Injected storage-full error | Verified candidate retained for session use |
| Cancellation during replacement | Stopped; previous package preserved; partial chunks removed |
| Missing stored chunk | Rejected as corrupt |
| Existing v2 cache layout | Read and removal remained compatible |
| Actual P10 FP16 WebGPU in Chrome | Passed; 2 suggestions on its synthetic practice note |
| Actual BPSD FP16 WebGPU in Chrome | Passed; 5 suggestions on its synthetic practice note |
| Both models: injected GPU failure, real FP32 download and WASM inference, injected cache failure | Passed in Chrome |
| Repeat Analyze after session-only fallback | Same spans, attributes and scores; zero additional model requests; worker released |

The real-model fallback test serves local copies of the immutable model artifacts
and disables verification only in its intercepted test catalog. It does not solve
CAPTCHA, obtain production grants or mock inference output. WebKit's large ZIP
import closed its test page; a retry using model downloads did not complete within
the test session. Full WebKit inference is therefore **not qualified by this run**.

Reproduce against a local production build on port 4299:

```powershell
node scripts/build_production.mjs
uv run --locked python scripts/serve_static.py --directory dist --port 4299
# In another terminal:
uv run --locked python tests/browser/test_storage_recovery.py
uv run --locked --with selenium python tests/browser/test_storage_recovery_firefox.py
uv run --locked python tests/browser/test_fallback_storage.py
uv run --locked python tests/browser/test_fp16_adapter.py
```

The real-model tests require the local packages in `work/` and the immutable
artifact directories used by the existing precision workflow. Screenshots and
JSON reports are written to ignored `temp/browser-validation/storage-fallback/`
and `temp/browser-validation/storage/`. Inference tests use fictional notes only.
