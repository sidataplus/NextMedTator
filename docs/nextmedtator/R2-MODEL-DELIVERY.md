# Merged BPSD model delivery through R2

This application runs inference on the device. R2 distributes immutable model
files only. No inference service, note upload, paid compute, or model training is
required. Both the original annotation assistance panel and the evidence review
workspace can explicitly download and install an application-approved package.

The qualified model is `na399/bpsd-gliner2.5-base-lora-20261012` at
`5cb60383b4b8dd361841e307e54f6e17b68b6fa7`, merged into
`fastino/gliner2.5-base-v1` at `ca906247640776a07753514055be9726f9080ead`.
Its separately trained heads are retained. The fp32 model graph SHA-256 is
`2ee92ad268cf7afb1d54c45d2d726b01f3419c6488061755d872fc2766f85774`;
the attribute graph is
`30615f4d6ae37f1fc6d44b7420ce4a88ca23a38add7a5c02470d00cc7a7ff9a2`.
See [the browser contract qualification](ENTITY-CONTRACT-BROWSER.md) for
native/merged/ONNX/WASM parity, overlap, attribute applicability and capacity.

## Separate private qualification from delivery

The private model qualification archive contains synthetic source-note fixtures.
**Do not upload that archive or its extracted directory to R2.** The release
preparer checks its exact hash and selects only these artifacts:

- The unchanged merged `model.onnx` and `attributes.onnx`.
- The unchanged `tokenizer.json` and `entity-contract.json` derived from public,
  pinned Hugging Face schema/settings. No private DTD additions are published.
- An audited seed-431 random-latent numerical attribute-head fixture, with no
  source-note text, encoder input token IDs, screenshots or annotations.
- A manifest with source hashes and aggregate qualification counts, Apache-2.0
  and DeBERTa MIT license texts, provenance notices and a license audit receipt.
  Inert notice files are hashed, downloaded and stored with the package, so
  recipients retain complete license texts offline.

Compile the public contract independently using `compile_entity_contract.py`
and the exact downloaded adapter's public JSON files. Then run:

```sh
python scripts/prepare_bpsd_r2.py prepare \
  --archive /private/qualified-bpsd.nmt-model.zip \
  --public-contract /private/public-hf-contract.json \
  --out work/r2-prepared
```

Output contains a directory named by the canonical manifest SHA-256 and a
`publication-plan.json` with each object's bytes/hash. Upload only the named
directory's allowlisted objects to its exact
`nextmedtator-models/<manifest-sha256>/` prefix. The plan itself stays local.
Never overwrite files under an existing prefix. Changed bytes require a new
manifest revision and a newly qualified release.

The preparer supports this exact qualified archive. A new export requires new
private source/browser qualification and a review of the allowlist and hashes.
Stripping note fixtures preserves the qualified inference tensors but changes
the package identity. Download-time conformance tests numerical heads only;
the UI explicitly says so. Numerical and span parity do not establish clinical
accuracy, omission rates or safe clinical use.

## Destination and access prerequisites

The repository's `wrangler.jsonc` names `nextmedtator` and a Pages `dist` output
directory. It does not identify a Cloudflare account, deployed site, R2 bucket,
custom domain, or public-access setting. It is not evidence of a deployed Pages
site. Verify the existing account, site hostname, bucket and model hostname
read-only before applying configuration or uploading. No credentials belong in
source, catalog JSON, application files, command arguments or transfer bundles.

This client supports **public read-only HTTPS model downloads**, omits cookies
and Authorization, and rejects R2 redirects and query-string URLs. Restricted
Cloudflare Access/S3/presigned delivery is not implemented by this path; do not
silently enable public access as a workaround. The owner must choose the intended
access level and authorize any access changes. No bucket, paid resource or new
security grant is created by the preparer or build.

For an already authorized public endpoint, prefer an existing R2 custom domain.
Cloudflare describes `r2.dev` as a rate-limited development endpoint.
[Cloudflare public-bucket documentation](https://developers.cloudflare.com/r2/buckets/public-buckets/).

For cross-origin browser downloads, the bucket/domain needs reviewed CORS with:

- `AllowedOrigins`: the exact deployed application HTTPS origin; no wildcard.
- `AllowedMethods`: `GET`, `HEAD`.
- `AllowedHeaders`: `Range` if required by a preflight.
- `ExposeHeaders`: `ETag`, `Content-Range`, `Content-Length`, `Accept-Ranges`.

Preserve other existing authorized origins/rules when reviewing a change.
CORS governs browser reads; it does not make a private bucket public or prevent
non-browser access. Existing cached responses may need a reviewed purge after a
CORS change. [Cloudflare CORS documentation](https://developers.cloudflare.com/r2/buckets/cors/).

Serve immutable object URLs with `Cache-Control: public, max-age=31536000,
immutable`. Preserve identity encoding, byte ranges, ETag and correct MIME types
(`application/octet-stream` for ONNX, `application/json` for JSON). A custom-domain
cache rule may be needed for ONNX; do not assume the extension is cached by
default. Never apply a wildcard caching rule to note/project destinations.

## Build and browser integration

After the exact existing model hostname and access route have been verified,
generate application-owned catalog metadata:

```sh
python scripts/prepare_bpsd_r2.py catalog \
  --prepared work/r2-prepared \
  --origin https://VERIFIED-MODEL-HOST \
  --out work/reviewed-r2-catalog.json
NMT_MODEL_CATALOG=work/reviewed-r2-catalog.json pnpm build
```

`NMT_MODEL_CATALOG` is an explicit, local build input containing public metadata,
not credentials. The build validates exact immutable URLs, adds the catalog entry
to the static app and adds only that model origin to `connect-src`. Without this
input the existing catalog and CSP are retained; no R2 destination is invented.
The app's strict public `models/` directory allowlist remains in force. Weight
objects stay outside the static site and its service-worker asset inventory.

The site must preserve CSP, `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`, including module-worker assets.
R2 CORS permits model reads under COEP; do not relax site isolation to bypass
missing CORS. The browser downloads objects in bounded 8 MiB ranges, checks
Content-Range and stable exposed ETags, then verifies full SHA-256 before an
atomic IndexedDB installation and readback. A server that ignores Range can
provide one full bounded response. Partial/corrupt downloads never install.

In the annotation assistance panel or review workspace, choose **Show approved
public model**, then **Download and install bpsd-gliner25-base-r2**. The source
selection follows the actual manifest lineage. Changing source during a download
prevents that download from becoming the active model. Abort is available. Model
and note requests remain separate; analysis uses local ORT/WASM only.

## Release qualification and unresolved remote checks

The private qualified export passed 30 source cases/139 spans and a 32-case
Chromium 151/WASM parity corpus including 1024-token success and 1025-token
rejection. Single enum axes use native softmax without an attribute threshold;
unsupported attributes remain absent. No relations or private DTD defaults are
inferred. This release is for a capable desktop: the prior dedicated qualification
observed about 5.4 GiB peak renderer PSS. Mobile, low-memory devices, Safari,
Firefox, WebGPU, non-isolated performance and native OS file-picker behavior
remain unqualified.

Before a deployed release, confirm actual site/account/bucket/domain and access
status, object bytes/hashes and notices, GET/HEAD/206 behavior with the site's
Origin header, exposed ETag/Content-Range, CSP and isolation. In the deployed
browser use synthetic data locally to test download/install, exact adapter
inference, accept/export/reopen and stored-model restoration with the model host
blocked. Inspect requests for note text or unexpected endpoints. Install the app
cache separately and test a full offline restart. A local two-origin HTTPS/CORS
test is useful evidence, but does not prove real R2 or deployed-site behavior.

The public model card declares Apache-2.0 for the base and MIT for DeBERTa.
The adapter owner has authorized delivery; the adapter repository has no declared
public license, so its general downstream reuse grant remains unspecified.
See `licenses/model-delivery/` for exact source references and full notices.
