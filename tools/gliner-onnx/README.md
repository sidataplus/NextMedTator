# GLiNER2.5 LoRA → ONNX

A standalone Python command for any compatible GLiNER2.5 **PEFT LoRA** adapter.
It has its own `pyproject.toml` and `uv.lock`; it imports no web-app code and
needs no Node, browser, Flask, server or training environment.

```sh
uv run --locked --project tools/gliner-onnx gliner-onnx \
  --adapter /path/to/adapter.zip \
  --out work/my-adapter.nmt-model.zip \
  --report work/my-adapter-export.json
```

`--adapter` accepts a directory or ZIP containing `adapter_config.json` and
`adapter_model.safetensors`, including a ZIP with one named parent directory.
The name, rank, alpha, target modules, rank/alpha patterns, RS-LoRA/DoRA,
bias and saved modules come from PEFT configuration and weights. The tool
does not depend on `mixv1` or a fixed adapter rank. Invocation-dependent
aLoRA and layer replication are rejected because this static export does not
support them. Other model architectures and GLiNER's older span architecture
require different export/decoder contracts.

An immutable base model/revision is inferred from adapter metadata, including
Hugging Face cache snapshot paths. When metadata is insufficient, provide
`--base-model owner/model --base-revision <40-character-commit>`. Conflicting
base metadata fails. `--base-dir` reuses a local checkpoint, but its five
required files are still verified against the pinned Hub revision; size alone
is insufficient. Public base download/verification needs the network. No
adapter weights, texts or inference requests are uploaded.

The browser codec requires the boundary architecture, first-token pooling,
flat overlap and a non-adaptive threshold. Record/relation heads and the
base tokenizer must be compatible with the pinned GLiNER2 runtime. The
encoder token/query axes vary; the word axis is padded/masked to 512 to keep
traced candidate budgets valid on short notes. Longer notes use the app's
existing overlapping 512-token windows. Enum groups allow at most eight
choices; attribute scoring batches spans in groups of 16. The package exposes
anchors, enum attributes and anchored record fields. Automatic relations,
cross-window relations and anchorless records remain unsupported in the app.
The relation scoring graph is included and numerically checked, but exporting
that graph does not qualify an automatic relation workflow.

The tool verifies exact adapter tensor loading, compares active-adapter and
safely merged encoder output, and records base/config/adapter artifact hashes.
All modified non-encoder tensors contribute to the trained-head fingerprint.
The main graph retains the native stable sort/deduplication logic: full-axis
ONNX TopK supplies its specified lower-index tie order. Equivalent explicit
attention avoids unsupported browser EyeLike/sequence operators. Source
abstention logits and threshold are retained. Source span sets/scores and all
exported heads must pass PyTorch → native ONNX checks before packaging.

The resulting ZIP contains only graphs, tokenizer and reference fixtures. It
uses `nextmedtator-model-v1` with `gliner25-records-v1` and can be imported in
the original annotation assistance panel or the evidence workspace. The
browser verifies hashes and conformance before analysis. Base/adapter/merge
identity follows machine runs into review, comparison and portable exports.
No weight files are committed by this tool. Existing output paths are refused.

Defaults use six synthetic English source cases. `--cases cases.json` can
provide 1–32 `{ "text": "…", "labels": ["…"] }` rows, each fitting a
512-token window. These texts become package fixtures: use synthetic/public
examples. Source predictions are **technical conformance references**, not
human labels or clinical accuracy evidence. `--adapter-license` declares the
adapter's license; the default `LicenseRef-User-Provided` does not assume that
a supplied adapter inherits the base model's Apache-2.0 license.
`--base-license` records the license from the pinned base model card; its
default is `LicenseRef-Hub-Base` rather than assuming all compatible bases
share a license.

## Current adapter: ClinicalEvidence P7b

The current validation package is `gliner25-clinical-evidence-p7b`, using
`na399/clinical-evidence-gliner2.5-lora-p7b@ac4b10b7d961bfa5ce79703fb2f689c2f93be261`.
The owner temporarily enabled a public download. Once cached, export and browser
inference do not need access to the adapter repository. Its metadata does not
pin a base revision, so this controlled comparison keeps the same base as P4.

```sh
uv tool run --from huggingface_hub==2.1.1 hf download na399/clinical-evidence-gliner2.5-lora-p7b --revision ac4b10b7d961bfa5ce79703fb2f689c2f93be261 --local-dir work/clinical-p7b-adapter
uv run --locked --project tools/gliner-onnx gliner-onnx \
  --adapter work/clinical-p7b-adapter \
  --base-model fastino/gliner2.5-base-v1 \
  --base-revision ca906247640776a07753514055be9726f9080ead \
  --base-license Apache-2.0 \
  --adapter-license LicenseRef-Research-Group-Only-No-Redistribution \
  --id gliner25-clinical-evidence-p7b \
  --out work/clinical-p7b.nmt-model.zip \
  --report test-results/clinical-p7b-export.json
```

Use `--base-dir` to reuse a cached base checkpoint; the tool still verifies its
bytes against the immutable Hub revision. If the adapter is private again,
use an authorized `HF_TOKEN` environment value for the download. Never commit
credentials or weights. The P7b license restricts use to the owner's research
group and grants no redistribution rights; temporary public access does not
change that declaration.

Import the resulting ZIP through **Local model package** in the original
annotation panel. The active model ID is displayed; **Install package for
offline use** persists that package locally. Existing P4 runs retain P4 lineage.
The app's public catalog remains a separate, permissively licensed small model;
it does not distribute this research checkpoint.

The card specifies v2 positive-only attribute labels, with offset joins and
absence-implied defaults in its hybrid decoder. It reports that record-choice
binding did not pass qualification. This package uses the existing app-owned
anchored-record/choice-head decoder, which does not implement that hybrid path.
Do not interpret its choice fields as qualified v2 attribute predictions.
Attribute/cue work remains deferred. The card's BPSD entity F1 of 0.84 is a
source-reported metric with different prompts/threshold selection; it is not
our browser result.

See [P7b validation and screenshots](../../docs/nextmedtator/P7B-VALIDATION.md).

```sh
NMT_LORA_PACKAGE=work/clinical-p7b.nmt-model.zip uv run --locked python tests/browser/test_lora_model.py
NMT_LORA_PACKAGE=work/clinical-p7b.nmt-model.zip uv run --locked python tests/browser/test_lora_samples.py
NMT_LORA_PACKAGE=work/clinical-p7b.nmt-model.zip uv run --locked python tests/browser/test_lora_corpus_ui.py
NMT_LORA_PACKAGE=work/clinical-p7b.nmt-model.zip uv run --locked python tests/browser/test_lora_bpsd.py
```

## Archived adapter: ClinicalEvidence Phase 4

The archived Phase 4 package uses
`na399/gliner2.5-clinical-evidence-lora-p4@43e8dbd6d9b240498b891c74202d3e869d317c26`.
Download the pinned adapter, then build locally:

```sh
uv tool run --from huggingface_hub==2.1.1 hf download na399/gliner2.5-clinical-evidence-lora-p4 --revision 43e8dbd6d9b240498b891c74202d3e869d317c26 --local-dir work/clinical-p4-adapter
uv run --locked --project tools/gliner-onnx gliner-onnx \
  --adapter work/clinical-p4-adapter \
  --base-model fastino/gliner2.5-base-v1 \
  --base-revision ca906247640776a07753514055be9726f9080ead \
  --base-license Apache-2.0 \
  --adapter-license LicenseRef-Noncommercial-Research-No-Redistribution \
  --id gliner25-clinical-evidence-p4 \
  --out work/clinical-p4.nmt-model.zip \
  --report test-results/clinical-p4-export.json
```

The adapter declares its base by name without an immutable base revision. We
reuse the exact base revision from the mixv1 run for the controlled comparison.
Rank is 32, alpha 64, and all 246 tensors load exactly, including encoder and
extraction/record-head adapters. Active-adapter versus merged encoder maximum
absolute error is 8.1e-6. The 790 MB package passes source occurrence cases
and native numerical checks for all four graphs, including varied record
candidate counts and relation lengths. The trained-head fingerprint is
recorded rather than declared unchanged.

The model card declares non-commercial research use and no redistribution.
The tool license is separate; adapter/exported weights are kept outside Git
and are not published by this workflow.

```sh
uv run --locked --project tools/gliner-onnx python -m unittest discover -s tools/gliner-onnx/tests
NMT_LORA_PACKAGE=work/clinical-p4.nmt-model.zip uv run --locked python tests/browser/test_lora_model.py
NMT_LORA_PACKAGE=work/clinical-p4.nmt-model.zip uv run --locked python tests/browser/test_lora_samples.py
NMT_LORA_PACKAGE=work/clinical-p4.nmt-model.zip uv run --locked python tests/browser/test_lora_samples_legacy.py
```

Build the app and engineering preview before the browser gates. The real-weight
gates require the package and never silently skip or substitute fake outputs.
CI runs bounded synthetic adapter tests for different ranks/scalings, DoRA,
head-only adaptation, record candidate counts up to 192 and dynamic stable ties.

See the [Phase 4 technical report](../../docs/nextmedtator/qualification/clinical-p4-technical.json)
and [generated-note comparison](../../docs/nextmedtator/GENERATED-NOTE-VALIDATION.md).
Source extraction fixtures cover plain occurrence spans. Structured heads
have numerical fixtures; these do not establish equivalence of every source
record-decoding policy or clinical schema. The app retains its anchored-field
and head-based choice decoders. The model card's separate ClinicalEvidence
`per_anchor`/`hybrid` decoder is not implemented by this gate. Clinical accuracy
and target-device qualification remain separate.

## Previous adapter baseline

The original rank-16 mixv1 adapter and its results remain archived in the
[mixv1 technical report](../../docs/nextmedtator/qualification/mixv1-technical.json).
The [adapter comparison](../../docs/nextmedtator/qualification/adapter-comparison.json)
uses the same 27-note fixture, schema, threshold and matching protocol. These
are unverified generated labels, not a clinical gold standard.
