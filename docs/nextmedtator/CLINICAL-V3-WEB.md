# Clinical v3 adapters in the browser

Keep the **base** adapter for the current desktop workflow. It has better
label agreement on the fixed synthetic set. Keep **small** as a separate option
for a lower memory budget. The app does not download or substitute either model
without a local package import. Weights are outside Git and the public catalog.

## Model selection

Both releases pass their six official synthetic CPU smoke cases. Both use the
same verified release runtime and registry. The comparison keeps the full
18-query prompt: six core labels, five assertion labels, three experiencer
labels, and four time-frame labels. It uses each release's selected threshold.

| Check on 96 fixed synthetic cases | Small | Base |
| --- | ---: | ---: |
| Forced-anchor axis label matches | 70/96 | **89/96** |
| Exact anchor returned, any core type | 88/96 | **95/96** |
| Exact anchor with the expected axis value | 64/96 | **88/96** |
| Assertion label matches | 41/48 | 45/48 |
| Time-frame label matches | 18/24 | 21/24 |
| Experiencer label matches | 11/24 | 23/24 |
| Fixed core threshold | 0.7 | 0.6 |

This is label agreement with generated references. Anchor coverage accepts any
core type at the exact position. It is not typed entity recall. Some older
resolved/recent labels are ambiguous. The set has no clinician review. The
prior unadapted small experiment used a different prompt; its score is not a
controlled adapter comparison. See the full [small](qualification/clinical-v3-web-small-comparison.json)
and [base](qualification/clinical-v3-web-base-comparison.json) case reports.

Pinned releases:

- `na399/clinical-evidence-gliner2.5-small-lora-v3-act-sol@82386c7a9776d3c14ed73d6310273a1c9d354d55`
- `na399/clinical-evidence-gliner2.5-base-lora-v3-act-sol@b5db08ccd2581690f30a448428ba7659e1469eeb`
- Small base: `fastino/gliner2.5-small-v1@7132dc4561c3f94563c6147e75ffa8ef34c4964a`
- Base base: `fastino/gliner2.5-base-v1@ca906247640776a07753514055be9726f9080ead`

## Changes for the web

The new `--clinical-release` option verifies the reviewed helper, all 91 runtime
files, adapter bytes, base bytes and schema before it imports the release
runtime. Installed upstream GLiNER alone is not this release's source contract.
The helper hash is checked before its Python code runs. The release runtime
fingerprint is `aec77e5692a8cf808fc0568a64b5ad882f4b8bbdedf6c3ba7b7f90b1a3d066d7`.
`sourceCodeRevision` identifies the locked upstream dependency baseline;
`clinicalRelease.runtimeFingerprint` identifies the code actually used here.

The exporter merges LoRA into the base, retains source abstention, and exports
only the model and attribute graphs. It removes unused record, relation and
classification outputs. The decoder does not use untrained record heads to
bind clinical fields. The worker frees its graph-file copies after session
creation. Offline installation still uses the verified original package.

Release packages always use all 18 queries, even when a scope selects one family
or one axis. A scope filters the output. It does not change the trained prompt.
Custom concept queries require another package and fail with an explicit
message. The core threshold is fixed in the UI and worker: 0.6 for base, 0.7 for
small. All axis values use one-value softmax with no attribute threshold. Older
packages keep their existing prompts, adjustable thresholds and run identities.

The worker uses up to four WASM threads on an isolated page. It uses one thread
when shared memory is unavailable. This is a CPU path. FP32 remains the checked
precision; INT8 and WebGPU are not qualified by these results.

## Browser measurements

These measurements use local graph files, Chromium 151.0.7922.173, ORT Web
1.23.2, FP32, a four-core CPU quota and a 16 GiB memory limit. No other model job
runs during measurement. The page calls the app runtime directly. Two full
calls warm the model. All 96 returned span sets and shared-axis decisions match
the independent release helper exactly for both sizes. Maximum core score
error is 4.10e-6 for base and 2.47e-6 for small.

| Four-thread measurement | Small | Base |
| --- | ---: | ---: |
| Package bytes | 301,708,146 | 758,143,803 |
| Local graph fetch and session load | 2.06 s | 3.73 s |
| Median sentence inference | 321 ms | 729 ms |
| P90 sentence inference | 356 ms | 778 ms |
| Sampled renderer PSS peak, including load | 1.67 GiB | 3.27 GiB |
| Sampled Chromium tree PSS peak | 1.85 GiB | 3.45 GiB |
| Observed WASM allocation capacity | 0.89 GiB | 2.09 GiB |

The controlled base thread test uses the same first 12 sentences with three
repeats each. Median time is 1,933 ms with one thread and 753 ms with four,
about 2.57 times faster. P90 is 2,056 ms and 797 ms. This result supports the
four-thread cap on this host. It does not establish speed on phones or tablets.

Sentence time includes JavaScript tokenization, span decode and all three axis
groups. It excludes model load, network download, ZIP import, UI drawing and
worker transfer. Memory is sampled every 100 ms and can miss short peaks. WASM
capacity is allocated memory, not live use. The listed metrics overlap; do not
add them. These are benchmark-page peaks, not full-app peaks. Base remains a
large local model. Do not treat this export as a low-memory mobile release.

Raw reports: [small](qualification/clinical-v3-web-small-web-t4.json),
[base](qualification/clinical-v3-web-base-web-t4.json),
[one-thread control](qualification/clinical-v3-web-base-web-control-t1.json),
[four-thread control](qualification/clinical-v3-web-base-web-control-t4.json).

## Source and numerical checks

The locked exporter uses Torch 2.6.0 CPU. The independent release helper uses
Torch 2.11.0 CPU. For each adapter, five identical short source cases have exact
span/type/axis decisions across these environments. The 769-token helper smoke
has a different length from the bounded export fixture; it is not included in
this bridge count. The full 96-case browser comparison supplies a larger check
against the independent helper. See the
[small](qualification/clinical-v3-web-small-release-bridge.json) and
[base](qualification/clinical-v3-web-base-release-bridge.json) bridge reports.

Each exported package has eight source cases, eight candidate fixtures, and
one attribute-head fixture. One repeated-sentence base fixture changes candidate
array order under WASM because of near-equal scores. It passes exact legal
span-set comparison within each query and the unchanged score tolerance. The
report keeps the failed raw positional checks as `rawCandidateChecks`. Candidate
coordinates, null logits and attribute scores still have strict checks. Missing
or extra spans, duplicate candidates or changed scores fail conformance. This
does not qualify truncated near-tie candidate sets on every possible sentence.

Export reports contain exact tensor loading, merge error, native graph checks
and package hashes: [small](qualification/clinical-v3-web-small-export.json),
[base](qualification/clinical-v3-web-base-export.json). The PR contains no weights.

The final app checks pass: 141 unit tests, 12 packager tests, four generated-note
validation tests, both static builds and their 5,081/64-file asset inventories.
Both packages pass all 17 real ORT Web fixtures, offline installation/restart,
inference, review, comparison, export/reopen, model lineage, and original
Vue/CodeMirror annotation operations. The original UI and review-workspace
regression tests pass. See the [base](qualification/clinical-v3-web-base-browser.json)
and [small](qualification/clinical-v3-web-small-browser.json) browser gates.

## Full-note diagnostics

Both adapters complete all 27 supplied synthetic notes offline in the review
workspace. Base also completes all notes in the original UI. Both base views
have identical agreement results. Original-UI auto apply, duplicate prevention,
portable export and machine provenance pass. Screenshots stay in local test
artifacts and can be reproduced with the browser gate.

| Typed exact-anchor agreement with 618 generated references | Small | Base |
| --- | ---: | ---: |
| Predictions | 331 | 412 |
| Matched references | 281 | 317 |
| Precision | **84.9%** | 76.9% |
| Recall | 45.5% | **51.3%** |
| F1 | 59.2% | **61.6%** |
| Assertion on matched labeled anchors | 82.9% | 87.3% |
| Experiencer on matched labeled anchors | 98.1% | 97.4% |
| Time frame on matched labeled anchors | 77.5% | 82.1% |

Base has better recall and F1 on these notes and better label agreement on the
96 sentence cases. Small has better anchor precision and uses less memory.
The choice of base is for the current engineering workflow. It does not make
base the safest model for every clinical task.

All seven exact negated-pain reference anchors remain missed by base in the
full notes. Its 61.6% F1 is below the archived job 17089 report's 64.5%. The
runtime, prompt and weights changed; this is not a controlled old/new comparison.
Do not erase these misses or infer clinical reliability from successful runtime
checks. See [small workspace](qualification/clinical-v3-web-small-notes-workspace.json),
[base workspace](qualification/clinical-v3-web-base-notes-workspace.json),
[base original UI](qualification/clinical-v3-web-base-notes-original.json), and
the complete [small](qualification/clinical-v3-web-small-notes-predictions.json)
and [base](qualification/clinical-v3-web-base-notes-predictions.json) predictions.
Note-gate timings are separate from the controlled sentence benchmark; some
gate runs overlapped and are not used as speed measurements.

## Attribution remains experimental

The bounded native probe uses three sentences, PAD and MASK context baselines,
and 16/32/64-point integration. The target is the predicted label minus its
fixed runner-up. Anchors stay fixed. Gradients run in batches of two.

| Points | Complete paths, out of six | Top cue matches | Stable vs prior grid |
| --- | ---: | ---: | ---: |
| 16 | 0 | 4 | not checked |
| 32 | 0 | 6 | 1 |
| 64 | 1 | 6 | 4 |

Completeness needs absolute error below 0.05 and relative error below 5%.
Stability needs the same top token, top-three Jaccard at least 0.5 and signed
cosine at least 0.95. All failures and signed scores remain in the
[bounded report](qualification/clinical-v3-web-base-ig-bounded.json).

The first probe reached 128/256 points on selected paths. One PAD path passed at
128; a different PAD path still failed at 256. That run was interrupted. Its
[partial log summary](qualification/clinical-v3-web-base-ig-high-point.json)
is not a complete six-case result. Native timings had competing jobs and are
not used as performance evidence. More points alone do not qualify the method.

No adapted-model WASM gradient graph or batched 16/32/64-point browser IG has
passed qualification here. Clinical cue highlighting stays disabled. The
96-case set checks label decisions and stores cue positions; it is not a
96-case attribution result.

## Clinical reliability

Technical conformance and synthetic agreement do not prove clinical reliability.
Use separate clinician-reviewed notes from several sites to test typed spans,
each axis and cue positions. Keep patients and note templates separate from
training. Include negation, history, family history, uncertainty and conflicting
statements. Report precision, recall, confidence intervals and error counts by
site and group. Measure false positives and missed evidence separately.

Choose any calibration or abstention rule on a separate development set. Check
that removing a proposed cue changes the selected margin, and that replacing
irrelevant text does not. Test randomization controls. Then compare unaided
review with assisted review on unseen notes. Measure corrections and time saved.
Run a silent pilot before clinical use. This PR does not supply that evidence.

See the [reproduction steps](../../experiments/clinical-v3-web/README.md).
