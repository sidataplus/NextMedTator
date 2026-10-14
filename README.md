# NextMedTator

**Annotate clinical text, run local models, and review every suggestion in your browser.**

[Open the app](https://nmt.sidata.plus) · [Step-by-step tutorials](tutorial/README.md) · [Download a compiled release](https://github.com/sidataplus/NextMedTator/releases) · [Report an issue](https://github.com/sidataplus/NextMedTator/issues)

![NextMedTator: load a fictional note, run local inference, review attributes and reopen an exported project](tutorial/images/nextmedtator-walkthrough.gif)

*Recorded in Chrome with real P10 and BPSD WASM inference on fictional notes. The walkthrough shortens loading waits; it is not a speed benchmark.*

## What you can do

- **Annotate by hand:** load a schema and notes, mark spans, edit attributes, and save XML.
- **Ask for local assistance:** use ClinicalEvidence P10 or BPSD, inspect suggestions, and add only the annotations you choose.
- **Choose a review mode:** Auto Apply (default) for unreviewed machine tags, Assisted for individual decisions, or Blind for freezing independent annotations before revealing predictions.
- **Work across a corpus:** run a resumable GPU-first queue with per-note status, progress/ETA, failed-note retries and a completion report; search text locally and inspect annotation statistics.
- **Handle long notes:** GLiNER2.5 scans overlapping windows using the complete model prompt and exact original-text offsets.
- **Keep large collections on disk:** explicitly store up to 10,000 text notes locally; load notes and histories on demand. Export backups through a standard browser download (up to 64 MiB), or stream larger backups directly to disk where supported. File System Access APIs are optional.
- **Review efficiently:** filter by family or decision, page through suggestions, use keyboard shortcuts, and undo assistance actions.
- **Keep the evidence:** export portable projects containing source text, annotations, model runs and review history. Browser recovery is separately opt-in.

The annotation application is a static site; a small Cloudflare Worker verifies public model downloads. Inference runs on your device; notes are not sent to a model server. Model weights download **only on request**, never on website load or precision selection. After selecting FP16, an explicit Analyze request may download the disclosed FP32 WASM fallback if needed. Installed packages are reused locally. The annotation workspace lists installed packages without loading their weights at startup; **Use Installed** loads them explicitly. **Unload Model** releases model references while preserving installed files and annotations.

## Try it in five steps

1. Open [nmt.sidata.plus](https://nmt.sidata.plus) in a current desktop browser.
2. Follow **1. Open a File** in Assistance: load your files from the toolbar, or choose a fictional P10 or BPSD sample.
3. **2. Choose a Model** starts with P10. In **3. Load the Model**, click the recommended **Download** button or **Load Installed**. Firefox and Safari open verification in a separate tab; complete the check and the download continues automatically. **Model Options** holds precision/device overrides; **Installed Models** accepts `.nmt-model.zip` files.
4. In **4. Analyze and Review**, **Review Mode** starts at **Auto Apply**; choose **Assisted** to review each suggestion. Click **Analyze File**, click **Accept** on a suggestion, check the tag, then click **Add Tag**.
5. Click **Export Evidence Project** for a portable `.nmt.zip` backup. Reopen it through **More Tools → Open Evidence Project → Open project/files**.

No model is required for manual annotation. Use the ribbon's **Sample** button for a small manual task, or load your own schema and text files.

**Appearance:** dark mode follows your system setting by default. Choose
**Settings → Appearance → System / Light / Dark** to override it. Your choice
is saved in this browser and applies to the editor, ribbon, Assistance and dialogs.

Safari opens the annotation workspace directly and uses ordinary file inputs and
downloads. File System Access APIs are optional. The four-step Assistance panel
shares the workspace's toolbar styling and labeled icons. Startup, XML/schema
downloads and collection backup/restore are tested in WebKit on Windows;
this does not substitute for testing the shipping Safari app on macOS/iOS.

## Model packages

| Model | Purpose | Download | Qualified browser execution |
|---|---|---|---|
| [ClinicalEvidence P10 GLM base](https://huggingface.co/na399/clinical-evidence-gliner2.5-base-lora-p10-glm) | Clinical evidence spans and attributes | About 721 MiB | WebGPU with WASM fallback, fp32 |
| [BPSD GLiNER2.5 base](https://huggingface.co/na399/bpsd-gliner2.5-base-lora-20261012) | Behavioral and psychological symptom spans and attributes | About 725 MiB | WebGPU with WASM fallback, fp32 |

Both models also offer **FP16 WebGPU** packages (about **369 / 372 MiB**, P10 / BPSD). These preserve all spans and attribute choices on eight synthetic regression notes, with small confidence differences. FP16 saves download bytes; it did not improve warm inference speed on this machine. See [precision benchmarks and choices](docs/nextmedtator/PRECISION.md).

The package panel detects browser capabilities and recommends **FP16** for compatible WebGPU devices or **FP32** for CPU/compatibility. You can override the recommendation. Device hints stay local. Public model downloads require a Cloudflare verification check and are rate-limited. See [download protection and validation](docs/nextmedtator/DOWNLOAD-PROTECTION.md).

If FP16 fails its reference checks, use **Model Options → Check GPU Compatibility** on the loaded FP16 package. This runs synthetic reference examples without downloading FP32. **Save GPU Report** records numeric differences and identifies changed spans or attributes, excluding your notes. See [Mac conformance diagnostics](docs/nextmedtator/PRECISION.md#diagnosing-a-mac-gpu-conformance-failure).

Allow at least twice the download size in browser storage for offline installation, plus runtime memory. Models are saved and read-back checked in 16 MiB chunks. If browser storage is full or unavailable, a verified download remains usable in the current tab; a **Ready for this session** notice explains that reloading requires loading it again. Cancellation still stops installation and removes partial writes. Downloads show bytes, progress and an estimated remaining time when enough transfer data is available. Batch analysis estimates remaining time after the first completed note; initialization names each preparation stage and has no speculative ETA.

For bulk assistance, open **Batch Analysis**, use **Select All** or check individual files, then click **Analyze Selected**. The default **Automatic** device prefers WebGPU, including Metal on supported Apple browsers. If GPU inference is unavailable or fails, WASM uses the browser-reported logical CPU count minus one (minimum one; one without cross-origin isolation). This also applies to single-note analysis. Choose **Low CPU** to cap batch WASM at one thread or **Balanced** for up to four. All modes process one note at a time using one model session. Requests are prepared on demand, raw outputs are released after saving each result, and the selector shows 50 notes per page. These reduce temporary work and memory overhead; loaded notes, retained review history and model sessions still use RAM. **Pause** releases the inference worker and preserves the queue. **Resume** skips completed notes; **Retry Failed** targets failed notes. Per-note status, overall progress, ETA, **Select Unfinished**, and a downloadable JSON completion report are available in the batch panel. For ordinary loaded notes, enable **local corpus recovery** to checkpoint the queue and results across reloads. Explicitly imported disk-backed collections save each note and queue outcome atomically without that toggle. Processing resumes only when you request it.

These packages retain their pinned training schemas and model-specific limits. Long notes use overlapping GLiNER2.5 windows by default, bounded by both the complete encoded prompt and each package’s word limit. Exact duplicates keep the higher-scoring occurrence with its attributes; the package’s overlap policy is retained. Coverage and window counts are saved. Attributes use local window context; a mention whose endpoints never fit together cannot be stitched. Turn off **Split Long Files into Windows** to reject oversized notes. A token that cannot fit with the prompt is still rejected without truncation. Automatic GPU execution falls back to **original FP32 WASM**; **Assistance → Load the Model → Model Options → Run On** also lets you choose CPU explicitly. FP16's FP32 fallback is a separate download of about 725 MiB, requested only when analysis needs it. The fallback is reused in the current tab even if browser caching fails. **Why was CPU used?** shows the GPU error; device capability hints alone do not guarantee model compatibility. Install the matching FP32 package beforehand for offline fallback. See [storage and fallback validation](docs/nextmedtator/STORAGE-FALLBACK.md). See the [original FP32 comparison](docs/nextmedtator/WEBGPU.md), [precision results](docs/nextmedtator/PRECISION.md), and [model contracts](docs/nextmedtator/CURRENT-MODELS.md).

See [long-note, disk-collection and memory-release validation](docs/nextmedtator/WORKFLOW-IMPROVEMENTS.md), and [100-note CPU and RAM measurements](docs/nextmedtator/BULK-RESOURCES.md) for the resource comparison, memory-release checks, and reproducible queue tests.

Model files have their own license terms, included in each package. Public availability does not change those terms. Synthetic parity checks establish technical consistency, not clinical accuracy.

## Tutorials in this repository

| Guide | Outcome |
|---|---|
| [1. Your first annotation](tutorial/01-quickstart.md) | Open a fictional task or load your own files; find the main controls |
| [2. Local model assistance](tutorial/02-local-models.md) | Explicitly load a model, run P10 or BPSD, and choose a review mode |
| [3. Review, export and recover](tutorial/03-review-export.md) | Review fields, reopen a portable project, search and save a recovery copy |
| [4. Long notes and large collections](tutorial/04-large-collections.md) | Manage model memory, use review shortcuts, process disk-backed queues and export streaming backups |

Every guide includes screenshots captured from the application. [Example notes and schemas](tutorial/examples) are included alongside the tutorials. All example notes are fictional.

## Run a compiled release locally

Download the latest `NextMedTator-*-static.zip` from [Releases](https://github.com/sidataplus/NextMedTator/releases). Serve the extracted files over HTTP on localhost or HTTPS; opening `index.html` as a `file://` URL is unsupported. To use this repository's server with the included WASM isolation headers, extract the archive's contents into `dist/` in a repository checkout, then run:

```sh
uv run --locked python scripts/serve_static.py --directory dist --port 4173
```

Open `http://127.0.0.1:4173`. The static archive includes the compiled Rust WASM core and browser runtimes; model weights remain separate. Local package import works on localhost. Protected R2 downloads also work on localhost in current Chrome/Edge. Other self-hosted origins should use local packages or configure their own verification deployment.

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

The production build writes `dist/` and selects the two public R2 model packages. Python is used at build time; the deployed site needs no Python service. Cloudflare Pages hosts [nmt.sidata.plus](https://nmt.sidata.plus), with public model downloads protected by a Worker on the separate R2 domain. Preserve the generated `_headers` when deploying. See [deployment details](docs/nextmedtator/DISTRIBUTION.md) and [build instructions](docs/nextmedtator/BUILD.md).

For Cloudflare Pages Git builds, use `pnpm build:cloudflare`, output directory
`dist`, and environment variable `SKIP_DEPENDENCY_INSTALL=1`. This command installs
the pinned Rust/WASM and uv tooling before building; the Pages image alone cannot
run `pnpm build:production`.

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
