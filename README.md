# NextMedTator

**Annotate clinical text, run local models, and review every suggestion in your browser.**

[Open the app](https://nmt.sidata.plus) · [Step-by-step tutorials](tutorial/README.md) · [Download a compiled release](https://github.com/sidataplus/NextMedTator/releases) · [Report an issue](https://github.com/sidataplus/NextMedTator/issues)

![NextMedTator: load a fictional note, run local inference, review attributes and reopen an exported project](tutorial/images/nextmedtator-walkthrough.gif)

*Recorded in Chrome with real P10 and BPSD WASM inference on fictional notes. The walkthrough shortens loading waits; it is not a speed benchmark.*

## What you can do

- **Annotate by hand:** load a schema and notes, mark spans, edit attributes, and save XML.
- **Ask for local assistance:** use ClinicalEvidence P10 or BPSD, inspect suggestions, and add only the annotations you choose.
- **Choose a review mode:** Assisted for individual decisions, Auto apply for unreviewed machine tags, or Blind for freezing independent annotations before revealing predictions.
- **Work across a corpus:** select notes for batch analysis, search text locally, and inspect annotation statistics.
- **Keep the evidence:** export portable projects containing source text, annotations, model runs and review history. Browser recovery is separately opt-in.

The application is a static site. Inference runs on your device; notes are not sent to a model server. Model weights download **only after you request a download**. A previously installed matching package can be restored from browser storage without downloading it again.

## Try it in five steps

1. Open [nmt.sidata.plus](https://nmt.sidata.plus) in desktop Chrome or Edge.
2. In **Assistance → Try a fictional note**, choose **P10 clinical evidence** or **BPSD behaviors**. This loads a synthetic note, its matching schema and the model selection. It starts no download.
3. Expand **Get a model package**, click **Show approved public model**, and choose the corresponding **Download and install** button. Alternatively, import a local `.nmt-model.zip` package.
4. Keep **Mode → Assisted** and click **Analyze note**. Open **Add to annotation**, check the fields, then click **Write annotation**.
5. Click **Export evidence project** to keep a portable `.nmt.zip` backup. Use **Open evidence project → Open project/files** to reopen it.

No model is required for manual annotation. Use the ribbon's **Sample** button for a small manual task, or load your own schema and text files.

## Model packages

| Model | Purpose | Download | Qualified browser execution |
|---|---|---|---|
| [ClinicalEvidence P10 GLM base](https://huggingface.co/na399/clinical-evidence-gliner2.5-base-lora-p10-glm) | Clinical evidence spans and attributes | About 721 MiB | WASM, fp32 |
| [BPSD GLiNER2.5 base](https://huggingface.co/na399/bpsd-gliner2.5-base-lora-20261012) | Behavioral and psychological symptom spans and attributes | About 725 MiB | WASM, fp32 |

Allow at least twice the download size in browser storage, plus runtime memory. Downloads show bytes, progress and an estimated remaining time when enough transfer data is available. Initialization and inference show their current stage; they do not invent an ETA.

These packages retain their pinned training schemas and model-specific limits. Oversized notes are rejected rather than silently truncated. WebGPU has been exercised on the development machine, but complete decoder/attribute parity is not qualified for these releases; the public packages use WASM. See [model contracts and validation](docs/nextmedtator/CURRENT-MODELS.md).

Model files have their own license terms, included in each package. Public availability does not change those terms. Synthetic parity checks establish technical consistency, not clinical accuracy.

## Tutorials in this repository

| Guide | Outcome |
|---|---|
| [1. Your first annotation](tutorial/01-quickstart.md) | Open a fictional task or load your own files; find the main controls |
| [2. Local model assistance](tutorial/02-local-models.md) | Explicitly load a model, run P10 or BPSD, and choose a review mode |
| [3. Review, export and recover](tutorial/03-review-export.md) | Review fields, reopen a portable project, search and save a recovery copy |

Every guide includes screenshots captured from the application. [Example notes and schemas](tutorial/examples) are included alongside the tutorials. All example notes are fictional.

## Run a compiled release locally

Download the latest `NextMedTator-*-static.zip` from [Releases](https://github.com/sidataplus/NextMedTator/releases). Serve the extracted files over HTTP on localhost or HTTPS; opening `index.html` as a `file://` URL is unsupported. To use this repository's server with the included WASM isolation headers, extract the archive's contents into `dist/` in a repository checkout, then run:

```sh
uv run --locked python scripts/serve_static.py --directory dist --port 4173
```

Open `http://127.0.0.1:4173`. The static archive includes the compiled Rust WASM core and browser runtimes; model weights remain separate. Local package import works on localhost. Public R2 downloads are configured for the deployed app origins; use a local package when running the app locally.

## Build from source

Requirements: Node.js 22.16+, pnpm 10.18.3, uv, and Rust 1.90.0 with the `wasm32-unknown-unknown` target. Use the committed lockfiles.

```sh
pnpm install --frozen-lockfile
uv sync --locked
rustup toolchain install 1.90.0 --profile minimal --target wasm32-unknown-unknown
pnpm build:production
pnpm audit:assets
pnpm preview:legacy
```

The production build writes `dist/` and selects the two public R2 model packages. Python is used at build time; the deployed site needs no Python service. Cloudflare Pages hosts [nmt.sidata.plus](https://nmt.sidata.plus), with weights on a separate public R2 domain. Preserve the generated `_headers` when deploying. See [deployment details](docs/nextmedtator/DISTRIBUTION.md) and [build instructions](docs/nextmedtator/BUILD.md).

## Validation and development

```sh
pnpm test
uv run --locked python tests/browser/test_legacy.py
uv run --locked python tests/browser/test_assist_panel_layout.py
uv run --locked python tests/browser/test_legacy_recovery.py
uv run --locked python tests/browser/test_corpus_search.py
```

[Recording instructions](tutorial/README.md#reproduce-the-screenshots-and-gif) describe the real-model tutorial check. [Model packaging](docs/nextmedtator/MODEL-PACKAGES.md), [browser contracts](docs/nextmedtator/ENTITY-CONTRACT-BROWSER.md), and [security and storage](docs/nextmedtator/SECURITY.md) cover the technical details.

Application code is distributed under [Apache-2.0](LICENSE). Dependencies and model artifacts retain their respective licenses and notices.
