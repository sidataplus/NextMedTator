/** Step 4 batch analysis: CPU usage, file selection, resumable queue status and paged file list. */
import { node, button, labeled, labelButton, disclosure } from './assist-dom.mjs';
import { documentKey } from './assist-legacy.mjs';
import { defaultCpuThreads } from './inference-options.mjs';
import { queueCounts, batchReport } from './batch-queue.mjs';
import { localDownload } from './bundle.mjs';

const PAGE_SIZE = 50;
const noteKey = ann => ann._diskKey ?? documentKey(ann._filename ?? 'document', ann.text ?? '');

/** The Analyze Selected button moves here so it sits with the files it analyzes. */
export function renderBatch(assist, anns, analyzeSelected) {
    const docs = disclosure(assist, 'batch', `Batch Analysis (${assist.selected.size} selected)`);
    docs.setAttribute('aria-label', 'Files to analyze');
    docs.append(node('p', 'Check files, then click Analyze Selected. Files run one at a time; finished results stay available.', { class: 'muted' }));
    const cpu = node('select', null, { 'aria-label': 'Batch CPU usage', 'data-testid': 'assist-batch-cpu', disabled: assist.busy });
    for (const [value, label] of [['auto', `Automatic (${defaultCpuThreads()} threads)`], ['low', 'Low (1 thread)'], ['balanced', 'Balanced (up to 4 threads)']])
        cpu.append(node('option', label, { value }));
    cpu.value = assist.batchCpu ?? 'auto';
    cpu.addEventListener('change', () => { assist.batchCpu = cpu.value; });
    docs.append(labeled('CPU Usage', cpu), node('p', 'Automatic uses the GPU when available, otherwise all but one CPU core. Low and Balanced leave more CPU free.', { class: 'muted' }));
    const queuedByKey = new Map((assist.batchQueue?.notes ?? []).map(n => [n.key, n]));
    const selections = node('div', null, { class: 'row' });
    selections.append(
        button('Select All', () => {
            for (const ann of anns)
                if (ann._diskKey || typeof ann?.text === 'string')
                    assist.selected.add(noteKey(ann));
            assist.render();
        }, { disabled: assist.busy, id: 'assist-select-all' }),
        button('Clear Selection', () => { assist.selected.clear(); assist.render(); }, { disabled: assist.busy, id: 'assist-select-none' }));
    docs.append(selections);
    selections.append(button('Select Unfinished', () => {
        assist.selected.clear();
        for (const ann of anns) {
            const key = noteKey(ann);
            if (queuedByKey.get(key)?.status !== 'completed')
                assist.selected.add(key);
        }
        assist.render();
    }, { disabled: assist.busy, id: 'assist-select-unfinished' }));
    if (assist.batchQueue)
        docs.append(...queueStatus(assist));
    // Bound DOM size even when the corpus contains thousands of files.
    const pages = Math.ceil(anns.length / PAGE_SIZE), page = Math.min(assist.batchPage ?? 0, pages - 1);
    if (pages > 1) {
        const navigation = node('div', null, { class: 'row' });
        navigation.append(
            labelButton(button('Previous', () => { assist.batchPage = page - 1; assist.render(); }, { disabled: page === 0 }), 'Previous files'),
            node('span', `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, anns.length)} of ${anns.length}`),
            labelButton(button('Next', () => { assist.batchPage = page + 1; assist.render(); }, { disabled: page === pages - 1 }), 'Next files'));
        docs.append(navigation);
    }
    for (const ann of anns.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
        if (!ann?._diskKey && !ann?.text && ann?.text !== '')
            continue;
        docs.append(fileRow(assist, ann, queuedByKey.get(noteKey(ann))));
    }
    docs.prepend(analyzeSelected);
    return docs;
}

function queueStatus(assist) {
    const counts = queueCounts(assist.batchQueue), controls = node('div', null, { class: 'row' });
    const summary = node('p', `${counts.completed} completed · ${counts.failed} failed · ${counts.pending + counts.cancelled} unfinished`, { 'data-testid': 'assist-batch-summary' });
    const bar = node('progress', null, { max: counts.total, value: counts.completed + counts.failed, 'aria-label': 'Overall queue progress' });
    bar.className = 'full';
    const resume = options => () => assist.perform(() => assist.analyzeDocuments(assist.allDocuments(), { batch: true, resume: true, ...options }));
    const exportReport = () => {
        const report = batchReport(assist.batchQueue, { blind: assist.mode === 'blind' });
        localDownload(new TextEncoder().encode(JSON.stringify(report, null, 2)), `batch-${assist.batchQueue.id}.json`, 'application/json');
    };
    controls.append(
        button('Resume', resume(), { disabled: assist.busy || !assist.model || counts.pending + counts.cancelled === 0, id: 'assist-batch-resume' }),
        button('Retry Failed', resume({ retryFailed: true }), { disabled: assist.busy || !assist.model || counts.failed === 0, id: 'assist-batch-retry' }),
        button('Export Report', exportReport, { disabled: assist.busy, id: 'assist-batch-report' }));
    const note = assist.collection
        ? 'Each finished file and the queue status are saved together on this device. Resume skips finished files and checks the model, schema, threshold and review mode. Export a backup to keep a copy.'
        : 'Resume skips finished files and checks the model, schema, threshold and review mode. Enable recovery to keep the queue across reloads (saved every 10 files and when stopping). The report lists file names and statuses.';
    return [summary, bar, controls, node('p', note, { class: 'muted' })];
}

function fileRow(assist, ann, queued) {
    const key = noteKey(ann);
    const input = node('input', null, { type: 'checkbox', disabled: assist.busy, 'aria-label': ann._filename ?? 'document' });
    input.checked = assist.selected.has(key);
    input.addEventListener('change', () => { if (input.checked) assist.selected.add(key); else assist.selected.delete(key); assist.render(); });
    const row = node('label', null, { class: 'check' });
    row.append(input, node('span', ann._filename ?? 'document'));
    if (assist.collection)
        row.append(button('Open', () => assist.perform(() => assist.openCollectionNote(key)), { disabled: assist.busy, title: 'Load this file from disk', id: 'assist-collection-open-note' }));
    if (queued)
        row.append(node('span', queued.status, { class: 'badge', 'data-testid': 'assist-note-status', title: queued.error ?? `${queued.attempts} attempts` }));
    return row;
}
