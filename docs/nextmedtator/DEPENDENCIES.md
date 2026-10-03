# Dependency refresh and compatibility exceptions

The new static build resolves JavaScript packages and serves local assets instead of fetching CDN code at runtime. These are explicit upgrade targets, **not a claim that every dependency is the latest available or security-qualified**.

| Dependency | Inherited configuration | New direct pin | Reason |
|---|---|---|---|
| Flask | unpinned | 3.1.3 | Build-only security-fix release |
| Vue | 2.6.11 | 2.7.16 | Final 2.x API; preserve legacy interactions |
| jQuery | 3.4.1 | 3.7.1 | Compatible 3.x API; 4.x migration deferred |
| jQuery UI | 1.12.x | jquery-ui 1.14.1 | Official package; `jquery-ui-dist` stops at 1.13.3 and has no 1.14.1 release |
| CodeMirror | 5.62.x | 5.65.20 | Preserve editor API |
| Font Awesome | 5.15.3 | 5.15.4 | Preserve icon names |
| JSZip | unversioned CDN | 3.10.1 | Pin legacy export helper |
| FileSaver | 2.0.0 | 2.0.5 | Pin download helper |
| Day.js | 1.8.36 | 1.11.13 | Updated compatible date helper |
| PapaParse | 5.3.1 | 5.5.3 | Updated CSV parser |
| js-yaml | 4.1.0 | 4.3.2 | 4.x parser with merge-key CPU fixes |
| D3 | floating v7 | 7.9.0 | Pin the v7 renderer |
| ECharts | 5.3.3 | 6.1.0 | Patched XSS advisory; legacy chart families exercised in Chromium |
| DOMPurify | absent | 3.4.16 | Patched sanitizer advisories; application sanitization exercised in Chromium |
| SQLite-WASM | absent | 3.53.4-build2 | Official browser-local SQLite/OPFS runtime |
| ONNX Runtime Web | absent | 1.23.2 | Candidate browser tensor-conformance runtime |

Public primary references inspected include Flask's 3.1.3 security release, the Vue 2 support status, jQuery's 4.0 migration and ORT Web session documentation. Do not infer an all-package advisory audit from that inspection.

`pnpm deps:verify` checks every exact version against registry metadata and writes a developer-side report; it does not run in the browser. Resolve and review `pnpm-lock.yaml`, run `pnpm audit`, then use frozen installs. Do not merge or deploy without those steps. The CI gate verifies the lock is tracked, not merely generated during install.

**Compatibility exceptions:** Vue 2 is end-of-life. jQuery 4, CodeMirror 6 and a new UI framework are not drop-in upgrades. Metro UI, brat, math/NLP helpers, legacy XLSX exporters and remaining copied vendored components still need focused update/removal. Their old copies can remain in the source tree; selected production URLs are replaced by the build. A complete supply-chain bill of materials and unreachable-asset removal remain release work.

The Rust core uses pinned serde_json and its locked dependencies. The actual WASM/SQLite unit suite requires a compiled core and the pinned npm SQLite package. Cargo.lock and reproduced third-party notices are checked in; build output is generated, never committed.

Sources:
- https://github.com/pallets/flask/releases/tag/3.1.3
- https://v2.vuejs.org/lts/
- https://blog.jquery.com/2026/01/17/jquery-4-0-0/
- https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html

## Remaining public advisories

The refreshed locked npm graph reports **one low and one moderate advisory**, both in end-of-life Vue 2:

- `vue@2.7.16`: [GHSA-5j4c-8p2g-v4jx](https://github.com/advisories/GHSA-5j4c-8p2g-v4jx), low ReDoS in the HTML parser. The static build ships `vue.runtime.min.js` and precompiles repository-owned templates. That narrows exposure but does not constitute a patched dependency.
- `vue-template-compiler@2.7.16`: [GHSA-g3ch-rx76-35fx](https://github.com/advisories/GHSA-g3ch-rx76-35fx), moderate client-side XSS advisory. This is a build-only compiler for repository-owned templates, never imported clinical templates. There is no public patched Vue 2 compiler.

No advisory is suppressed. Eliminating these findings requires migrating the legacy templates, runtime and render-function generation together to a supported framework, followed by broader legacy interaction qualification. A Vue 3 package substitution alone is incompatible with the current generated Vue 2 render functions.

Python development dependencies now live in `pyproject.toml` and the hash-bearing `uv.lock`. `uv sync --locked` recreates the environment; all Python-backed pnpm commands use `uv run --locked`. CI uses uv 0.12.19 and frozen locks for both ecosystems.
