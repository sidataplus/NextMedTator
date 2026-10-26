/** More Tools: Analysis Settings, Recovery & Backup, Large Collections and Try a Sample. */
import { node, button, labeled, disclosure, icon } from './assist-dom.mjs';
import { documentKey, legacySchema } from './assist-legacy.mjs';
import { importCollectionBackup } from './collection-backup.mjs';
import { PRACTICE_TASKS } from './practice-tasks.mjs';
import { thresholdControl } from './threshold.mjs';
import { renderScopeEditor } from './scope-ui.mjs';
import { saveModelSelectionState, setSelectionThresholdOverride } from './model-selection.mjs';
import { activeVariantForSchema } from './model-package.mjs';
import { localDownload } from './bundle.mjs';

/** Sample buttons; step 1 shows them until a file is open, then Try a Sample holds them. */
export function practiceActions(assist, view) {
    const actions = node('div', null, { class: 'row' });
    for (const task of PRACTICE_TASKS)
        actions.append(button(task.title, () => assist.perform(() => assist.loadPracticeTask(task)), { id: 'assist-practice-' + task.id, disabled: assist.busy || !view?.vpp }));
    return actions;
}

export function renderMoreTools(assist, view) {
    const more = disclosure(assist, 'more', 'More Tools');
    more.querySelector('summary').prepend(icon('options'));
    more.append(analysisSettings(assist, view), recoveryAndBackup(assist, view), largeCollections(assist, view));
    if (view?.ann) more.append(trySample(assist, view));
    more.append(button('Open Evidence Project', () => assist.perform(async () => assist.openProject(await assist.syncProject(view.ann))), {
        id: 'open-workspace',
        disabled: !view?.ann || assist.busy,
        title: 'Open the portable evidence project for snapshots and comparison',
    }));
    return more;
}

function analysisSettings(assist, view) {
    const options = disclosure(assist, 'options', 'Analysis Settings', assist.scopeEditing);
    options.append(thresholdControl({
        override: assist.thresholdOverride,
        scope: assist.scope,
        variant: activeVariantForSchema(assist.model, view?.data?.dtd ? legacySchema(view.data.dtd) : null),
        disabled: assist.busy,
        id: 'assist-threshold',
        onChange: (value, render) => {
            assist.thresholdOverride = setSelectionThresholdOverride(assist.modelSelectionState, value);
            saveModelSelectionState(assist.modelSelectionState);
            if (render) {
                if (assist.recoverySession.enabled) assist.recoverySession.touch();
                assist.render();
            }
        },
    }));
    const longNotes = node('input', null, { type: 'checkbox', 'aria-label': 'Split long files into overlapping windows', 'data-testid': 'assist-long-context', disabled: assist.busy });
    longNotes.checked = assist.longContext !== false;
    longNotes.addEventListener('change', () => { assist.longContext = longNotes.checked; });
    options.append(labeled('Split Long Files into Windows', longNotes),
        node('p', 'Long files are analyzed in overlapping windows and merged back. Attributes use each window\'s context. Turn this off to reject files that are too long.', { class: 'muted' }));
    options.append(renderScopeEditor(assist));
    return options;
}

function recoveryAndBackup(assist, view) {
    const storage = disclosure(assist, 'recovery', 'Recovery & Backup');
    const session = assist.recoverySession;
    const recovery = node('div', null, { class: 'row' });
    recovery.append(node('p', session.status, { class: 'muted', role: 'status', 'data-testid': 'assist-recovery-status' }));
    if (!session.enabled) {
        recovery.append(button('Enable Recovery', () => assist.perform(async () => {
            if (!await assist.ask('Keep these files, annotations and prediction history in this browser? Export files for a portable backup.', { confirm: 'Enable Recovery' })) return;
            await session.enable();
        }), { disabled: !view?.ann || !!assist.collection, id: 'assist-recovery-enable' }));
    }
    else {
        recovery.append(
            button('Save Checkpoint', () => assist.perform(() => session.save()), { id: 'assist-checkpoint' }),
            button('Disable Recovery', () => assist.perform(() => session.disable())),
            button('Delete Recovery Copy', () => assist.perform(async () => {
                if (await assist.ask('Delete this recovery copy? Annotations that are open now are kept.', { confirm: 'Delete Copy' })) await session.forget();
            })),
            button('Export Backup (.sqlite3)', () => assist.perform(async () => localDownload(await session.exportDatabase(), 'corpus.nmt.sqlite3', 'application/vnd.sqlite3'))));
    }
    recovery.append(button('List Recovery Copies', () => assist.perform(async () => {
        assist.savedCorpora = (await session.list()).filter(saved => saved.corpus);
    })));
    for (const saved of assist.savedCorpora ?? [])
        recovery.append(button('Restore ' + saved.id, () => assist.perform(async () => {
            if (!await assist.ask('Replace the open files with this recovery copy? Save your current work first.', { confirm: 'Restore Copy' })) return;
            await session.recover(saved.id, saved.backend);
        })));
    storage.append(recovery);
    return storage;
}

function largeCollections(assist, view) {
    const collections = disclosure(assist, 'collections', 'Large Collections');
    collections.append(node('p', 'Collections keep up to 10,000 .txt files in this browser and open them one at a time. Add text files under 4. Analyze and Review › Batch Analysis. Browser storage is not a backup; export one to keep a copy.', { class: 'muted' }),
        button('List Collections', () => assist.perform(async () => { assist.savedCollections = await assist.collectionStore.list(); }), { disabled: assist.busy, id: 'assist-collection-list' }));
    for (const saved of assist.savedCollections ?? [])
        collections.append(button(`Open ${saved.name} (${saved.count} files)`, () => assist.perform(() => assist.openCollection(saved.id)), { disabled: assist.busy, id: 'assist-collection-restore' }));
    if (assist.collection) {
        collections.append(
            node('p', `${assist.collection.notes.length} files stored · ${assist.projects.size} loaded`, { 'data-testid': 'assist-collection-memory' }),
            button('Save Current File', () => assist.perform(() => assist.saveCollectionCurrent()), { disabled: assist.busy, id: 'assist-collection-save' }),
            button('Close Collection', () => assist.perform(() => assist.closeCollection()), { disabled: assist.busy, id: 'assist-collection-close' }));
    }
    const backup = node('input', null, { type: 'file', accept: '.jsonl', 'aria-label': 'Restore collection backup', 'data-testid': 'assist-collection-backup-import', disabled: assist.busy });
    backup.addEventListener('change', () => {
        const file = backup.files[0];
        if (file) assist.perform(async () => {
            const meta = await importCollectionBackup(assist.collectionStore, file, { keyFor: documentKey });
            await assist.openCollection(meta.id);
        });
    });
    collections.append(labeled('Restore Backup (.jsonl)', backup));
    if (assist.collection) {
        const filePicker = typeof window.showSaveFilePicker === 'function';
        collections.append(button('Export Backup', () => assist.exportCollectionBackup(), { disabled: assist.busy, id: 'assist-collection-export' }));
        if (filePicker)
            collections.append(button('Download Instead', () => assist.exportCollectionBackup({ browserDownload: true }), { disabled: assist.busy, id: 'assist-collection-browser-export' }));
        collections.append(node('p', filePicker ? 'Export Backup writes directly to disk. Download Instead works for backups up to 64 MiB.' : 'This browser downloads backups up to 64 MiB.', { class: 'muted' }));
    }
    return collections;
}

function trySample(assist, view) {
    const practice = disclosure(assist, 'practice', 'Try a Sample');
    practice.append(node('p', 'Loads fictional clinical text with its schema and model choice. Nothing is downloaded.', { class: 'muted' }));
    practice.append(practiceActions(assist, view), node('a', 'Step-by-step tutorials', { href: 'https://github.com/sidataplus/NextMedTator/tree/main/tutorial', target: '_blank', rel: 'noopener noreferrer' }));
    return practice;
}
