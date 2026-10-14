# Windows browser verification, 2026-10-14

Validated the production build of `e4301d4` after pulling the Mac changes.
Tests used fresh profiles, fictional practice files, and local packages matching
every production-catalog manifest and artifact hash. No model weights were
downloaded from the public service.

| Installed browser | P10 | BPSD |
| --- | --- | --- |
| Chrome 155.0.8059.40 | FP16 WebGPU, 2 suggestions | FP16 WebGPU, 5 suggestions |
| Firefox 155.0 | FP32 WASM, 2 suggestions | FP32 WASM, 5 suggestions |

Both Chrome packages passed all five public conformance fixtures. Chrome also
preserved an existing manual tag through assisted review, exported the evidence
project, reopened it, and verified both human records and the original machine
run. There were no page errors, fallback attempts, remote model requests, or
external requests in these Chrome workflows. Inference workers were released.

Firefox passed the explicit Assisted review flow, accepted one suggestion per
profile, downloaded the evidence archive, and reopened it through the file
picker. Reopening replaced the workspace project and retained the human record,
machine suggestion count, and runtime backend. Model unload also passed.

Chrome and Firefox passed default-P10 setup, isolated-app verification-tab
handoff, rejection of an inert synthetic token, and cancellation. These tests
did not solve a CAPTCHA or issue a production download grant. Chrome passed
panel layout/disclosure/copy checks and corrupt-cache repair for both models.
Firefox passed system dark mode, persisted overrides, and restoring the system
setting. Startup did not request model weights.

Evidence is gitignored under `temp/browser-validation/`:

- `post-pull/chrome/report.json` and the diagnostic/review/reimport screenshots.
- `guided-assistance/firefox-installed-report.json`, Firefox review/reopen
  screenshots, and the downloaded evidence archives.
- `assistance-copy/`, `assistance-refinement/`, and `theme/firefox-report.json`.

The existing Firefox test needed an explicit Assisted selection because Auto
Apply is now the default. It now also verifies the actual export/reimport path.
This run uses Windows browsers; it does not revalidate native macOS Safari.
