/** Step 4 batch analysis: adding files, filters, CPU usage, resumable queue status and a paged file list. */
import { node, button, labeled, labelButton, disclosure } from './assist-dom.mjs';
import { documentKey } from './assist-legacy.mjs';
import { defaultCpuThreads } from './inference-options.mjs';
import { queueCounts, batchReport } from './batch-queue.mjs';
import { localDownload } from './bundle.mjs';

const PAGE_SIZE = 50;
// Above these, loaded files are better kept on disk and opened one at a time.
export const OPEN_FILES_LIMIT = Object.freeze({ files: 100, chars: 5_000_000, lowMemoryChars: 1_000_000 });
const STATUS_FILTERS = [['all', 'All Files'], ['new', 'Not Analyzed'], ['unfinished', 'Unfinished'], ['completed', 'Completed'], ['failed', 'Failed'], ['many-tags', 'Many Tags']];
const STATUS_LABELS = { pending: 'Queued', running: 'Running', completed: 'Done', failed: 'Failed', cancelled: 'Stopped' };
const noteKey = ann => ann._diskKey ?? documentKey(ann._filename ?? 'document', ann.text ?? '');
const noteSize = ann => ann.bytes ?? ann.text?.length ?? 0;

export function formatSize(chars) {
    return chars >= 1048576 ? `${(chars / 1048576).toFixed(1)} MB` : chars >= 1024 ? `${Math.round(chars / 1024)} KB` : `${chars} B`;
}

/** Status filter for one file. Files outside the current queue count as not analyzed. */
export function matchesFilter(ann, queued, { text = '', status = 'all' } = {}) {
    if (text && !(ann._filename ?? 'document').toLowerCase().includes(text.toLowerCase()))
        return false;
    switch (status) {
        case 'new': return !queued;
        case 'unfinished': return !!queued && ['pending', 'running', 'cancelled'].includes(queued.status);
        case 'completed': return queued?.status === 'completed';
        case 'failed': return queued?.status === 'failed';
        case 'many-tags': return !!queued?.manyTags;
        default: return true;
    }
}

/** The Analyze Selected button moves here so it sits with the files it analyzes. */
export function renderBatch(assist, anns, analyzeSelected) {
    const docs = disclosure(assist, 'batch', `Batch Analysis (${assist.selected.size} selected)`);
    docs.setAttribute('aria-label', 'Files to analyze');
    const queuedByKey = new Map((assist.batchQueue?.notes ?? []).map(n => [n.key, n]));
    const available = anns.filter(ann => ann?._diskKey || typeof ann?.text === 'string');
    const selectedSize = available.reduce((sum, ann) => sum + (assist.selected.has(noteKey(ann)) ? noteSize(ann) : 0), 0);
    if (!available.length) {
        docs.append(analyzeSelected, node('p', 'Add text files to analyze several at once, or open files with the toolbar above.', { class: 'muted' }), addFiles(assist));
        return docs;
    }
    docs.append(analyzeSelected,
        node('p', assist.selected.size
            ? `${assist.selected.size} of ${available.length} files selected · ${formatSize(selectedSize)}. Files run one at a time; finished results are kept if you pause.`
            : 'Check files below, then click Analyze Selected. Files run one at a time; finished results are kept if you pause.', { class: 'muted', 'data-testid': 'assist-batch-selection' }));
    if (assist.batchQueue)
        docs.append(...queueStatus(assist));
    docs.append(addFiles(assist), ...memoryAdvice(assist, available));
    const filter = assist.batchFilter ?? { text: '', status: 'all' };
    const visible = available.filter(ann => matchesFilter(ann, queuedByKey.get(noteKey(ann)), filter));
    docs.append(filters(assist, filter, visible.length, available.length));
    const selections = node('div', null, { class: 'row' });
    const filtered = filter.text || filter.status !== 'all';
    selections.append(
        button(filtered ? `Select ${visible.length} Shown` : 'Select All', () => {
            for (const ann of visible)
                assist.selected.add(noteKey(ann));
            assist.rememberBatchView(); assist.render();
        }, { disabled: assist.busy || !visible.length, id: 'assist-select-all' }),
        button('Clear Selection', () => { assist.selected.clear(); assist.rememberBatchView(); assist.render(); }, { disabled: assist.busy, id: 'assist-select-none' }),
        button('Select Unfinished', () => {
            assist.selected.clear();
            for (const ann of available)
                if (queuedByKey.get(noteKey(ann))?.status !== 'completed')
                    assist.selected.add(noteKey(ann));
            assist.rememberBatchView(); assist.render();
        }, { disabled: assist.busy, id: 'assist-select-unfinished', title: 'Select every file that has not finished in the current batch' }));
    docs.append(selections, cpuUsage(assist));
    // Bound DOM size even when the corpus contains thousands of files.
    const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE)), page = Math.min(assist.batchPage ?? 0, pages - 1);
    if (pages > 1) {
        const navigation = node('div', null, { class: 'row' });
        navigation.append(
            labelButton(button('Previous', () => { assist.batchPage = page - 1; assist.render(); }, { disabled: page === 0 }), 'Previous files'),
            node('span', `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, visible.length)} of ${visible.length}`),
            labelButton(button('Next', () => { assist.batchPage = page + 1; assist.render(); }, { disabled: page === pages - 1 }), 'Next files'));
        docs.append(navigation);
    }
    const list = node('div', null, { class: 'file-list', role: 'group', 'aria-label': 'Files' });
    const view = assist.current(), currentKey = view.ann?._diskKey ?? view.key;
    for (const ann of visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE))
        list.append(fileRow(assist, ann, queuedByKey.get(noteKey(ann)), noteKey(ann) === currentKey));
    if (!visible.length)
        list.append(node('p', 'No files match this filter.', { class: 'muted' }));
    docs.append(list);
    return docs;
}

function filters(assist, filter, shown, total) {
    const row = node('div', null, { class: 'row filters' });
    const search = node('input', null, { type: 'text', placeholder: 'Filter by file name', 'aria-label': 'Filter files by name', 'data-testid': 'assist-batch-filter', 'data-focus-key': 'assist-batch-filter' });
    search.value = filter.text;
    search.addEventListener('input', () => { assist.batchFilter = { ...filter, text: search.value }; assist.batchPage = 0; assist.rememberBatchView(); assist.render(); });
    const status = node('select', null, { 'aria-label': 'Show files by status', 'data-testid': 'assist-batch-status-filter' });
    for (const [value, label] of STATUS_FILTERS)
        status.append(node('option', label, { value }));
    status.value = filter.status;
    status.addEventListener('change', () => { assist.batchFilter = { ...filter, status: status.value }; assist.batchPage = 0; assist.rememberBatchView(); assist.render(); });
    row.append(search, status);
    if (shown !== total)
        row.append(node('span', `${shown} of ${total} shown`, { class: 'muted', 'data-testid': 'assist-batch-shown' }));
    return row;
}

function cpuUsage(assist) {
    const cpu = node('select', null, { 'aria-label': 'Batch CPU usage', 'data-testid': 'assist-batch-cpu', disabled: assist.busy });
    for (const [value, label] of [['auto', `Automatic (${defaultCpuThreads()} threads)`], ['low', 'Low (1 thread)'], ['balanced', 'Balanced (up to 4 threads)']])
        cpu.append(node('option', label, { value }));
    cpu.value = assist.batchCpu ?? 'auto';
    cpu.addEventListener('change', () => { assist.batchCpu = cpu.value; });
    const options = node('div');
    options.append(labeled('CPU Usage', cpu), node('p', 'Automatic uses the GPU when available, otherwise all but one CPU core. Low and Balanced leave more CPU free for other work.', { class: 'muted' }));
    return options;
}

/** Text files go straight to on-disk storage, so adding hundreds of files does not fill this tab's memory. */
function addFiles(assist) {
    const box = node('div', null, { class: 'drop-zone', 'data-testid': 'assist-batch-drop' });
    const input = node('input', null, { type: 'file', multiple: true, accept: '.txt,text/plain', 'aria-label': 'Add text files to analyze', 'data-testid': 'assist-collection-import', disabled: assist.busy });
    const add = files => {
        const text = files.filter(file => /\.txt$/i.test(file.name) || file.type === 'text/plain');
        if (!text.length) { assist.error = true; assist.message = 'Only .txt files can be added here. Open annotated XML files with the toolbar above.'; assist.render(); return; }
        assist.perform(() => assist.addCollectionFiles(text));
    };
    input.addEventListener('change', () => { if (input.files.length) add([...input.files]); });
    box.addEventListener('dragover', event => { if (assist.busy) return; event.preventDefault(); box.classList.add('active'); });
    box.addEventListener('dragleave', () => box.classList.remove('active'));
    box.addEventListener('drop', event => { event.preventDefault(); box.classList.remove('active'); if (!assist.busy && event.dataTransfer?.files?.length) add([...event.dataTransfer.files]); });
    box.append(labeled(assist.collection ? 'Add Text Files to This Collection' : 'Add Text Files (.txt)', input),
        node('p', assist.collection ? 'Or drop .txt files here. They are stored with this collection on this device.' : 'Or drop .txt files here. They are stored on this device and opened one at a time, which keeps memory use low.', { class: 'muted' }));
    return box;
}

/** Many or large open files: suggest moving them to on-disk storage before a long batch. */
function memoryAdvice(assist, anns) {
    if (assist.collection || !anns.length)
        return [];
    const chars = anns.reduce((sum, ann) => sum + (ann.text?.length ?? 0), 0);
    const lowMemory = Number.isFinite(assist.deviceProfile?.memory) && assist.deviceProfile.memory <= 4;
    if (anns.length < OPEN_FILES_LIMIT.files && chars < OPEN_FILES_LIMIT.chars && !(lowMemory && chars >= OPEN_FILES_LIMIT.lowMemoryChars))
        return [];
    const annotated = anns.some(ann => ann.tags?.length) || assist.runs.size > 0;
    const box = node('div', null, { class: 'setup-hint', role: 'note', 'data-testid': 'assist-batch-memory' });
    box.append(node('p', `${anns.length} open files hold ${formatSize(chars)} of text in this tab${lowMemory ? ', and this device reports limited memory' : ''}. Storing them on this device opens one file at a time and lowers memory use during a long batch.`),
        button('Move Files to On-Disk Storage', () => assist.perform(() => assist.moveOpenFilesToCollection()), {
            id: 'assist-batch-move', disabled: assist.busy || annotated,
            title: annotated ? 'These files already have tags or results. Save them first, then add the text files here.' : 'Store these text files as a collection and close them in the editor',
        }));
    if (annotated)
        box.append(node('p', 'These files already have tags or results, so they stay open. Save your work, then add the plain text files above instead.', { class: 'muted' }));
    return [box];
}

function queueStatus(assist) {
    const counts = queueCounts(assist.batchQueue), controls = node('div', null, { class: 'row' });
    const manyTags = assist.batchQueue.notes.filter(n => n.manyTags).length;
    const parts = [`${counts.completed} completed`, `${counts.failed} failed`, `${counts.pending + counts.cancelled + counts.running} unfinished`];
    const summary = node('p', parts.join(' · '), { 'data-testid': 'assist-batch-summary' });
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
    if (assist.batchQueue.settings?.mode === 'auto' && counts.completed)
        controls.append(button('Undo Auto Apply for This Batch', () => assist.perform(() => assist.undoBatchAutoApply()), {
            disabled: assist.busy, id: 'assist-batch-undo',
            title: 'Remove the tags Auto Apply added to finished files; their suggestions stay for review',
        }));
    const note = assist.collection
        ? 'Each finished file and the queue status are saved together on this device. Resume skips finished files and checks the model, schema, threshold and review mode. Export a backup to keep a copy.'
        : 'Resume skips finished files and checks the model, schema, threshold and review mode. Enable recovery to keep the queue across reloads (saved every 10 files and when stopping). The report lists file names and statuses.';
    const rows = [summary, bar, controls];
    if (manyTags)
        rows.push(node('p', `${manyTags} ${manyTags === 1 ? 'file has' : 'files have'} many tags that may include false positives. Show “Many Tags” below and open each one to raise the threshold or review its suggestions.`, { class: 'setup-hint', 'data-testid': 'assist-batch-many-tags' }));
    rows.push(node('p', note, { class: 'muted' }));
    return rows;
}

function fileRow(assist, ann, queued, current) {
    const key = noteKey(ann);
    const input = node('input', null, { type: 'checkbox', disabled: assist.busy, 'aria-label': ann._filename ?? 'document' });
    input.checked = assist.selected.has(key);
    input.addEventListener('change', () => { if (input.checked) assist.selected.add(key); else assist.selected.delete(key); assist.rememberBatchView(); assist.render(); });
    const row = node('div', null, { class: `file-row${current ? ' current' : ''}`, 'data-testid': 'assist-batch-file' });
    const label = node('label', null, { class: 'check grow' });
    label.append(input, node('span', ann._filename ?? 'document', { class: 'file-name', title: ann._filename ?? 'document' }));
    row.append(label, node('small', formatSize(noteSize(ann)), { class: 'muted' }));
    if (queued) {
        const detail = queued.status === 'completed' && queued.suggestions != null ? ` · ${queued.suggestions}${queued.reused ? ' · reused' : ''}` : '';
        row.append(node('span', STATUS_LABELS[queued.status] + detail, { class: `badge ${queued.status}`, 'data-testid': 'assist-note-status', 'data-status': queued.status, title: queued.error ?? `${queued.attempts} ${queued.attempts === 1 ? 'attempt' : 'attempts'}${queued.suggestions != null ? ` · ${queued.suggestions} suggestions` : ''}` }));
        if (queued.manyTags)
            row.append(node('span', 'Many tags', { class: 'badge failed', title: 'Many tags were added; some may be spurious. Open this file to review them.' }));
    }
    if (assist.collection)
        row.append(button('Open', () => assist.perform(() => assist.openCollectionNote(key)), { disabled: assist.busy, title: 'Load this file from disk', id: 'assist-collection-open-note' }));
    else if (!current)
        row.append(button('Open', () => assist.openOpenFile(ann), { disabled: assist.busy, title: 'Show this file in the editor', id: 'assist-batch-open-note' }));
    return row;
}
