# NextMedTator implementation preview

Additive implementation for **sidataplus/NextMedTator only**. The upstream MedTator license and application source are preserved; development commands use the locked uv workflow. This is an engineering preview, **not the complete qualified PRD release**.

## Run the isolated review workspace now

The authored synthetic walkthrough needs no inference API or model downloads. The standard development setup uses locked pnpm and uv dependencies.

```sh
node --test tests/unit/*.test.mjs
uv run --locked python scripts/build_preview.py
uv run --locked python scripts/serve_static.py --directory preview
# Open http://127.0.0.1:4173 in a normal local browser.
```

The preview supports source import, occurrence records, immutable suggestions, human editing, blind freeze/reveal, snapshot comparison/adjudication and local native project exports. **Sample suggestions are authored, not GLiNER output.** On the original annotation screen, Analyze runs after a local GLiNER2.5 package is imported. A span package fills anchors and scores. A structured package also fills schema enum attributes. The pinned small package supports anchored text/span fields and enums; unknown values stay empty. Manual/imported relations work; automatic small-model relations remain withheld for source-score qualification. Models can be installed and selected offline in Models. See `docs/nextmedtator/QUALIFICATION.md`.

## Build the fork with refreshed dependencies

Apply the patches to the fork first. `web.py`, `templates/` and `docs/static/` are supplied by that repository, not duplicated in the implementation overlay.

```sh
uv sync --locked  # Python 3.12+, uv 0.12.19; installs browser-test dependencies
corepack enable
pnpm deps:verify
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm audit:assets
uv run --locked python -m playwright install chromium
pnpm test:legacy
pnpm build:preview
pnpm test:browser
pnpm test:dom
pnpm audit --audit-level high
```

Cloudflare's static root is `dist/`, **not the inherited prebuilt `docs/`**. No deployment has been performed. Model weights are distributed through a pinned Hugging Face catalog and installed separately. R2 rollout, target-device qualification and the user-supplied LoRA remain external gates.

## Start with these documents

- `docs/nextmedtator/STATUS.md`: implemented, tested and incomplete work.
- `docs/nextmedtator/WALKTHROUGH.md`: assisted and blind examples.
- `docs/nextmedtator/MODEL-PACKAGES.md`: external exporter handshake and merged-LoRA identity.
- `docs/nextmedtator/DEPENDENCIES.md`: refresh pins and compatibility exceptions.
- `docs/nextmedtator/SECURITY.md`: trust boundaries and release gates.
- `docs/nextmedtator/PRD-v1.0.md`: agreed product requirements.

The new core is readable ES modules with runtime validation and zero dependency requirements for its tests. The legacy Vue application is not rewritten. A narrow generated-build attachment opens the new workspace and can copy legacy source documents without modifying the legacy working state. Integration with the actual upstream UI must pass its browser suite before merging.

Python dependencies are declared in `pyproject.toml` and resolved with hashes in `uv.lock`. Use `uv sync --locked` and `uv run --locked`; no manual virtual-environment activation is needed. After intentional Python dependency changes, run `uv lock`, review the lockfile, and rerun the checks above. See `docs/nextmedtator/DEPENDENCIES.md` for the remaining Vue 2 advisories.
