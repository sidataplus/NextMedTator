# Model downloads and device recommendations

The annotation app remains static. A separate `nextmedtator-downloads` Cloudflare
Worker protects model delivery from the existing R2 bucket. It performs no
inference and receives no notes, annotations, or device capability profile.

## User flow

1. Follow the four steps: open a note, choose a model, load it, analyze and review.
   P10 is first and selected by default. Browser detection requests an adapter
   but creates no GPU device or model session.
2. FP16 is recommended when WebGPU exposes `shader-f16`; otherwise FP32 is
   recommended. Explicit CPU selection recommends FP32. Overrides and device
   details are in **Model options**. INT8 is experimental and never recommended.
3. Click **Download P10/BPSD** to request catalog metadata and the selected package.
   Matching installed packages instead offer **Load installed**, with no transfer.
4. Download opens an on-demand Turnstile check. Chrome uses a credentialless
   frame. Firefox/Safari offer **Open verification tab**. This same-origin page
   embeds the existing protected model-host check without app COEP isolation.
   A random per-request BroadcastChannel carries the token back in memory;
   matching origin, source and nonce are required. The app acknowledges receipt,
   the verification tab closes, and download continues. Cancellation works from
   either tab. The annotation app retains cross-origin isolation for WASM.

5. Download bytes and measured ETA are followed by integrity verification and
   IndexedDB installation/read-back verification. **Analyze note** then prepares
   the worker, checks files, builds the tokenizer, compiles each graph, and runs
   reference checks. Initialization is indeterminate; no invented ETA is shown.

No model or Turnstile request occurs on first load or variant selection. Installed
model files load only on request. The FP16 grant also covers its exact original
FP32 fallback, so GPU failure can recover during the requested analysis without
another check while the grant remains valid.

## Enforcement

- The route `nmt-models.sidata.plus/*` runs before R2 delivery, with fail-open disabled.
  The bucket's `r2.dev` endpoint is disabled. Direct artifact URLs require authorization.
- `/grant` bounds the request body and calls canonical Cloudflare Siteverify. It
  requires `success === true`, action `model_download`, and exact hostname
  `nmt-models.sidata.plus`. Network, JSON, and validation failures deny access.
- The resulting HMAC grant lasts two hours and is bound to the requesting IP and
  selected immutable revision (plus the pinned FP32 fallback when applicable).
  Only an HMAC of the IP appears in the grant. The browser keeps grants in memory
  and sends them in the Authorization header, never in URLs or local storage.
- Only catalog-listed files are served. Responses stream directly from R2;
  large files require ranges of at most 8 MiB. Full hashes remain checked locally.
- Rate-limit bindings allow five verification attempts and 240 artifact requests
  per minute per IP. These are Cloudflare-location limits, not global quotas.
  Shared networks can hit limits; the client explains how to retry. CAPTCHA and
  rate limits deter abuse but cannot eliminate human-assisted or distributed abuse.

Cloudflare processes the verification and connection metadata under its normal
service policies. External verification is requested only for public downloads.
Local import, installed models, annotation, and inference need no CAPTCHA.

## Deployment and maintenance

Source/config: `deployment/download-worker/`. Run
`node scripts/prepare_download_worker.mjs` after reviewing catalog changes to
regenerate the exact artifact allowlist. Deploy both Worker modules and the
`wrangler.jsonc` bindings. `TURNSTILE_SECRET` and `GRANT_SECRET` live in Worker
secret bindings; preserve them during updates. The public sitekey is committed.
The initial grant key is domain-separated from the newly created widget secret;
rotate both when rotating that credential. Never put secrets in source or logs.

Preserve the generated Pages CSP and isolation headers. Only
`/download-verification.html` detaches COEP; it loads no notes or application code. The app permits a frame
and connections only to the model host; Turnstile scripts execute within that frame.
For rollback, keep the protected Worker while restoring a compatible app build.
An older app without authorization support cannot download through the gate;
installed packages and local import continue working.

## Validation (2026-10-13)

Current four-step UI and verification-tab regression: installed Chrome 155,
installed Firefox 155, and WebKit 26. Transport tests use an inert check and a
rejected synthetic token; they do not solve a live CAPTCHA. See
[guided workflow validation](GUIDED-ASSISTANCE.md). The earlier live check below
validated the unchanged Worker and embedded Chrome path.

- Real, user-approved Turnstile flow → protected P10 FP16 R2 download (369 MiB) →
  local installation/read-back hashes → two synthetic-note WebGPU suggestions.
- Real BPSD FP32 local import → initialization cancellation → retry → five
  synthetic-note WASM suggestions. The worker is released after both stop and finish.
- Browser tests cover CPU recommendations, INT8 disclosure, no downloads on
  startup/selection, an inert verification-frame cancellation, and named loading stages.
- Worker unit tests reject bad signatures, expired grants, wrong IP/revision,
  wrong Turnstile action/hostname/success, malformed responses, and oversized ranges.
- Real-token replay was not separately exercised; replay rejection relies on
  Cloudflare's single-use Siteverify contract. This is a remaining validation limit.

Screenshots and browser report: gitignored `temp/browser-validation/download-ux/`.
Run `node --test tests/unit/*.test.mjs`, then serve the production build at port
4299 and run `uv run --locked python tests/browser/test_download_ux.py`.

References: [Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/),
[Worker rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
[R2 streaming API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
