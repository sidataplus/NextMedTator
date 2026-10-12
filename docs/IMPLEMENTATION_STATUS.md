# Implementation status

NextMedTator's detailed capability and qualification status is maintained in
[the implementation status](nextmedtator/STATUS.md).

The 2026-10-08 model-selection follow-up makes the ClinicalEvidence GLiNER2.5
small v3 adapter the default source in both annotation views. Other clinical,
original, pinned Hub and local adapter sources use the verified local ONNX
conversion/import contract. No hosted inference or clinical weight
redistribution was added. See [model packages](nextmedtator/MODEL-PACKAGES.md),
[the exporter](../tools/gliner-onnx/README.md), and
[sample assessment](nextmedtator/SAMPLE_ADAPTER_ASSESSMENT.md).
