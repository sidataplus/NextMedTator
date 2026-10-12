# Static distribution procedure and remaining gates

Serve only the generated `dist/` directory as a static site. The local Wrangler
configuration names a Workers static-assets deployment; a deployed account/site
has not been verified. A selected Cloudflare Pages or Workers destination must
preserve the generated isolation and CSP headers. No Flask/Python backend,
inference API, paid compute or native model runtime is required in the deployed
site. No deployment was performed for this review. Keep restricted adapters,
private user schemas and note files local.

## Reproducible preparation

Use Node 22.16 or newer, pnpm 10.18.3, uv and Rust 1.90.0 with the
`wasm32-unknown-unknown` target. Install from the committed lockfiles:

```sh
pnpm install --frozen-lockfile
uv sync --locked
pnpm lint
pnpm build
pnpm build:preview
pnpm test
uv run --locked --project tools/gliner-onnx python -m unittest discover -s tools/gliner-onnx/tests
uv run --locked python -m unittest discover -s tests/validation
pnpm audit:assets
uv run --locked python tests/browser/test_legacy.py
uv run --locked python tests/browser/test_model_selection.py
uv run --locked python tests/browser/test_model_source_edits.py
uv run --locked python tests/browser/test_reliability.py
```

`build` includes the original annotation UI; `build:preview` is the separate
engineering workspace. Build before running browser checks, and leave outputs
unchanged during each check. Serve with `pnpm preview:legacy` on loopback rather
than opening `index.html` through `file://`. The development server also defaults
to loopback, debug off, and local dependency URLs. Syntax lint is intentionally
limited; it is not a full security/style audit.

The static build copies required npm runtime files, CSS, fonts, images and
license notices rather than entire dependency source/test/documentation trees.
It retains existing legacy static assets pending further audit. The generated
SHA-256 inventory verifies every distributed file and the service worker caches
only that public app inventory. Only reviewed public catalog metadata/fixtures are copied from `models/`; added weights, schemas or symlinks cause the build to fail. Model packages use a separate local model store.
Export a project backup before changing a site/version or deleting browser data.

## Cloudflare Pages configuration

Use `pnpm build` as the build command and `dist` as the output directory, with
the toolchain above provisioned in the build environment. Alternatively build
locally and upload the **contents** of `dist`, preserving `_headers`, the asset
manifest, workers, vendor directories and WASM files. Request release/deployment
authorization before either upload. The site uses relative asset paths and a
scoped service worker, so a prefix deployment must retain the trailing slash.

Cloudflare applies the generated `_headers` to static responses. Preserve CSP,
COOP `same-origin`, COEP `require-corp`, `nosniff` and the referrer policy. Serve
`.wasm` as `application/wasm` and JavaScript modules with a JavaScript MIME type.
HTTPS and cross-origin isolation support worker/WASM use; isolated Chromium uses
up to four WASM threads. A single-thread fallback is a separate path to test.
See Cloudflare's [headers](https://developers.cloudflare.com/pages/configuration/headers/)
and [asset limits](https://developers.cloudflare.com/pages/platform/limits/).
Each Pages asset is limited to 25 MiB; the build audits that limit. Large model
weights are deliberately absent from the site.

The approved public catalog obtains model assets from immutable Hugging Face
URLs with credentials omitted and verifies lengths/hashes. Those responses need
working CORS, including any redirected CDN host, and must be allowed by CSP.
A CSP allowlist alone does not prove CORS availability. Local package import and
offline installation avoid runtime Hub requests. Test live catalog downloads
separately on the final hostname; do not proxy notes through a backend. BPSD
and research-group-only adapters must remain outside hosted assets/catalogs.

## Tested boundaries and release risks

Real ClinicalEvidence small LoRA export under the locked CPU environment and
actual Chromium ORT Web fixtures/offline inference/review/export/reopen were
executed during this review. Historical base-model qualification files in the
PRs remain historical evidence; they are not a new run of that base adapter.
The exact BPSD adapter ran natively and its imported predictions were reviewed
in the browser; the separate declarative codec now has actual local browser parity evidence; see [its tested boundaries](ENTITY-CONTRACT-BROWSER.md). See
[BPSD workflow and licenses](BPSD-NATIVE.md).

Synthetic reference agreement, tensor parity and functioning controls do not
establish clinical safety or accuracy. Private DTDs may contain extra
annotation-only fields and defaults; omitted predictions must not acquire those
defaults. Existing unrelated annotations and run provenance must survive review
and export. Do not infer relations or cue attribution from unqualified heads.

The large BPSD base-model path is qualified only on the measured desktop Chromium host, with its private model imported locally. Remaining gates include a deployed Cloudflare smoke test (headers/MIME/CORS),
live catalog downloads, Firefox/Safari and target mobile performance, constrained
memory behavior, adapter redistribution rights, legacy asset/security audit,
and clinical validation. Restricted weights and private user schemas are not
part of the code distribution. No release should claim those gates have passed.
## R2 model delivery

The merged BPSD adapter can be delivered as immutable ONNX objects separately
from static application assets. See [R2-MODEL-DELIVERY.md](R2-MODEL-DELIVERY.md)
for the audited publication allowlist, licensing, explicit catalog/CSP build
input, download integrity and required remote verification. Keep source notes,
private DTDs, screenshots and private qualification archives out of public R2.
