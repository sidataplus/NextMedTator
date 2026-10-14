# Long notes, review and disk-backed collections

Preview.11 adds on-demand model memory controls, GLiNER2.5 long-note windows,
paginated review with undo, and explicit disk-backed collections. The original
annotation editor remains the working surface. Follow the
[illustrated tutorial](../../tutorial/04-large-collections.md).

## Real-browser checks

Chrome 155.0.8059.40 on this Windows machine, with an NVIDIA RTX A4000.
Both original FP32 packages ran actual WebGPU inference on a 5,302-code-point
fictional note containing Unicode and repeated behavioral observations:

| Model | Windows | Suggestions | Exact source offsets | Full coverage |
|---|---:|---:|---|---|
| P10 | 7 | 164 | Passed | Passed |
| BPSD | 3 | 35 | Passed | Passed |

Both produced spans near the end of the note. Different window counts reflect
the packages' different complete prompts and encoded budgets. These counts are
technical regression results, not accuracy scores. A preceding repetitive BPSD
fixture yielded zero suggestions despite complete coverage; successful window
coverage does not imply that every relevant mention is detected.

For each model, a 100-note disk-backed queue passed pause, reload, explicit
model reload and resume. Previously completed run IDs were preserved. Completed
notes and queue outcomes were saved atomically; the inference worker was absent
after pause and completion. At most one open-note history remained resident
between completed results. Review checks covered accept/reject, group apply,
undo, filtering and keyboard rejection. Model packages remained unloaded after
page reload until explicitly requested.

### Actual process memory

The Windows process-tree sampler read OS counters every 250 ms. No forced GC,
working-set trimming or process priority changes were used.

| Model | Before explicit unload | 30 seconds after unload |
|---|---:|---:|
| P10 | 3379.4 MiB working set | 2279.0 MiB |
| BPSD | 4093.7 MiB working set | 1641.0 MiB |

These are observations from the workflow, not isolated model-memory estimates.
P10's preceding step also installed and read-back verified its offline package.
The two contexts ran sequentially in one Chrome process tree. Summed working
sets may double-count shared pages and exclude GPU VRAM. Unloading clears app
references and terminates the worker; browser/driver allocators control the
remaining memory. A return to startup memory is not promised. See the
[raw workflow receipt](validation/workflow-100-notes.json).

## 10,000-note storage test

The separate test imported 10,000 fictional notes totaling 9,208,890 bytes,
recovered an interrupted queue, rejected a stale concurrent save, streamed a
16,908,963-byte backup, restored it, and rejected/cleaned up a truncated backup.
Opening the first and last notes retained one editor note and one history;
the selector rendered only 50 rows.

The combined storage/backup sequence took 87.5 seconds, used 157.1 CPU seconds
(about 9.0% of this 20-logical-CPU machine on average), and peaked at 1,157.5 MiB
summed working set / 967.6 MiB private committed memory. This is a **storage
stress test, not 10,000-note inference**, and not a comparative benchmark against
the ordinary editor. [Raw receipt](validation/collection-10000-notes.json).

The final build repeated the 10,000-note check and additionally verified that
an editor change made during an in-flight save was checkpointed.
[Final storage receipt](validation/collection-final.json).

## Reproduce

Prepare `work/p10.nmt-model.zip` and `work/bpsd.nmt-model.zip` using
[CURRENT-MODELS.md](CURRENT-MODELS.md), then:

```sh
pnpm build:production
uv run --locked python scripts/serve_static.py --directory dist --port 4299
# In another terminal (Windows for the OS memory sampler):
uv run --locked python tests/browser/test_workflow_improvements.py
uv run --locked python tests/browser/test_large_collection_storage.py
```

Screenshots and raw runs go to gitignored `temp/browser-validation/`.
The default workflow uses 100 notes per model; `NMT_COLLECTION_COUNT=5` runs a
shorter queue regression. `NMT_IMPROVEMENTS_URL` selects a deployment URL and
`NMT_WORKFLOW_OUTPUT` selects a separate output subdirectory.

Long-note attributes remain window-local; cross-window mentions and relations
are not stitched. Disk-backed bulk inference supports Assisted and Auto apply;
blind notes must be opened and frozen individually. Streaming backup export
requires desktop Chrome/Edge's file picker. Wider device qualification and
clinical accuracy evaluation were outside this change's scope.

## Final local release gates

The final app build is `415b760a1cf1bfce026168a573df302a84ede3acaa0194d49fc19111773e5a31`. Both models passed the full long-note/review/unload workflow again with five-note pause/reload/resume queues, including removal of stale visual hints after undo. [Final browser receipt](validation/workflow-final.json).

- JavaScript: 208 passed, one existing skip.
- Python validation: 27 passed, one existing skip.
- Original annotation workflow, assistance layout and fresh no-download startup: passed.
- Maintained-source syntax and static asset inventory: passed.
