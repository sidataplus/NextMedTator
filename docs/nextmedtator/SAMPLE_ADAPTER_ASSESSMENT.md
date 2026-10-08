# NextMedTator Sample Adapter Assessment

## Result

The v3 adapters do extract some exact mentions, but this sample does not support unattended auto-annotation. On the evaluable sample annotations, native-family exact-span micro F1 was 0.165 for small and 0.174 for base. Small had higher precision (0.476 vs. 0.316); base had slightly higher recall (0.120 vs. 0.100). This is a small, mixed-format demonstration corpus with substantial offset defects, not a clinical validation set. Do not interpret the 0.009 F1 difference as evidence that base is clinically superior.

F/R/P below means micro F1 / recall / precision. Exact matches require both the half-open source offsets and label to match. `Direct` asks each model for the task's schema labels. `Native` maps only declared task labels in the explicit crosswalk to the v3 `clinical_condition` and `clinical_treatment` families; unsupported labels are reported separately. Thresholds are the frozen package values: small 0.70, base 0.60, so this is not a threshold-matched model-size comparison.

| Sample annotation set | Scored docs / read | Direct gold / native gold | Direct small F/R/P | Direct base F/R/P | Native small F/R/P | Native base F/R/P |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| AMIA21_WORKSHOP | 8 / 10 | 21 / 19 | 0.091 / 0.048 / 1.000 | 0.069 / 0.048 / 0.125 | 0.261 / 0.158 / 0.750 | 0.312 / 0.263 / 0.385 |
| ENTITY_RELATION_TASK, annotator A | 5 / 5 | 75 / 41 | 0.000 / 0.000 / 0.000 | 0.000 / 0.000 / 0.000 | 0.087 / 0.049 / 0.400 | 0.039 / 0.024 / 0.100 |
| ENTITY_RELATION_TASK, annotator B | 3 / 5 | 23 / 12 | 0.000 / 0.000 / 0.000 | 0.000 / 0.000 / 0.000 | 0.235 / 0.167 / 0.400 | 0.133 / 0.083 / 0.333 |
| ERROR_ANALYSIS_TASK, gold only | 2 / 5 | 21 / 21 | 0.000 / 0.000 / 0.000 | 0.000 / 0.000 / 0.000 | 0.000 / 0.000 / 0.000 | 0.000 / 0.000 / 0.000 |
| IAA_TASK, annotator A | 4 / 5 | 26 / 26 | 0.000 / 0.000 / 0.000 | 0.129 / 0.077 / 0.400 | 0.188 / 0.115 / 0.500 | 0.158 / 0.115 / 0.250 |
| IAA_TASK, annotator B | 2 / 5 | 13 / 13 | 0.000 / 0.000 / 0.000 | 0.000 / 0.000 / 0.000 | 0.000 / 0.000 / 0.000 | 0.000 / 0.000 / 0.000 |
| MINIMAL_TASK | 2 / 3 | 15 / 15 | 0.273 / 0.200 / 0.429 | 0.370 / 0.333 / 0.417 | 0.417 / 0.333 / 0.556 | 0.452 / 0.467 / 0.438 |
| OLEA_TASK | 3 / 3 | 31 / 31 | 0.000 / 0.000 / 0.000 | 0.000 / 0.000 / 0.000 | 0.000 / 0.000 / 0.000 | 0.000 / 0.000 / 0.000 |
| VAERS_20_NOTES | 3 / 20 | 22 / 22 | 0.077 / 0.045 / 0.250 | 0.240 / 0.136 / 1.000 | 0.303 / 0.227 / 0.455 | 0.400 / 0.318 / 0.538 |

Across these annotation sets, direct-schema micro scores were small 0.038 / 0.020 / 0.278 and base 0.078 / 0.045 / 0.324 (247 gold spans). Native-family scores were small 0.165 / 0.100 / 0.476 and base 0.174 / 0.120 / 0.316 (200 mapped gold spans). Native offset-only scores, ignoring family, had the same matched counts as family-plus-offset scores in every evaluable set. These pooled figures combine different schemas and separate A/B annotations; they are descriptive, not independent-patient estimates. No confidence intervals are warranted from this sample.

## Coverage And Limits

- All 71 annotated XML files parsed, and all 71 texts were attempted successfully by both inference views for both adapters. The evaluator writes aggregates only; it does not write note text, document IDs, or prediction rows. It evaluates the embedded XML text against its UTF-16 offsets converted to Python code-point offsets and validates every usable gold surface against that text.
- Exact span scoring includes 32 documents and 247 valid single-span gold mentions. Twenty-nine documents were quarantined in full because of invalid offsets or discontinuous spans: 64 invalid-offset annotations and one discontinuous annotation were found. The 10 `DOCUMENT_LEVEL_TASK` documents contain no span gold and are reported as unscorable for exact-span metrics, not as false positives.
- The sample has 27 document-level annotations and 26 relations; neither is scored as a span. The `ERROR_ANALYSIS_TASK` run uses only its gold-standard corpus; its `system_results` files are not consumed. A/B annotation sets remain separate.
- The native crosswalk maps 200 eligible spans. It leaves 47 eligible spans unsupported: `Severity` 2, `SVRT` 27, and `DATE` 18. These are not relabeled as conditions or treatments. The `OLEA_TASK` has Chinese-valued schema metadata and no exact model hits; this is insufficient to characterize multilingual capability.
- `VAERS_20_NOTES` has no separate `raw_txt` directory in the sample. Its embedded XML text was evaluated; 17 of its 20 documents were quarantined, leaving only 22 scored gold spans. This task is especially weak evidence for quality.
- The conditional attribute check maps `Positive` to `affirmed`, `Negated` to `negated`, `Hypothetic` to `hypothetical`, and `Possible` to `uncertain`. Among 152 compatible gold certainty values, direct small agreed on 3/5 exact-span attribute outputs, direct base 6/9; native small agreed on 15/15 and native base 18/21. These are conditional on exact span matches, covering only 5/152, 9/152, 15/152, and 21/152 gold attributes, respectively. Do not read the 100% small native value as high attribute recall. `experiencer` and `time frame` are not scored because these sample schemas do not provide a defensible mapping to those axes.
- The sample README describes the text as extracted from VAERS datasets. This benchmark does not test the requested adapters on the original unadapted GLiNER 2.5 checkpoints, relation extraction, document-level classification, clinical correctness, or review workflow.

## Receipts

The complete aggregate results are retained for [small](qualification/sample-v3-small.json)
and [base](qualification/sample-v3-base.json). They contain no note text,
document IDs or row-level predictions. The checked-in
[evaluator](../../scripts/evaluate_sample_tree.py) and offline tests reproduce
the scoring policy. The assessed cached weights match the selected Hub
releases: small `82386c7a9776d3c14ed73d6310273a1c9d354d55`, base
`b5db08ccd2581690f30a448428ba7659e1469eeb`; their exact config/weight hashes
are retained in the [small](qualification/clinical-v3-small-export.json) and
[base](qualification/clinical-v3-base-export.json) export receipts.

- Successful CPU Slurm job: `17612`, `COMPLETED`, exit `0:0`, elapsed `00:03:21`, submitted with the `medical-htr` group. It loaded both adapters sequentially with offline Hub settings.
- Sample source: `sidataplus/NextMedTator` commit `95d87b19e9daf07d8c5de3e870ac25ac918a6227`; input manifest SHA-256 `644833fdbd348154ac9cc8b2dcc75225f6826cb15c9499a2e7d757ef642347d9` (1 README, 8 selected schemas, 71 gold XML files, 36 raw-text inventory files).
- Evaluator SHA-256 `91620a55a7e9e4eecbe43e427417ef3ea87121b7d96e9ebe63603396c4470919`; focused tests SHA-256 `576c154b2b7fb0585c57c4ee6003db8a8d12755bfa2e30b3518034ef10c748fc`; 16 focused tests passed. ORCA staged source manifest SHA-256 `f40956778fa30282372e5488f13eda77af5a6c2fa8db7cc8ea9df9363ab93bd1`; launcher SHA-256 `b136aaecaff06f9a5a9effac7a6dc94f3e10b9a408552a2341a8a79ee77f480d`.
- Shared runtime: Python `3.12.13`, PyTorch `2.11.0+cu130`, Transformers `4.57.6`, PEFT `0.21.2`, NumPy `2.5.3`, Tokenizers `0.22.2`. Verified usage helper SHA-256 `f63e63d649ea52f16c22a0573b11070c333374e5ac1be935e2d66fbc5f0a1986`; schema registry SHA-256 `80f255076cde0237c3f176b45545807bb237cbc57af1d983c6550a6d6816f547`. All three native attribute axes were present (assertion 5 values, experiencer 3, time frame 4; each threshold 0.5).
- Small adapter: `na399/clinical-evidence-gliner2.5-small-lora-v3-act-sol`, content fingerprint `74af2ef71d072d4731d1a13898c52366380f7bf9310506cd7833235e5f428695`; base `fastino/gliner2.5-small-v1` revision `7132dc4561c3f94563c6147e75ffa8ef34c4964a`; threshold `0.70`.
- Base adapter: `na399/clinical-evidence-gliner2.5-base-lora-v3-act-sol`, content fingerprint `a1baa9e59ef0eaf73bb11fac6c5e391035ff6ee60a4d1e639678dcc9d15964d0`; base `fastino/gliner2.5-base-v1` revision `ca906247640776a07753514055be9726f9080ead`; threshold `0.60`.
- Aggregate output SHA-256: small `573ee2cf7c44c2cc1bbb6218d8d8592d5e3fd8af86966c3848b2d6de5efc5332`; base `7e3f85e2c80afbf51121e9c61adfb9635677824f6d03773244657fce5395a716`.

## Next Steps

1. Treat these adapters as suggestion-only and retain human review; neither adapter has adequate sample-wide exact-span recall for unattended acceptance.
2. Validate and repair the sample annotation offsets upstream with the dataset owners, preserving original annotations and provenance. Re-run only from a new pinned sample revision; do not silently drop or hand-correct the excluded gold.
3. Build a representative, independently reviewed development set and a separate held-out test set for the target workflow. Freeze patient/document partitions before threshold tuning and report both coverage and exact-span metrics.
4. Select task schemas with meaningful label descriptions and an owner-approved crosswalk to the two native families. Explicitly decide how `DATE`, severity, relations, and document-level labels should be evaluated rather than forcing them into span labels.
5. Tune thresholds only on development data and compare adapters at a matched operating point. Add the unadapted small/base GLiNER 2.5 checkpoints as baselines in that same evaluation.
6. Expand attribute mapping and agreement checks for assertion, experiencer, and time frame; keep attribute accuracy conditional on exact spans alongside attribute coverage.
