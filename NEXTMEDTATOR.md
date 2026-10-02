# NextMedTator implementation preview

Additive implementation for **sidataplus/NextMedTator only**. The upstream MedTator README, license, source and manual workflows are preserved. This is an engineering preview, **not the complete qualified PRD release**.

## Run the isolated review workspace now

No JavaScript packages, inference API, Python packages or model downloads are needed for the authored synthetic walkthrough.

```sh
node --test tests/unit/*.test.mjs
python scripts/build_preview.py
python scripts/serve_static.py --directory preview
# Open http://127.0.0.1:4173 in a normal local browser.
```

The preview supports source import, occurrence records, immutable suggestions, human editing, blind freeze/reveal, snapshot comparison/adjudication and local native project exports. **Sample suggestions are authored, not GLiNER output.** The local Analyze action remains disabled until a real structured browser codec and matching model package are qualified.

## Build the fork with refreshed dependencies

Apply the patches to the fork first. `web.py`, `templates/` and `docs/static/` are supplied by that repository, not duplicated in the implementation overlay.

```sh
uv venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt -r requirements-test.txt
corepack enable
pnpm deps:verify
pnpm install --no-frozen-lockfile  # initial resolution only; review and commit the lock
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm audit:assets
python -m playwright install chromium
pnpm test:legacy
pnpm build:preview
pnpm test:browser
```

Cloudflare's static root is `dist/`, **not the inherited prebuilt `docs/`**. No deployment has been performed. Large model artifacts, an approved R2 model catalog and final runtime qualification are separate work.

## Start with these documents

- `docs/nextmedtator/STATUS.md`: implemented, tested and incomplete work.
- `docs/nextmedtator/WALKTHROUGH.md`: assisted and blind examples.
- `docs/nextmedtator/MODEL-PACKAGES.md`: external exporter handshake and merged-LoRA identity.
- `docs/nextmedtator/DEPENDENCIES.md`: refresh pins and compatibility exceptions.
- `docs/nextmedtator/SECURITY.md`: trust boundaries and release gates.
- `docs/nextmedtator/PRD-v1.0.md`: agreed product requirements.

The new core is readable ES modules with runtime validation and zero dependency requirements for its tests. The legacy Vue application is not rewritten. A narrow generated-build attachment opens the new workspace and can copy legacy source documents without modifying the legacy working state. Integration with the actual upstream UI must pass its browser suite before merging.
