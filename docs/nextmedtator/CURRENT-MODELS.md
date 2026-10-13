# Current model packages and static release

The compiled site's `index.html` opens the original MedTator annotation UI.
Loading schemas, notes, editing spans, and exporting XML retain the existing
workflow. Local assistance is optional; the evidence workspace is an additional
review interface. No hosted Python process or inference API is required.

## Pinned models

| Selection | Adapter commit | Base commit | Inference contract |
|---|---|---|---|
| `clinical-p10` | `ffd6e47bd55de93dcc3fcabbb65533ad7ba32991` | `54785d51df8d86a0d8f2eb212fec15871aad2c4d` | Seven families, 21 complete queries, threshold 0.25, 512 encoded tokens, 384 source words, flat overlap |
| `bpsd-base` | `5cb60383b4b8dd361841e307e54f6e17b68b6fa7` | `ca906247640776a07753514055be9726f9080ead` | Complete entity/attribute schema, threshold 0.5, 1,024 encoded tokens, overlapping entities allowed |

Both selectors offer these explicit presets. Existing startup preferences are
retained. Neither model is routed through the older clinical-v3 schema. P10
retains `clinical_finding`, planned assertion, and unspecified time. Oversized
notes are rejected without truncation; segment them deliberately before use.
Changing the output schema does not remove any queries from the trained prompt.

Export once using the standalone locked CPU environment:

```sh
uv run --locked --project tools/gliner-onnx gliner-onnx --selection clinical-p10 --out work/p10.nmt-model.zip --report work/p10-export.json
uv run --locked --project tools/gliner-onnx gliner-onnx --selection bpsd-base --out work/bpsd.nmt-model.zip --report work/bpsd-export.json
```

`--release-dir` and `--base-dir` reuse cached source/base files. P10's entire
release manifest, weights, ontology, and vendored runtime are hash-verified
before importing its Python runtime. All exports verify active-adapter versus
merged predictions, complete attributes, and native versus ONNX output. The
exporter uses Torch 2.6 CPU; this is independently checked export parity, not
a claim to reproduce P10's original Torch 2.11 training environment.

In the original UI load a DTD whose tag names match the contract's family IDs
and whose attribute enums retain the complete model vocabulary. Import the
model in the assistance panel, then Analyze using Assisted or Auto apply.
Existing DTD defaults are not predictions. `test_requested_legacy.py` generates
matching DTD examples under the ignored `test-results/legacy-*/` directories.

## Build and compiled release

```sh
pnpm install --frozen-lockfile
uv sync --locked
pnpm build
pnpm audit:assets
uv run --locked python scripts/package_static_release.py
```

Use Rust 1.90.0 with `wasm32-unknown-unknown` for the reproducible core build;
a newer default Rust installation can coexist with this pinned toolchain.
uv 0.12.19 and 0.13 are supported. The compiled ZIP and SHA-256 sidecar are
written under `work/releases/`. Extract the ZIP directly into the static
hosting root. It contains the original UI, local runtime/WASM, `_headers`,
service worker, and hashed asset inventory. It excludes ONNX and adapter weights.
Cloudflare Pages can build with `pnpm build` and serve `dist/`; the checked-in
Wrangler configuration also serves `dist/` as static assets. Preserve `_headers`
so COOP/COEP and CSP apply to the page, modules, and workers.

## R2 objects and application catalog

Prepare separate immutable object sets after real-model qualification:

```sh
uv run --locked python scripts/prepare_model_r2.py --archive work/p10.nmt-model.zip --report work/p10-export.json --out work/r2-p10
uv run --locked python scripts/prepare_model_r2.py --archive work/bpsd.nmt-model.zip --report work/bpsd-export.json --out work/r2-bpsd
uv run --locked python scripts/model_catalog.py --prepared work/r2-p10 work/r2-bpsd --origin https://YOUR-MODEL-DOMAIN --out work/r2-catalog.json
```

Set `NMT_MODEL_CATALOG=work/r2-catalog.json` in the build environment, then rebuild
and repackage. The build adds only that HTTPS model origin to CSP. Upload the
objects listed in each `publication-plan.json` to their exact
`nextmedtator-models/<manifest-sha256>/` prefix. Do not overwrite an existing
prefix. Preparation and catalog commands perform no upload or access change.
The model license notice is retained; P10 remains a restricted research model.

The preparer excludes source-note fixtures and encoded text inputs. Downloads
check a random-latent numerical attribute fixture; source parity is qualified
separately. Both objects and license notices are hash-bound. Keep object URLs
immutable, use identity encoding and `Cache-Control: public, max-age=31536000,
immutable`, and expose ETag/Content-Range for range downloads. Configure CORS
for the exact application origin and GET/HEAD. See [R2 delivery](R2-MODEL-DELIVERY.md)
for the access prerequisites and deployment checks. This client currently uses
public read-only HTTPS URLs without cookies or Authorization; private
Access/presigned delivery requires additional work. No account, bucket, or
production hostname is assumed by the compiled release.

## Windows validation, 2026-10-13

The public deployment is https://nmt.sidata.plus, with both immutable model
packages at https://nmt-models.sidata.plus. Build its catalog configuration
with `pnpm build:production`; publish `dist/` to the `nextmedtator` Pages
project. Delivery settings are recorded in `deployment/cloudflare.json`.
Disable response compression on the model hostname to preserve ranged model
bytes, and disable injected analytics on the application hostname. Keep the
generated `_headers` file. Screenshots and synthetic-note test reports are
saved under ignored `temp/browser-validation/`.

Chrome 155 passed the public R2 download, full artifact hashes, chunked
IndexedDB installation/readback, reload with the model host blocked, actual
WASM inference in the original UI, and evidence-project export/reopen for
both packages. The two workflows observed only GET requests without note
content. Download progress shows percentage, transferred/total size, and
estimated time remaining; verification and installation use activity bars.
Model downloads require an explicit "Download and install" action. Fresh
startup requests neither model weights nor the model catalog; an existing
installed model is restored from browser storage without a network download.
`tests/browser/test_deployed_models.py` captures each stage. A separate real
browser storage regression checks a 140 MiB value, missing-chunk rejection,
and removal with `tests/browser/test_model_storage.py`.

Chrome 155 on this host passed actual WASM fixtures and all four fictional
native/merged/ONNX/browser cases for each model, including exact attribute
values/presence. Both passed Analyze, Accept, Export, and Reopen. WASM used
four threads under cross-origin isolation. Preview.6 qualifies complete WebGPU
entity and attribute inference for both immutable exports. The application
records its execution policy separately from the original WASM package variant,
including a hash-verified BPSD axis conversion when using WebGPU. Automatic
execution falls back to WASM on GPU failure; original installed packages work
without another download.

See [WebGPU measurements and recovery](WEBGPU.md) for per-note GPU/WASM speeds,
exact output comparisons, conversion provenance and reproduction commands.
These cases are technical regressions, not clinical accuracy estimates,
exhaustive model validation, or performance guarantees on other machines.
Reports and screenshots remain in ignored `temp/browser-validation/`; model
artifacts remain in `work/`.

The original MedTator assistance panel is separately exercised by
`tests/browser/test_requested_legacy.py`: it loads the matching DTD, uses the
normal Analyze button, and checks auto-applied spans and enum values against
the actual native model output.
