# Clinical v3 adapter checks

These scripts use synthetic text. They do not prove clinical reliability.
Weights stay outside Git. Run each model size in a fresh Python process.

## Prepare the model files

Download the full adapter release. It must include `usage.py`, its runtime,
the schema, the manifest, and the adapter tensors. Use these exact revisions:

| Size | Adapter repository | Revision | Base revision |
| --- | --- | --- | --- |
| small | `na399/clinical-evidence-gliner2.5-small-lora-v3-act-sol` | `82386c7a9776d3c14ed73d6310273a1c9d354d55` | `7132dc4561c3f94563c6147e75ffa8ef34c4964a` |
| base | `na399/clinical-evidence-gliner2.5-base-lora-v3-act-sol` | `b5db08ccd2581690f30a448428ba7659e1469eeb` | `ca906247640776a07753514055be9726f9080ead` |

The bases are `fastino/gliner2.5-small-v1` and `fastino/gliner2.5-base-v1`.
Install the release helper's requirements in a separate environment. The measured
helper environment used Python 3.12.14, Torch 2.11.0 CPU, Transformers 4.57.6,
PEFT 0.21.2, NumPy 2.5.3 and protobuf 7.36.2. Protobuf lets Transformers handle
the expected tokenizer conversion exception. No checkpoint was changed.

## Compare both adapters

```sh
python scripts/compare_clinical_v3.py --size base \
  --release work/clinical-adapter/base \
  --base work/clinical-adapter/base-checkpoint \
  --out work/clinical-adapter/base-comparison.json
```

Repeat with `--size small` and its paths. The helper checks all release assets
before it loads the model. Each run uses all six core queries and all 12 shared
axis queries. `cue_cases.py` contains the 96 fixed cases. Some legacy labels for
resolved and recent events are ambiguous. The report keeps every case and
prediction. Forced-anchor label agreement is separate from returned-anchor
coverage. Coverage accepts any core type at the exact anchor; it is not typed
entity recall. The case set also contains cue positions, but it has no clinician
review. These numbers do not measure cue attribution quality on all 96 cases.

## Check browser inference

Export each package with the verified release. See the
[packager instructions](../../tools/gliner-onnx/README.md). Extract its files into
`work/clinical-adapter/base-graphs` or `small-graphs`. Keep the comparison JSON
beside these folders. Install the app's frozen pnpm dependencies and Playwright
in the Python environment. Set up local Chromium.

```sh
python scripts/benchmark_clinical_web.py --assets work/clinical-adapter \
  --size base --threads 4 --out work/clinical-adapter/base-web-t4.json
python scripts/benchmark_clinical_web.py --assets work/clinical-adapter \
  --size small --threads 4 --out work/clinical-adapter/small-web-t4.json
```

The runner starts an isolated local server on port 8956. It serves ONNX Runtime
Web from the frozen app dependency. It checks exact spans and shared-axis
decisions against the official helper on each sentence. Core score error must
be at most 1e-4. It fails on browser errors or changed decisions.

For a thread comparison, run the same `--limit 12 --repeats 3` with `--threads 1`
and `--threads 4`. Use a fresh browser for each run. Stop other model jobs first.
Two full calls warm the model. Load time includes local graph fetch and session
creation. Sentence time includes tokenization, span decode and all three axis
groups. This page calls the app runtime directly. It does not measure UI drawing,
worker transfer, network download, ZIP import or the full app's memory peak.

Linux PSS is sampled every 100 ms for the new Chromium processes, including
startup. WASM capacity records allocation rather than live use. JS heap, WASM,
PSS and VmHWM overlap; do not add them. A short memory peak can occur between
samples. The test needs `/proc`, `/usr/bin/chromium`, and sufficient memory.

The separate real-package browser gate checks the worker and the app:

```sh
NMT_LORA_PACKAGE=work/clinical-v3-base.nmt-model.zip \
  python tests/browser/test_lora_model.py
```

## Check attribution

```sh
python experiments/clinical-v3-web/attribution_probe.py \
  --release work/clinical-adapter/base \
  --base work/clinical-adapter/base-checkpoint \
  --case-ids assertion-01,temporality-01,experiencer-01 --max-points 64 \
  --out work/clinical-adapter/base-ig-bounded.json
```

The target is the predicted label logit minus its fixed runner-up logit. The
anchor stays fixed. The path replaces context embeddings with PAD or MASK;
attention stays unchanged. Gauss–Legendre integration uses 16/32/64 points in
batches of two. Completeness needs absolute error below 0.05 and relative error
below 5%. Stability needs the same top token, top-three Jaccard at least 0.5,
and signed cosine at least 0.95. Use `--max-points 128` or `256` to extend it.
The output keeps signed token scores and every failure.

This is a native PyTorch check. Its timings had competing qualification jobs
and are not performance measurements. It does not qualify a WASM gradient
graph, batched 16/32/64-point browser integration or a clinical cue UI. The
base adapter still fails completeness on five of six 64-point paths. Do not
enable clinical cue highlighting from these results.
