# Build, integration and rollback

The fork preserves the original MedTator annotation screen and adds an assistance column and portable evidence workspace. Changes are additive; manual annotation needs no installed model. Python renders templates only at build time. Production serves static `dist/` files with no inference service.

The parity branch starts from `sidataplus/NextMedTator` main at `2c774f90cbfb9ff6b945b8bd8e1639378e1fe4fe`. It includes the existing uv/dependency refresh so the PR and CI use the same locked tooling. Original upstream source/license history is retained.

```sh
corepack enable
pnpm install --frozen-lockfile
uv sync --locked
pnpm deps:verify
rustup toolchain install 1.90.0 --profile minimal --component rustfmt --target wasm32-unknown-unknown
pnpm build:core
pnpm test
pnpm build
pnpm audit:assets
uv run --locked python -m playwright install chromium
pnpm test:legacy
pnpm build:preview
pnpm test:browser
uv run --locked python tests/browser/test_wasm_backend.py
uv run --locked python tests/browser/test_legacy_recovery.py
uv run --locked python tests/browser/test_recovery_faults.py
uv run --locked python tests/browser/test_review_fixes.py
uv run --locked python tests/browser/test_parity_edges.py
pnpm test:dom
pnpm audit --audit-level high
```

Builds precompile repository-owned Vue templates, externalize scripts, sanitize Vue HTML output and copy pinned local runtime files. The inventory rejects static files over Cloudflare's 25 MiB limit. Large public model weights stay outside `dist/`; the reviewed catalog supplies immutable download URLs. `preview/` is a standalone engineering workspace, with the same local runtime/decoder but without the legacy page.

`test_legacy.py` includes synthetic real-ORT worker tests and familiar UI/sanitizer/chart checks. `test_preview.py` exercises review, independent snapshots, comparison, recovery, offline workflow, Unicode/XML and canaries on a real origin. DOM-only checks explicitly substitute hash/UUID helpers and cannot qualify storage/CSP/workers. `test_real_small.py` and `test_legacy_assist.py` require the real pinned package; see `QUALIFICATION.md`. CI's optional real-model dispatch downloads actual weights and fails on missing artifacts or failed conformance.

`test_clinical_scope.py` runs broad and user-defined clinical scopes with the actual P4 package in the original UI, including native auto apply, immutable history, export and corpus recovery. The scope editor pins the training registry; `scripts/verify_clinical_scope.py` independently checks its complete field/vocabulary projection and exported semantic schema with the upstream validator. See [CLINICAL-SCOPE.md](CLINICAL-SCOPE.md) for usage and reproduction.

Legacy native export/open carries source, loaded schema, manual labels/binary links, model history, blind snapshots, exposure and decisions. Representability losses remain explicit in XML interchange; native bundles are authoritative. Public installed packages can be selected in both workspaces. Clinical recovery requires consent; model storage is separate. The WASM architecture follow-up replaces recovery writes with transactional SQLite-WASM in OPFS and routes bulk validation/comparison through Rust-WASM workers. Original-screen corpus autosave is added to the existing assistance panel. See [WASM-BACKEND.md](WASM-BACKEND.md) for storage, migration, export and rollback details.

## Release operations

`wrangler.jsonc` targets `dist/` as Workers Static Assets without a Worker handler. No production deployment or account/domain/R2 resource is created by builds/tests. Public hosting/R2 setup requires the operator's infrastructure and acceptance gates; this PR does not claim a deployed release.

Retain prior immutable app and model artifacts. Upgrade at explicit release boundaries. The service worker does not call `skipWaiting`, and active review is not silently migrated. Keep previous installed model versions, select the old manifest and rerun its fixtures for rollback; the installed-package test exercises this. Rehearse production app rollback with retained `dist/` plus an exported native project before public release. Schema revisions use explicit preview/loss reports, retain the prior project, and refuse stale previews.

Locked dependency installation, asset hashes/notices, qualified model fixtures and dependency audits remain release gates. Compatibility/security exceptions are in `DEPENDENCIES.md`; executed evidence and external gates are in `STATUS.md`.
