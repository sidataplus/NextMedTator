# NextMedTator tutorials

Learn the complete workflow with fictional notes and real browser inference.
Start at [nmt.sidata.plus](https://nmt.sidata.plus); no account is required.

| Tutorial | What you will finish |
|---|---|
| [1. Your first annotation](01-quickstart.md) | A loaded note and schema, ready for annotation |
| [2. Local model assistance](02-local-models.md) | P10 or BPSD predictions in the Assistance panel |
| [3. Review, export and recover](03-review-export.md) | A reviewed annotation and portable backup |
| [4. Long notes and large collections](04-large-collections.md) | On-demand model memory, faster review, a disk-backed queue and streamed backups |

![Recorded NextMedTator walkthrough](images/nextmedtator-walkthrough.gif)

The recording uses real local P10 and BPSD ONNX packages. Loading waits are
shortened. All notes are fictional; the results are technical examples, not
clinical validation. Screenshots are stored here in Git, alongside the guides.

## Example files

| Task | Schema | Fictional note |
|---|---|---|
| ClinicalEvidence P10 | [p10.dtd](examples/p10.dtd) | [p10.txt](examples/p10.txt) |
| BPSD | [bpsd.dtd](examples/bpsd.dtd) | [bpsd.txt](examples/bpsd.txt) |

The **Try a fictional note** buttons load these same contents. To use the
downloaded files instead, open the schema first and then the note. These DTDs
retain the complete vocabularies for the pinned public model contracts.

## Reproduce the screenshots and GIF

Build the production app and prepare the two local packages using
[CURRENT-MODELS.md](../docs/nextmedtator/CURRENT-MODELS.md). The capture script
expects `work/p10.nmt-model.zip`, `work/bpsd.nmt-model.zip` and the exporter's
`work/bpsd-export.json`. It starts its own loopback server and uses installed
Chrome, or Playwright Chromium if Chrome is unavailable.

```sh
pnpm build:production
uv run --locked python tests/browser/record_tutorial.py
uv run --with pillow python scripts/make_tutorial_gif.py
```

The capture command generates screenshots in `tutorial/images/` and a validation
report under gitignored `temp/browser-validation/tutorial/`. The final command encodes
those captured frames, adds step captions, and writes the GIF. No predictions
or UI screenshots are fabricated. The recording covers opt-in loading,
Assisted review, export/reopen, corpus search, statistics, recovery and BPSD
Auto apply. Local package imports avoid a repeated 1.4 GiB public download.

[Back to the project README](../README.md)

The large-collection guide has a separate four-step recording. Run
`tests/browser/test_workflow_improvements.py` with `NMT_COLLECTION_COUNT=5`, copy
its P10 model-manager, long-note, collection-import and collection-complete
frames to `images/21-model-memory.png` through `images/24-collection-resume.png`,
then encode them with `uv run --with pillow python scripts/make_tutorial_gif.py --collection`.
