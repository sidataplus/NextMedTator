# Build and integration

The isolated `preview/` is generated from the new review workspace only. It allows local development without cloning the legacy application or installing JS packages. It is deliberately marked Engineering preview and has no qualified live model.

The fork build requires the original repository at its verified baseline:

```text
sidataplus/NextMedTator
main: 7e0fd568ee7ee9dd5c2ffe7092489cfec31b602c
```

`build_nextmedtator.py` renders the original Flask/Jinja templates with locally copied compatible dependencies. `finalize_build.mjs` extracts executable scripts, precompiles the static Vue templates, uses the Vue runtime-only build and attaches a collapsible Clinical Evidence workspace. It does not rewrite the upstream source layout or replace its manual UI. Copying legacy documents transfers source text only; typed annotation interchange uses explicit native/XML imports.

The full integration was **not executed** in the restricted runtime. The CI and `test_legacy.py` smoke gate must pass on a connected runner. Exercise schema loading, manual entity/relation edits, adjudication, statistics and exports beyond that initial smoke test before approval.

The static deployment target is `dist/`. `wrangler.jsonc` has no Worker handler. No deployment command runs as part of the tests or patch application. Cloudflare account/domain setup is deliberately not invented.

## Dependency and release gates

Use `pnpm deps:verify`, resolve the exact direct pins, review/commit the generated `pnpm-lock.yaml`, audit and use frozen installs. The CI job can produce a candidate lock artifact but refuses to pass the merge gate when the lock is not tracked. A lockfile is absent in this pack because the package registry was inaccessible; none was fabricated.

All runtime assets are copied from local packages or retained vendored sources. Files over Cloudflare's 25 MiB limit fail the build. If a qualified ORT/model artifact exceeds it, define and validate its separately hosted artifact path instead of silently disabling the limit.

Offline install caches only the hashed public inventory. It does not call `skipWaiting` or silently replace code in an active study. App versions can coexist in cache; explicit old-cache cleanup remains lifecycle work.
