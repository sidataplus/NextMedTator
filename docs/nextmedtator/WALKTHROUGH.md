# Synthetic walkthrough

The sample corpus is original synthetic text, not patient data. All prepared suggestions are explicitly **authored examples, not GLiNER predictions**. The provisional schema is not asserted to be the final Clinical-Evidence training grammar.

## Assisted

1. Start the preview, leave the workflow on Assisted annotation and set your local annotator identifier.
2. Choose Try synthetic sample, then Show authored suggestions on document 1.
3. The suggestion labels the mother's diabetes as belonging to the patient. Edit the occurrence and change experiencer to family.
4. Select the second `diabetes` in the source, choose Add selected evidence and set assertion to negated. This teaches omission review rather than merely accepting proposed spans.
5. Choose Review completeness only after checking the whole document across the schema families. Accepting suggestions alone does not make review complete.
6. Freeze a human snapshot, then export the native project. Original machine examples, human records and review history remain separate.

Documents 2-5 cover measurements, treatments, events and function, including CRLF, Thai and compound Unicode characters. Source files remain unchanged; textarea normalization has an explicit map back to canonical source offsets.

## Blind, then compare

Start a new project in Blind annotation. There are no visible suggestions or predictive counts. Annotate independently and freeze the human snapshot. Only then prepare/import a machine run and choose Reveal comparison.

Open Compare & adjudicate. Select one same-configuration run per document and freeze a machine comparison layer. Compare that layer with the frozen human snapshot. Only completely reviewed reference documents and successful complete machine coverage enter the default scoring. No records in a failed model run are not evidence of a negative case.

## Two human annotators

Export a blind assignment bundle for a separate annotator. It excludes previous predictions, snapshots and review history. Import the returned snapshot after independent work is frozen. Editing the current human draft and adjudicating it creates a third snapshot with parent hashes and a rationale. Inputs are never overwritten. Record completeness separately; importing a final-looking file does not make it gold.

## Local recovery

Privacy & storage explains what remains in this browser. Enabling recovery requires explicit consent. In this preview, recovery checkpoints are explicit, not an unnoticed autosave. A second tab cannot silently overwrite an existing recovery version. Export a portable project; browser recovery is not your only copy.

## Import/export

Text, mapped JSONL, representable MedTator XML and native bundles are supported. New schema JSON creates a new schema-specific project rather than reinterpreting existing records. Legacy XML export emits a loss report because it cannot preserve the full provenance/history model. Model packages and clinical project bundles are different file types despite both using ZIP containers.
