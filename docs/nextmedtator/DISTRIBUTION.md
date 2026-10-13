# Static distribution

The public app is [nmt.sidata.plus](https://nmt.sidata.plus), served by Cloudflare
Pages project `nextmedtator`. The two public ONNX packages are delivered from
`nmt-models.sidata.plus` on R2. This deployment was exercised in desktop Chrome:
explicit download, integrity verification, installed-package reload, WASM
inference, export and reopen. Notes are processed locally.

## Build and package

Use the locked Node/pnpm, uv and Rust toolchains described in [BUILD.md](BUILD.md).

```sh
pnpm install --frozen-lockfile
uv sync --locked
pnpm build:production
pnpm audit:assets
uv run --locked python scripts/package_static_release.py
```

`build:production` selects `deployment/production-model-catalog.json`, containing
P10 and BPSD. `build` uses the development catalog instead. The release ZIP
contains only the static app, its compiled WASM modules, local browser runtimes,
notices and asset inventory. It does not contain ONNX weights or note files.

Serve the contents of `dist/` over HTTPS, or over HTTP on localhost for local
work. Do not open `index.html` with `file://`. The repository server applies the
required headers:

```sh
uv run --locked python scripts/serve_static.py --directory dist --port 4173
```

## Cloudflare Pages

Upload the contents of `dist/` to project `nextmedtator` on its production
branch `main`. Preserve `_headers` as a file: in a direct multipart API upload
it must have a filename, rather than being submitted as an ordinary text field.
Otherwise Pages can silently omit the response headers.

Verify CSP, COOP `same-origin`, COEP `require-corp`, `nosniff`, JavaScript MIME
and `application/wasm` on the final hostname. Chrome should report
`crossOriginIsolated === true`. Each static file must be under Pages' 25 MiB
limit; the build audits this and records each asset's size and SHA-256.

The repository's `wrangler.jsonc` describes an alternative Workers Static
Assets deployment. It is not the configuration for the current Pages project.
Python renders templates at build time; production has no Python backend.

Generated Vue scripts and the workspace entry use content-hashed filenames so
returning browsers do not mix old rendering code with the current HTML/layout.
App responses use `Cache-Control: no-cache` for HTTP revalidation; the verified
service-worker cache still supports explicit offline use. Keep R2's immutable
model-cache policy separate from this app policy.

## R2 delivery

The app fetches catalog metadata only when requested and weights only after an
explicit **Download and install** action. An installed matching model is read
from local browser storage. The downloader uses immutable object URLs,
credential-free requests, byte ranges, length checks and SHA-256 verification.

R2 CORS allows the configured app origins, `GET`/`HEAD`, and `Range`; response
headers expose range/length/ETag information. Localhost public downloads are
not enabled: import a local model package for loopback testing. Keep model
responses identity-encoded; Cloudflare compression is disabled on the model
hostname so range and length validation remain consistent.

The site-specific analytics injection is disabled on `nmt.sidata.plus` to keep
the static app's CSP and cross-origin isolation intact. These settings apply
to the app/model hostnames, not unrelated sites in the zone.

Model licenses and notices travel with the packages. Public distribution does
not change their terms. Publish only the approved model artifact allowlist;
source notes and qualification archives stay out of R2. See
[R2-MODEL-DELIVERY.md](R2-MODEL-DELIVERY.md) for artifact preparation.

## Release checks and rollback

Run the browser gates in [BUILD.md](BUILD.md) and the
[tutorial workflow](../../tutorial/README.md#reproduce-the-screenshots-and-gif).
Keep the previous Pages deployment and compiled ZIP for rollback. Export a
native project before updating a site or clearing browser storage. Service
worker updates do not force activation during an active review session.

WASM is qualified for these two packages on the measured desktop Chrome host.
Complete WebGPU parity, Firefox/Safari/mobile performance and clinical accuracy
are not established by those checks. Use the recorded synthetic results as
software regression evidence only.
