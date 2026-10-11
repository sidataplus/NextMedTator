# Exact BPSD adapter: local inference and static review

The tested adapter is
[`na399/bpsd-gliner2.5-base-lora-20261012`](https://huggingface.co/na399/bpsd-gliner2.5-base-lora-20261012/tree/5cb60383b4b8dd361841e307e54f6e17b68b6fa7),
pinned to `5cb60383b4b8dd361841e307e54f6e17b68b6fa7`. Its base is
`fastino/gliner2.5-base-v1@ca906247640776a07753514055be9726f9080ead`; GLiNER2
is pinned to `55656fbfa01d3d4a77485e1a1eeeaf682990ccdf` in the exporter lock.
No alternate checkpoint is substituted.

This release requires its public schema descriptions, qualified attribute
labels with `qualify_labels=False`, per-axis applicability, overlap policy
`allow`, threshold 0.5, and at most 1024 encoded tokens including the schema.
Missing attributes remain missing. Relations and annotation-only link fields
are not inferred. Oversized notes are rejected rather than silently truncated
or windowed. The current browser exporter has a different 512-token codec and
attribute contract. It now rejects the declared incompatible native contract.
There is no qualified ONNX/WASM browser inference path for this exact adapter.

Use a local Python runtime to generate predictions, then import the resulting
review bundle in the entirely static app. The receipt retains model/runtime
pins, scores, offsets, settings, status and the explicit absence of clinical
validation. The review layer labels the producer as imported native inference.
This procedure does not turn the app into a server or qualify browser inference.

```sh
uv tool run --from huggingface_hub==2.1.1 hf download \
  na399/bpsd-gliner2.5-base-lora-20261012 \
  --revision 5cb60383b4b8dd361841e307e54f6e17b68b6fa7 \
  --local-dir work/bpsd-adapter
uv sync --locked --project tools/gliner-onnx
uv run --locked --project tools/gliner-onnx python scripts/run_bpsd_native.py \
  --adapter work/bpsd-adapter \
  --notes tests/fixtures/lora-clinical-samples.json \
  --out work/bpsd-predictions.json
node scripts/import_native_predictions.mjs \
  work/bpsd-predictions.json work/bpsd-review.nmt.zip
```

The first native run downloads the pinned base; use `--offline` after it is
cached. Use CPU with adequate RAM; no GPU, paid job or fine-tuning is required.
The runner validates adapter/schema SHA-256 values and the installed Git runtime.
Run it only on authorized local notes. Receipts and review bundles include note
text: keep them private and outside the static site. Default logs contain only
counts and status. The demonstration used existing synthetic notes only.

The locked PyTorch 2.6 CPU run completed all 27 notes with 134 spans. Their
positions and attribute labels matched the independent PyTorch 2.14 CPU run;
this verifies reproducibility of those synthetic outputs, not clinical
correctness. A synthetic hallucination example returned “seeing children beside
the bed” at code-point offsets `[17,47)`, score about 0.993. Four existing BPSD
notes produced 6, 0, 7 and 8 spans respectively. A completed run with no spans is
still an omission-review case, not a clinical negative result.

The tested repository did not provide a LICENSE or an explicit redistribution
grant for the adapter. Do not include its weights in Git, the public model
catalog, a static deployment or the transfer bundle. The base's Apache-2.0
license does not grant rights to an independently trained adapter. Resolve
adapter redistribution permissions before any release offering its weights.
Clinical validation and a faithful browser codec/export remain separate release
gates. The model card's synthetic development metrics are not clinical evidence.
