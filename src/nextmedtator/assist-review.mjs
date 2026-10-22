/** Step 4 suggestion review: blind gating, run summary, filters, cards and the Add Tag form. */
import { node, button, labeled, labelButton } from './assist-dom.mjs';
import { spanTags, preferredTag, editableAttrs, attributeDraft } from './assist-legacy.mjs';
import { suggestionPage } from './review-queue.mjs';
import { exportBundle, localDownload } from './bundle.mjs';
import { clone } from './integrity.mjs';
import { autoApplyAdvice, adviceSummary } from './auto-apply-advice.mjs';

export function renderRun(assist, body, view) {
    const run = view?.run;
    if (assist.mode === 'blind' && !assist.blindSnapshots.has(view.key) && !assist.exposed.has(view.key))
        body.append(button('Freeze Annotation', () => assist.perform(() => assist.freezeNote(view)), { id: 'assist-freeze', disabled: assist.busy }));
    const project = assist.projects.get(view.key);
    if (project)
        body.append(button('Export Evidence Project', () => assist.perform(async () => localDownload(await exportBundle(await assist.syncProject(view.ann)), `${project.current.id}.nmt.zip`))));
    if (!run) return;
    if (assist.mode === 'blind' || (assist.blinded.has(view.key) && !assist.exposed.has(view.key))) {
        body.append(node('h2', 'Blind Annotation'), node('p', 'Suggestions, scores and counts stay hidden. Revealing applies to this file only.', { class: 'muted' }));
        if (!assist.exposed.has(view.key)) {
            const frozen = assist.blindSnapshots.has(view.key);
            body.append(button('Reveal Suggestions', assist.forCurrentNote(view.key, () => {
                assist.recordExposure(view, run, 'explicit-reveal');
                run.revealedAt = new Date().toISOString();
                assist.mode = 'assisted';
                assist.message = 'Suggestions revealed for this file. Its frozen blind annotation is kept in this session.';
                assist.render();
            }), { id: 'assist-reveal', disabled: !frozen || assist.busy }));
        }
        else
            body.append(node('p', 'Suggestions were already shown for this file. Its current annotation cannot be frozen as independent blind labels. Choose Assisted to show suggestions again.', { class: 'muted', 'data-testid': 'assist-exposure' }));
        return;
    }
    if (view.data.section === 'annotation' && !document.hidden && assist.host.getClientRects().length)
        assist.recordExposure(view, run, 'assisted-display');
    const unresolved = run.records.filter(record => !run.decisions[record.id]).length;
    const settings = run.project.current.runs.find(r => r.id === run.nativeRunId)?.settings;
    if (settings?.threshold != null)
        body.append(node('p', `Run threshold: ${settings.threshold}`, { class: 'muted', 'data-testid': 'assist-run-threshold' }));
    const runScope = settings?.scope;
    if (runScope)
        body.append(node('p', `Run scope: ${runScope.profile.semanticSchema.name} · ${runScope.profile.semanticSchema.version}`, { class: 'muted', 'data-testid': 'assist-run-scope' }));
    body.append(
        node('h2', 'Suggestions'),
        node('p', `${unresolved} suggestions unresolved · ${run.status} · ${run.backend} / ${run.precision}`, { class: 'muted', 'data-testid': 'assist-summary' }),
        node('p', 'Suggestions use the loaded annotation schema. Machine runs and review decisions are retained in the portable evidence project.', { class: 'muted' }),
        node('p', run.notice, { class: 'muted' }));
    const applied = Object.values(run.decisions).filter(d => d.status === 'applied').length;
    if (applied) body.append(node('p', `${applied} machine-applied tags · unreviewed`, { 'data-testid': 'assist-auto-status' }));
    if (applied) {
        const advice = denseRunAdvice(assist, view, run, settings);
        if (advice) body.append(advice);
    }
    body.append(button('Apply All Suggestions', assist.forCurrentNote(view.key, () => assist.perform(() => assist.applyAllSuggestions(view.ann))), {
        id: 'assist-apply-all',
        disabled: assist.busy || !unresolved || run.status !== 'complete',
        title: 'Add all remaining suggestions to this file without review; existing and rejected tags are kept',
    }));
    if (!run.records.length)
        body.append(node('p', run.status === 'complete' ? 'No suggestions in this run. Still check the file for missed tags.' : 'Incomplete run. An empty result is not a negative label.', { class: 'muted' }));
    const display = node('select', null, { 'aria-label': 'Suggestion view', 'data-testid': 'assist-suggestion-view' });
    for (const [value, label] of [['cards', 'Cards'], ['compact', 'Compact List']])
        display.append(node('option', label, { value }));
    display.value = assist.suggestionView;
    display.addEventListener('change', () => { assist.suggestionView = display.value; assist.detail = null; assist.apply = null; assist.render(); });
    body.append(labeled('Suggestion View', display));
    const reviewPage = suggestionPage(run.records, run.decisions, { ...assist.reviewFilter, page: assist.reviewPage ?? 0 });
    body.append(reviewControls(assist, view, run, reviewPage));
    const runReceipt = run.project.current.runs.find(r => r.id === run.nativeRunId);
    if (runReceipt?.windows?.length > 1)
        body.append(node('p', `Long file: ${runReceipt.windows.length} windows · ${run.status}. Attributes use local window context; cross-window mentions are not stitched.`, { 'data-testid': 'assist-window-coverage' }));
    if (assist.suggestionView === 'compact') {
        const table = node('table', null, { class: 'compact', 'aria-label': 'Machine suggestions' });
        const caption = node('caption', `${run.records.length} original machine suggestions`);
        const rows = node('tbody');
        for (const record of reviewPage.records)
            rows.append(compactRow(assist, view, run, record));
        table.append(caption, rows); body.append(table);
        const detail = run.records.find(record => record.id === assist.detail);
        if (detail) body.append(suggestionCard(assist, view, run, detail));
    } else {
        for (const record of reviewPage.records) body.append(suggestionCard(assist, view, run, record));
    }
}
/** Many machine-applied tags, or many just above the threshold: offer a stricter run or per-suggestion review. */
function denseRunAdvice(assist, view, run, settings) {
    if (assist.denseAdviceHidden?.has(run.nativeRunId)) return null;
    const variant = assist.model?.manifest.variants.find(v => v.id === run.runtime?.variantId);
    const applied = run.records.filter(record => run.decisions[record.id]?.status === 'applied');
    const advice = autoApplyAdvice(applied, { chars: view.ann.text?.length ?? 0, threshold: settings?.threshold, fixedThreshold: !!(variant?.clinicalRelease || variant?.fixedThreshold) });
    if (!advice) return null;
    const box = node('div', null, { class: 'setup-hint advice', role: 'note', 'data-testid': 'assist-dense-advice' });
    box.append(node('strong', 'Many tags were added; some may be spurious'),
        node('p', adviceSummary(advice), { 'data-testid': 'assist-dense-summary' }),
        node('p', advice.suggestion
            ? `Check a few. If many are wrong, raise the threshold to ${advice.suggestion.threshold} (keeps about ${advice.suggestion.kept} of ${advice.suggestion.total}) or review each suggestion in Assisted mode.`
            : 'Check a few. If many are wrong, review each suggestion in Assisted mode before it becomes a tag.'));
    const actions = node('div', null, { class: 'row' });
    if (advice.suggestion)
        actions.append(button(`Raise Threshold to ${advice.suggestion.threshold} and Re-analyze`, assist.forCurrentNote(view.key, () => assist.perform(() => assist.reanalyzeWithThreshold(advice.suggestion.threshold))), {
            id: 'assist-dense-raise', disabled: assist.busy || !assist.model,
            title: 'Undo this Auto Apply, then analyze this file again with the stricter threshold',
        }));
    actions.append(button('Review Each Instead', assist.forCurrentNote(view.key, () => assist.perform(() => assist.reviewDenseRunInstead())), {
        id: 'assist-dense-review', disabled: assist.busy,
        title: 'Undo this Auto Apply and switch to Assisted mode to accept or reject each suggestion',
    }), button('Keep Tags', () => { (assist.denseAdviceHidden ??= new Set()).add(run.nativeRunId); assist.render(); }, { id: 'assist-dense-keep', title: 'Hide this notice for this run' }));
    box.append(actions);
    return box;
}
function reviewControls(assist, view, run, reviewPage) {
    const controls = node('div', null, { class: 'section', tabindex: 0, 'data-testid': 'assist-review-controls', 'aria-label': 'Suggestion review controls' });
    const filter = (name, values) => {
        const select = node('select', null, { 'aria-label': 'Filter suggestions by ' + name });
        for (const [value, label] of values)
            select.append(node('option', label, { value }));
        select.value = assist.reviewFilter?.[name] ?? 'all';
        select.addEventListener('change', () => {
            assist.reviewFilter = { ...assist.reviewFilter, [name]: select.value };
            assist.reviewPage = 0;
            assist.reviewFocus = null;
            assist.render();
        });
        return labeled(name[0].toUpperCase() + name.slice(1), select);
    };
    controls.append(
        filter('family', [['all', 'All Families'], ...[...new Set(run.records.map(r => r.family))].map(f => [f, f])]),
        filter('status', [['all', 'All Decisions'], ['unreviewed', 'Unreviewed'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['applied', 'Machine-applied']]));
    controls.append(
        node('p', `${reviewPage.total} matching suggestions · page ${reviewPage.page + 1} / ${reviewPage.pages}`, { 'data-testid': 'assist-review-page' }),
        labelButton(button('Previous', () => { assist.reviewPage = reviewPage.page - 1; assist.render(); }, { disabled: reviewPage.page === 0 }), 'Previous suggestions'),
        labelButton(button('Next', () => { assist.reviewPage = reviewPage.page + 1; assist.render(); }, { disabled: reviewPage.page + 1 === reviewPage.pages }), 'Next suggestions'),
        button('Undo', () => assist.perform(() => assist.undoReview()), { disabled: assist.busy || assist.reviewUndo?.at(-1)?.key !== view.key, id: 'assist-review-undo' }),
        node('p', 'Focus this panel: Alt+J/K next/previous, Alt+A review/add, Alt+Enter write, Alt+R reject, Alt+U undo. Twenty suggestions per page.', { class: 'muted' }));
    return controls;
}
// Locate reports a stale editor in the panel instead of throwing from the click handler.
function locateButton(assist, view, record, id) {
    return button('Locate', assist.forCurrentNote(view.key, () => {
        try { assist.locate(record); assist.error = false; }
        catch (error) { assist.error = true; assist.message = error.message; assist.render(); }
    }), { id });
}
function compactRow(assist, view, run, record) {
    const row = node('tr', null, { 'data-testid': 'assist-compact-suggestion' });
    const cell = node('td');
    const anchor = record.anchor.map(span => span.text).join(' … ');
    const summary = [record.family.replaceAll('_occurrence', '').replaceAll('_', ' '), record.fields.assertion,
        record.fields.time_frame, record.fields.experiencer, Number(record.score).toFixed(3)].filter(value => value != null).join(' · ');
    cell.append(node('strong', anchor, { title: anchor }), node('small', summary, { title: summary }));
    if (record.conceptId) cell.append(node('small', `Concept: ${record.conceptId}`));
    const decision = run.decisions[record.id];
    if (decision) cell.append(node('small', decision.status === 'applied' ? `Auto-applied ${decision.tagId} · unreviewed` : decision.status === 'rejected' ? 'Rejected' : `Added ${decision.tagId}`));
    const actions = node('td');
    actions.append(locateButton(assist, view, record, 'assist-compact-locate'),
        button('Review', assist.forCurrentNote(view.key, () => {
            assist.detail = record.id;
            assist.apply = null;
            assist.render();
            assist.root.querySelector('[data-testid="assist-suggestion"]')?.scrollIntoView({ block: 'nearest' });
        }), { id: 'assist-details' }));
    row.append(cell, actions);
    return row;
}
function suggestionCard(assist, view, run, record) {
    const card = node('article', null, { class: 'card', tabindex: 0, 'data-testid': 'assist-suggestion' });
    card.addEventListener('focusin', () => { assist.reviewFocus = record.id; });
    if (assist.reviewFocus === record.id) card.classList.add('focused');
    const decision = run.decisions[record.id];
    card.append(
        node('div', 'Machine suggestion', { class: 'tag' }),
        node('p', record.anchor.map(span => span.text).join(' … '), { class: 'anchor' }),
        node('p', `${record.family.replaceAll('_', ' ')} · score ${Number(record.score).toFixed(3)}`, { class: 'muted' }));
    if (record.conceptId) card.append(node('p', `Concept: ${record.conceptId}`, { class: 'muted' }));
    for (const [name, value] of Object.entries(record.fields))
        card.append(node('p', `${name}: ${value == null ? 'Unknown' : value}`, { class: 'muted' }));
    if (decision) {
        const outcome = decision.status === 'rejected' ? 'Rejected. The annotation file was not changed.'
            : decision.status === 'applied' ? `Auto-applied as ${decision.tagId} · unreviewed. The suggestion stays here.`
            : `Added as ${decision.tagId}. The suggestion stays here.`;
        card.append(node('p', outcome, { 'data-testid': 'assist-decision' }));
    }
    const actions = node('div', null, { class: 'row' });
    actions.append(locateButton(assist, view, record, 'assist-locate'));
    if (!decision) {
        actions.append(
            button('Accept', assist.forCurrentNote(view.key, () => {
                assist.apply = { id: record.id, tag: preferredTag(record.family, view?.data?.dtd?.etags) };
                assist.render();
            }), { id: 'assist-accept' }),
            button('Reject', assist.forCurrentNote(view.key, () => { assist.perform(() => assist.rejectSuggestion(view, run, record)); }), { id: 'assist-reject' }));
    }
    card.append(actions);
    if (assist.apply?.id === record.id)
        card.append(applyForm(assist, view, run, record));
    return card;
}
function applyForm(assist, view, run, record) {
    const tags = spanTags(view?.data?.dtd?.etags);
    const form = node('div');
    if (!tags.length) {
        form.append(node('p', 'Load a schema with a span entity tag before accepting this suggestion.', { class: 'unmatched' }));
        return form;
    }
    const picker = node('select', null, { 'aria-label': 'Entity tag', 'data-testid': 'assist-target-tag' });
    picker.append(node('option', 'Choose an entity tag', { value: '' }));
    for (const tag of tags)
        picker.append(node('option', tag.name, { value: tag.name }));
    picker.value = tags.some(tag => tag.name === assist.apply.tag) ? assist.apply.tag : '';
    form.append(labeled('Annotation tag', picker));
    const tagDef = view.data.dtd.tag_dict[picker.value];
    const draft = attributeDraft(editableAttrs(tagDef), record.fields);
    if (draft.unmatched.length)
        form.append(node('p', `Model fields without a same-named schema attribute: ${draft.unmatched.map(name => `${name} = ${record.fields[name]}`).join(', ')}.`, { class: 'unmatched' }));
    const inputs = new Map();
    for (const attr of editableAttrs(tagDef)) {
        let input;
        if (attr.vtype === 'list' && Array.isArray(attr.values)) {
            input = node('select', null, { 'aria-label': attr.name });
            for (const value of attr.values)
                input.append(node('option', value, { value }));
            if (draft.values[attr.name] != null && ![...attr.values].includes(draft.values[attr.name]))
                input.append(node('option', draft.values[attr.name], { value: draft.values[attr.name] }));
            input.value = draft.values[attr.name] ?? '';
        }
        else {
            input = node('input', null, { type: 'text', value: draft.values[attr.name] ?? '', 'aria-label': attr.name });
        }
        inputs.set(attr.name, input);
        const field = labeled(attr.name, input);
        input.addEventListener('input', () => {
            const changed = input.value !== (draft.values[attr.name] ?? '');
            field.classList.toggle('changed', changed);
            field.title = changed ? 'Changed from model suggestion' : '';
        });
        form.append(field);
    }
    form.append(node('p', 'Link attributes stay empty. Add Tag creates a new tag; the suggestion stays here.', { class: 'muted' }));
    form.append(button('Add Tag', assist.forCurrentNote(view.key, () => {
        const values = {};
        for (const [name, input] of inputs)
            values[name] = input.value;
        assist.perform(() => {
            const before = { [record.id]: run.decisions[record.id] ?? null };
            const tagId = assist.writeAnnotation(record, picker.value, values);
            run.decisions[record.id] = { status: 'accepted', tagId };
            const copy = { ...clone(record), documentId: run.project.current.documents[0].id };
            for (const [name, value] of Object.entries(values))
                if (run.project.current.schema.families[copy.family].fields[name])
                    copy.fields[name] = value;
            run.project.review(run.nativeRunId, record.id, 'modified', copy);
            assist.rememberReviewUndo(run, before, [view.ann.tags.find(t => t.id === tagId)]);
            assist.apply = null;
            assist.message = `Added ${tagId} to the current file. The suggestion stays in this panel.`;
        });
    }), { primary: true, id: 'assist-add' }));
    picker.addEventListener('change', () => { assist.apply = { id: record.id, tag: picker.value }; assist.render(); });
    return form;
}
