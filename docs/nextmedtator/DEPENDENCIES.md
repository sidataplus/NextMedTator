# Dependency refresh and compatibility exceptions

The new static build resolves JavaScript packages and serves local assets instead of fetching CDN code at runtime. These are explicit upgrade targets, **not a claim that every dependency is the latest available or security-qualified**.

| Dependency | Inherited configuration | New direct pin | Reason |
|---|---|---|---|
| Flask | unpinned | 3.1.3 | Build-only security-fix release |
| Vue | 2.6.11 | 2.7.16 | Final 2.x API; preserve legacy interactions |
| jQuery | 3.4.1 | 3.7.1 | Compatible 3.x API; 4.x migration deferred |
| jQuery UI | 1.12.x | 1.14.1 | Updated widget dependency |
| CodeMirror | 5.62.x | 5.65.20 | Preserve editor API |
| Font Awesome | 5.15.3 | 5.15.4 | Preserve icon names |
| JSZip | unversioned CDN | 3.10.1 | Pin legacy export helper |
| FileSaver | 2.0.0 | 2.0.5 | Pin download helper |
| Day.js | 1.8.36 | 1.11.13 | Updated compatible date helper |
| PapaParse | 5.3.1 | 5.5.3 | Updated CSV parser |
| js-yaml | 4.1.0 | 4.1.1 | Updated 4.x parser |
| D3 | floating v7 | 7.9.0 | Pin the v7 renderer |
| ECharts | 5.3.3 | 5.6.0 | Preserve chart API |
| DOMPurify | absent | 3.3.1 | Sanitization for generated Vue v-html render paths |
| ONNX Runtime Web | absent | 1.23.2 | Candidate browser tensor-conformance runtime |

Public primary references inspected include Flask's 3.1.3 security release, the Vue 2 support status, jQuery's 4.0 migration and ORT Web session documentation. Do not infer an all-package advisory audit from that inspection.

The sandbox could not fetch npm packages. `pnpm deps:verify` checks every exact version against registry metadata and writes a developer-side report; it does not run in the browser. Resolve and review `pnpm-lock.yaml`, run `pnpm audit`, then use frozen installs. Do not merge or deploy without those steps. The CI gate verifies the lock is tracked, not merely generated during install.

**Compatibility exceptions:** Vue 2 is end-of-life. jQuery 4, CodeMirror 6 and a new UI framework are not drop-in upgrades. Metro UI, brat, math/NLP helpers, legacy XLSX exporters and remaining copied vendored components still need focused update/removal. Their old copies can remain in the source tree; selected production URLs are replaced by the build. A complete supply-chain bill of materials and unreachable-asset removal remain release work.

The preview review core uses no third-party runtime library; its unit suite is independently executable without resolving this dependency graph.

Sources:
- https://github.com/pallets/flask/releases/tag/3.1.3
- https://v2.vuejs.org/lts/
- https://blog.jquery.com/2026/01/17/jquery-4-0-0/
- https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html
