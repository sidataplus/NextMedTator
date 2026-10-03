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

## Supplied mixv1 adapter

```sh
uv run --locked --project tools/gliner-onnx gliner-onnx \
  --adapter /path/to/mixv1_adapter.zip \
  --base-model fastino/gliner2.5-base-v1 \
  --base-revision ca906247640776a07753514055be9726f9080ead \
  --base-license Apache-2.0 \
  --id gliner25-base-mixv1 \
  --out work/mixv1.nmt-model.zip \
  --report test-results/mixv1-export.json
```

For the submitted artifact, rank is 16 and all 144 adapter tensors target the
encoder. The base revision comes from its original snapshot metadata. The
generated package is about 790 MB. Native source spans and scores, all heads,
actual ORT Web WASM conformance, offline install/restart/inference,
accept/reject, comparison, portable export/reopen and original Vue/CodeMirror
annotation were exercised in Cloud Chromium. This is technical validation;
clinical accuracy and target-device qualification remain separate.
Source extraction fixtures cover plain occurrence spans. Structured heads
have numerical fixtures; these do not establish equivalence of every source
record-decoding policy or clinical schema. The app retains its anchored-field
decoder and does not implement source-exclusive global assignment.

```sh
uv run --locked --project tools/gliner-onnx python -m unittest discover -s tools/gliner-onnx/tests
NMT_LORA_PACKAGE=work/mixv1.nmt-model.zip uv run --locked python tests/browser/test_lora_model.py
```

Build the app and engineering preview before the browser gate. The real-weight
gate requires a package and never silently skips or substitutes fake outputs.
CI runs bounded synthetic adapter tests for different ranks/scalings and
dynamic stable-sort cases; user-supplied adapter weights stay outside Git.

The checked-in [technical report](../../docs/nextmedtator/qualification/mixv1-technical.json)
and [original-UI screenshot](../../docs/nextmedtator/qualification/mixv1-original-ui.png)
record this Cloud run. Record fixtures vary instances, fields and candidate
counts; relation fixtures cover 6 and 96 words. CI also checks record inputs
up to 192 candidates against the original source scorer.

The supplied 27-note clinical-style generated corpus is also validated through
the app. See [generated-note validation](../../docs/nextmedtator/GENERATED-NOTE-VALIDATION.md)
for exact scope, reproduction and agreement results. These references are
unverified generated labels, and the contextual-field agreement is low;
the successful runtime checks do not qualify clinical accuracy.
