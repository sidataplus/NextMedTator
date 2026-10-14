# Guided assistance validation

Validated on this Windows machine on 2026-10-13/14. Tests launch the installed
Chrome 155.0.8059.40 and Firefox 155.0 in clean, headless profiles. WebKit 26.0
checks the Safari engine; it is not the shipping Safari browser.

## Real model workflow

Both complete FP32 packages were imported from local files. No inference outputs
were mocked. Each browser analyzed the included fictional P10 and BPSD notes,
reviewed a suggestion, wrote one annotation, and unloaded the model.

| Browser | Actual backend | P10 suggestions | BPSD suggestions | Review/write | Worker released after inference |
|---|---|---:|---:|---|---|
| Installed Chrome 155 | WebGPU | 2 | 5 | Passed for both | Yes |
| Installed Firefox 155 | WASM | 2 | 5 | Passed for both | Yes |

This establishes workflow behavior on synthetic notes, not clinical accuracy,
or a new performance/peak-memory benchmark. Earlier resource measurements remain
in [BULK-RESOURCES.md](BULK-RESOURCES.md).

## Setup and verification

- P10 is the first model and the initial default; saved explicit choices persist.
- Four steps appear in order: open a note, choose a model, load it, analyze/review.
- Model options and More tools start collapsed. Tests cover 1440- and 1024-pixel
  windows, no horizontal panel overflow, keyboard disclosure controls and scrolling.
- Startup and model/precision selection start no model transfer. Loading is explicit.
- A test-only inert verification frame sends a synthetic token through the new
  tab. A substituted grant endpoint rejects it. The dialog closes, explains the
  failure, supports retry, and cancellation works in the app and via the
  verification page's Close button. Chrome, Firefox and WebKit pass this flow.
- The verification page is not isolated; the annotation app remains isolated.
  The page contains no notes. Tokens are relayed only in memory through a random
  per-request BroadcastChannel, never in URLs or persistent storage.
- The earlier approved live Chrome CAPTCHA/R2 check is documented in
  [DOWNLOAD-PROTECTION.md](DOWNLOAD-PROTECTION.md). The new tab tests described
  here do not complete a real CAPTCHA.

## Reproduce

Build with `node scripts/build_production.mjs`, then serve:

```powershell
uv run --locked python scripts/serve_static.py --directory dist --port 4299
uv run --locked python tests/browser/test_guided_assistance.py
uv run --locked --with selenium python tests/browser/test_installed_firefox.py
```

Set `NMT_INFERENCE=1` for real Chrome model tests (requires local
`work/p10.nmt-model.zip` and `work/bpsd.nmt-model.zip`). Firefox runs both by
default; `NMT_SKIP_INFERENCE=1` checks only setup and verification. Set
`NMT_GUIDED_URL` to check a deployed build. Selenium Manager obtains the official
geckodriver; the test uses the installed Firefox application.

Screenshots and JSON reports are in gitignored
`temp/browser-validation/guided-assistance/`. Tutorial recording uses
`tests/browser/record_tutorial.py`; it writes step screenshots in `tutorial/images/`.
