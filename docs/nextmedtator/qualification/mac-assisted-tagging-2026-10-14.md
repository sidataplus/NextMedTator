# Mac Assistance verification, 2026-10-14

Local changes repair corrupt installed-model handling and limit the large BPSD
entity/attribute contract to one WASM thread on WebKit. A user-authorized FP16
confidence tolerance now enables both packages on Apple Metal in Chrome. Installed
Safari P10 and BPSD also pass using FP16 WebGPU after the Mac was unlocked and the test
window kept active. All six requested native browser/profile combinations have
verified suggestions, accepted tags, and exports. These changes have not been deployed.

## Environment and model identity

- User's MacBook Pro M3 Pro, 36 GB RAM; macOS 26.5.2.
- Installed Chrome 155.0.8059.40, Firefox 158.0, Safari 26.5.2.
- Fresh automated WebKit uses Playwright WebKit 26.0; this is distinct from the
  installed Safari application.
- ONNX Runtime Web 1.23.2; original model weights, prompts, decoding thresholds, and FP32 checks
  remain unchanged. Qualified FP16 WebGPU record confidence uses an absolute
  tolerance of 0.05 under execution policy `entity-webgpu-precision-v3`.

| Package | Manifest SHA-256 |
| --- | --- |
| P10 FP32 `clinical-evidence-p10-base-r2` | `0374df44608eef43724d93e0e7f26067fb006e3850a373e0456a0a6b10001223` |
| BPSD FP32 `bpsd-gliner25-base-r2` | `2d7574bf8e467a7c39760981d3729ca5c43b2a6d58937365bbb6a6d69fb0f8a7` |
| P10 FP16 `p10-fp16-r2` | `c7ea1db1cfac952cce65b28175e644af1410070dcf49de931227e67186a14195` |
| BPSD FP16 `bpsd-fp16-r2` | `74e58bc41ce326f310a4d3b1a31e4b4daf34b7b6d4d9093ae0b9acb20efd9ee5` |

Downloaded ZIP manifests and every artifact hash were independently checked
against the production catalog. Tests use the built-in fictional practice notes.

## Observed browser workflows

| Browser | P10 | BPSD | Scope |
| --- | --- | --- | --- |
| Installed Chrome | 2 suggestions, accepted tag, verified export | 5 suggestions, accepted tag, verified export | Production site, FP32 WASM; initial FP16 automatically fell back |
| Installed Firefox | 2 suggestions, accepted tag, verified export | 5 suggestions, accepted tag, verified export | Production site, FP32 WASM |
| Installed Safari | 2 suggestions, accepted tag, verified export | 5 suggestions, accepted tag, verified export | Both patched local FP16 WebGPU; P10 also passed production FP32 WASM |
| Fresh WebKit 26.0 | Not a substitute for the native P10 check | 5 suggestions, FP32 WASM, one thread | Patched local build, 46.2 seconds including package import |
| Fresh Chrome, forced FP32 WebGPU | Not tested with the original FP32 package in this harness | 5 suggestions, manual tag preserved, accepted tag, export/reimport passed | Patched local build, original FP32 package, Apple Metal 3 |
| Fresh Chrome, forced FP16 WebGPU | 2 suggestions, manual tag preserved, accepted tag, export/reimport passed | 5 suggestions, manual tag preserved, accepted tag, export/reimport passed | Patched local build, exact FP16 catalog packages, Apple Metal 3, no fallback |

Seven native exports were reopened with the application's `importBundle()`.
Their member hashes, project contracts, source offsets, suggestion counts, and
human-review records validated. P10's accepted `fever` occupies 16–21 and BPSD's
accepted `No hallucinations` occupies 52–69. The BPSD review retains `negated=yes`.
Local evidence is in `temp/mac-gpu/native-browser-exports.json` and the original
exports in Downloads. This includes the original five FP32 exports and two native
Safari FP16 exports.

The Chrome FP32 WebGPU acceptance report is
`temp/mac-gpu/chrome-fp32-conformance.json`. It verifies the exact catalog manifest,
one declared numerical-head fixture, five practice suggestions, no CPU fallback,
exact preservation of native manual tag `Other/O0` at 0–3, assisted writing, and
export/reimport of both human records and the run. No external requests or page
errors occurred. This package's fixture scope is numerical heads; it does not
qualify clinical accuracy or full-model equivalence.

## Fixes and regressions

- Stored manifest, artifact, and chunk integrity failures have a distinct
  `ModelIntegrityError`; unrelated operational errors retain their identity.
- An online FP16-to-FP32 fallback can replace a corrupt or missing cached original
  package. Offline recovery fails explicitly. The exact requested manifest is
  checked before installation.
- Assistance offers a verified repair download after a failed installed-model
  read. Successful cached reads and offline reinstalls clear the failed-cache
  marker. The selected model source, precision, and annotations are preserved.
- Malformed file metadata can be listed with unknown size and rejected by the
  typed integrity check when read. Matching entries with missing or empty variants
  render a repair action without dereferencing invalid metadata or reading it first.
- WebKit's 1024-word entity/attribute path uses one WASM thread. The uncapped
  seven-thread fresh-engine run stalled in compatibility checks for the bounded
  three-minute test. The patched default completed with five records and recorded
  `runtime.wasmThreads=1`. P10, other codecs, Chrome, and Firefox retain their
  requested thread limits.

Verification completed: 230 unit tests passed, one existing test skipped; lint,
production build, cache-repair UI tests for both profiles, real IndexedDB recovery
tests in Chrome and WebKit, guided verification/cancellation tests in both engines,
original annotation/export regression, and production-CSP startup checks passed.
The guided test waits for the mocked grant request before asserting its 403 UI
error, rather than relying on a five-second rendering assertion to cover the
popup transport retry window.

## FP16 backend tolerance and native Safari memory behavior

Chrome reaches a real Apple Metal 3 adapter with `shader-f16`. Both exact FP16
packages initially failed the original `1e-4` native-record confidence tolerance. Public
fixture spans and attribute categories match. Maximum confidence differences are
approximately 0.01375 for P10 and 0.03767 for BPSD. The separate FP32 attribute-head
reference passes at errors below `1e-6`.

At the user's explicit request, policy v3 allows up to 0.05 absolute drift in
record and attribute confidence for the exact qualified P10/BPSD FP16 WebGPU
artifacts. FP32 and unqualified artifacts retain the `1e-4` default. Spans,
families, attribute values and presence, token packing, encoded token count, and
accept/reject decisions at the original threshold remain exact. Non-finite or
out-of-range confidence values fail. Tensor reference tolerances are unchanged.
This qualifies portable behavior within that bound, not identical scores or
clinical accuracy.

Both FP16 packages passed all five public fixtures, practice inference, manual-tag
preservation, human acceptance, and export/reimport on installed Chrome's real
Apple Metal 3 adapter in a fresh context. P10 preserved manual tag `c0` at 4–11;
BPSD preserved `Other/O0` at 0–3. Neither fell back or requested a remote model.
Report: `temp/mac-gpu/chrome-fp16-conformance.json`. The original strict failure
report remains preserved separately for comparison. Diagnostic UI checks also pass
for both profiles: a deliberately injected 0.06 difference is still rejected and
reported against the 0.05 limit without analyzing notes or downloading a fallback.

Three temporary shader probes tested FP32 accumulation, explicit FP16 `fma`, and
explicit FP16 product rounding. All compiled and ran; none passed the unchanged
checks. FP32 accumulation partially reduced larger errors but worsened two P10
cases. No shader probe was adopted into application code. Reports are under
`temp/mac-gpu/matmul-shader-*.json`; the preserved initial report is
`temp/mac-gpu/chrome-fp16-conformance-baseline.json`.

The package's synthetic FP16 references come from prior candidate browser outputs;
their metadata does not establish the originating browser/OS/GPU. Cross-device
rounding is plausible, not proven as the sole cause. WGSL permits implementation
differences in floating-point evaluation:
<https://www.w3.org/TR/WGSL/#floating-point-evaluation>.

Native Safari's log at 09:06:29 local time reports
`didExceedInactiveMemoryLimit` and `reason=ExceededMemoryLimit` for the owned BPSD
test process. Its footprint included approximately 2737 MB bmalloc and 1942 MB
Gigacage memory. The page became blank before review, including with the patched
thread limit. This is separate from the resolved fresh-WebKit multithreading stall.
Relevant logs are in `temp/mac-gpu/native-safari-termination.log` and the session's
bounded process-specific log output. Later native control reported that the Mac was locked and could not be
automatically unlocked. The user unlocked it and brought Safari forward. Installed
Safari 26.5.2 then passed BPSD on the original FP16 package using WebGPU, producing
five suggestions. Accepted `Hallucination/H0` at 52–69 retained `negated=yes` in the
export, independently reopened with `importBundle()`. This completes the six
native browser/profile workflows; background BPSD FP32 remains memory-limited.
Safari's five public fixtures passed: maximum record-confidence error was
0.0285041 and FP32 attribute-logit error was 1.79e-7. Report:
`temp/mac-gpu/safari-bpsd-fp16-conformance.json`. Native evidence export:
`/Users/na399/Downloads/d027a4b2-c110-4a0e-95d2-d027f22fe8c3.nmt.zip`.

Installed Safari P10 also passed all five fixtures and produced two suggestions
using WebGPU FP16. Accepted fever at 16–21 retained affirmed/patient/current fields
through export/reimport. Maximum reference-confidence error was 0.0087027.
Report: `temp/mac-gpu/safari-p10-fp16-conformance.json`. Native export:
`/Users/na399/Downloads/7a54e8fe-0f3f-4412-b4f9-fe640a6ab840.nmt.zip`.
Firefox was verified using FP32 WASM; FP16 WebGPU qualification here covers Chrome
and installed Safari only.

Five controlled fresh-WebKit FP32 probes measured an 8,584,800 KiB baseline peak
RSS. Disabling prepacking changed it by +0.03%; enabling the CPU arena by +20.35%;
enabling memory patterns by +8.61%; enabling both by +5.05%. All retained the exact
five practice records within strict `1e-4` scores, so none supplied evidence for a
production memory-option change. The eight required outputs totaled only 3.60 MB.
Reports and numerical comparisons: `temp/bpsd-memory-probe/comparison.json`.

## Reproduction

```sh
pnpm build:production
python scripts/serve_static.py --directory dist --port 4299
python tests/browser/test_assist_cache_repair.py
python tests/browser/test_storage_recovery.py
python tests/browser/test_guided_assistance.py
python tests/browser/test_mac_gpu_conformance.py \
  --precision fp32 --profiles bpsd --models-dir /path/to/verified/packages
```

Use the repository-pinned uv/Python environment, the installed Chrome executable,
and an installed Playwright WebKit cache as appropriate. The GPU harness defaults
to FP16 and deliberately returns failure when mandatory conformance fails.
