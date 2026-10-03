# Build and integration

The isolated `preview/` is generated from the new review workspace only. It allows local development without cloning the legacy application or installing JS packages. It is deliberately marked Engineering preview and has no qualified live model.

The fork build requires the original repository at its verified baseline:

```text
sidataplus/NextMedTator
main: 7e0fd568ee7ee9dd5c2ffe7092489cfec31b602c
```

`build_nextmedtator.py` renders the original Flask/Jinja templates with locally copied compatible dependencies. `finalize_build.mjs` extracts executable scripts, precompiles the static Vue templates, and uses the Vue runtime-only build. The annotation screen keeps the document list, source editor, schema tags, and tag table. A collapsible assistance column on that screen holds the workspace mode, local model status, and GLiNER analyze/review actions. The portable evidence project remains available from that column. Manual annotation stays available with the column collapsed and with no model imported. Copying legacy documents into the evidence project transfers source text only; typed annotation interchange uses explicit native/XML imports.

Both static builds and the real-origin Chromium suites were executed locally for the PR #3 follow-up. `test_legacy.py` covers the original screen plus exact occurrence conformance and two-note structured analysis using tiny synthetic ONNX graphs through the real ORT WASM worker. It checks per-note freeze/reveal, automatic Assisted exposure that prevents independent blind freeze, selector and navigation protection, unchanged blind tags after acceptance, stale actions, and one package load per batch. `test_preview.py` covers review/export, blind comparison, recovery, Unicode/XML, canary egress checks, and offline inference/export/reimport with exact package lineage and variant identity. These fixtures do not establish real GLiNER quality or clinical qualification. Broader manual entity/relation and device workflows remain release gates.

The legacy assistance column keeps its blind tag copies and exposure history in memory for the current session. Both automatic Assisted display and explicit reveal record the note, timestamp, package hash and variant. Switching to Blind cannot turn an exposed annotation into an independent snapshot. Use the portable evidence project for durable study snapshots and exposure provenance.

The static deployment target is `dist/`. `wrangler.jsonc` has no Worker handler. No deployment command runs as part of the tests or patch application. Cloudflare account/domain setup is deliberately not invented.

## Dependency and release gates

Use the tracked `pnpm-lock.yaml` with `pnpm install --frozen-lockfile`. Direct pins, dependency audits and the tracked lock remain CI gates; changing dependencies requires a reviewed lock update.

All runtime assets are copied from local packages or retained vendored sources. Files over Cloudflare's 25 MiB limit fail the build. If a qualified ORT/model artifact exceeds it, define and validate its separately hosted artifact path instead of silently disabling the limit.

Offline install caches only the hashed public inventory. It does not call `skipWaiting` or silently replace code in an active study. App versions can coexist in cache; explicit old-cache cleanup remains lifecycle work.
