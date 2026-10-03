import { DEMO_SCHEMA } from './contracts.mjs';
import { importModelPackage, ConformanceWorker, qualifyForSchema, CODECS, MODEL_LIMITS } from './model-package.mjs';
import { schemaEntityLabels, schemaPrompt, spansToRecords, SPAN_NOTICE, STRUCTURED_NOTICE, GLINER_CODEC, GLINER_STRUCTURED } from './gliner.mjs';

const styles = `
:host{display:block;height:100%;color:#1a3041;font:13px/1.45 system-ui,sans-serif}
*{box-sizing:border-box}
button,input,select{font:inherit;color:inherit}
button,select{border:1px solid #d7e1e7;border-radius:6px;background:#fff;padding:5px 8px;cursor:pointer}
button:hover{background:#eef5f7}
button:disabled{opacity:.5;cursor:not-allowed}
button.primary{background:#076b74;color:#fff;border-color:#076b74}
:focus-visible{outline:3px solid #137aab;outline-offset:2px}
button:focus:not(:focus-visible){outline:none}
.dock{height:100%;display:flex;flex-direction:column;background:#f7f9fa}
.rail{height:100%;width:100%;border:0;border-radius:0;background:#f7f9fa;writing-mode:vertical-rl;text-orientation:mixed;letter-spacing:.04em}
.head{padding:8px;border-bottom:1px solid #d7e1e7;display:flex;flex-direction:column;gap:6px}
.row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.grow{flex:1}
.badge{border-radius:999px;padding:2px 8px;background:#e8f5ef;font-size:11px}
.muted{color:#536976;font-size:12px}
.body{overflow:auto;padding:8px;flex:1}
.card{background:#fff;border:1px solid #d7e1e7;border-radius:8px;padding:8px;margin:0 0 8px}
.card p{margin:3px 0;overflow-wrap:anywhere}
.anchor{font-weight:650}
.tag{font-size:10px;letter-spacing:.04em;text-transform:uppercase}
.message{margin:0 8px 8px;padding:8px;border-radius:6px;background:#edf4f6;overflow-wrap:anywhere}
.message.error{background:#fff0ec;border:1px solid #db927f}
.docs{max-height:112px;overflow:auto;border:1px solid #d7e1e7;border-radius:6px;background:#fff;padding:4px 6px}
.check{display:flex;gap:6px;align-items:center;flex-direction:row}
label{display:flex;flex-direction:column;gap:3px;font-size:12px}
input[type=file]{max-width:100%;font-size:11px}
.unmatched{color:#8a3b16}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export function utf16Offset(text, codePointOffset) {
    if (!Number.isInteger(codePointOffset) || codePointOffset < 0)
        throw new Error('Offset required');
    let units = 0, seen = 0;
    for (const ch of text) {
        if (seen === codePointOffset)
            return units;
        units += ch.length;
        seen += 1;
    }
    if (seen === codePointOffset)
        return units;
    throw new Error('Offset is outside the document');
}
export function medtatorSpans(text, anchor) {
    return anchor.map(span => {
        const start = utf16Offset(text, span.start);
        const end = utf16Offset(text, span.end);
        if (text.slice(start, end) !== span.text)
            throw new Error('Span text does not match the document');
        return `${start}~${end}`;
    }).join(',');
}
export function documentKey(filename, text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++)
        hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return `${filename}\0${text.length}\0${hash >>> 0}`;
}
export function spanTags(tags) {
    return (tags ?? []).filter(tag => !tag.is_non_consuming);
}
export function preferredTag(family, tags) {
    const span = spanTags(tags);
    const want = String(family ?? '').toLowerCase();
    const named = span.find(tag => tag.name.toLowerCase() === want || tag.name.toLowerCase().replaceAll('_', '') === want.replaceAll('_', ''));
    if (named)
        return named.name;
    return span.length === 1 ? span[0].name : '';
}
export function attributeDraft(attrs, fields) {
    const values = {}, used = new Set();
    for (const attr of attrs ?? []) {
        if (['id', 'spans', 'text', 'tag'].includes(attr.name) || attr.vtype === 'idref' || attr.vtype === 'dfix')
            continue;
        values[attr.name] = attr.default_value ?? '';
        const match = Object.keys(fields ?? {}).find(name => name.toLowerCase() === attr.name.toLowerCase());
        if (!match || fields[match] == null)
            continue;
        const value = String(fields[match]);
        if (attr.vtype === 'list' && Array.isArray(attr.values) && !attr.values.includes(value))
            continue;
        values[attr.name] = value;
        used.add(match);
    }
    const unmatched = Object.keys(fields ?? {}).filter(name => name !== 'concept' && fields[name] != null && !used.has(name));
    return { values, unmatched };
}

function node(tag, text, attrs = {}) {
    const n = document.createElement(tag);
    if (text != null)
        n.textContent = String(text);
    for (const [key, value] of Object.entries(attrs))
        if (value != null && value !== false)
            n.setAttribute(key, String(value));
    return n;
}
function button(text, fn, { disabled = false, primary = false, id, title } = {}) {
    const n = node('button', text, { type: 'button', disabled, class: primary ? 'primary' : '', title, ...(id ? { 'data-testid': id } : {}) });
    n.addEventListener('click', fn);
    return n;
}
function legacy() {
    const app = window.app_hotpot;
    const vpp = app?.vpp;
    if (!vpp?.$data)
        return null;
    const data = vpp.$data;
    const ann = data.ann_idx == null ? null : data.anns[data.ann_idx] ?? null;
    return { app, vpp, data, ann };
}
function editableAttrs(tagDef) {
    return (tagDef?.attrs ?? []).filter(attr => !['id', 'spans', 'text', 'tag'].includes(attr.name) && attr.vtype !== 'idref' && attr.vtype !== 'dfix');
}

export function mountLegacyAssist(host, { openProject } = {}) {
    const assist = new LegacyAssist(host, { openProject });
    host.assist = assist;
    return assist;
}
class LegacyAssist {
    constructor(host, { openProject } = {}) {
        this.host = host;
        this.root = host.attachShadow({ mode: 'open' });
        this.openProject = openProject ?? (() => {});
        this.open = sessionStorage.getItem('nmt-assist-open') !== 'false';
        this.mode = 'assisted';
        this.model = null;
        this.modelRunner = new ConformanceWorker();
        this.runs = new Map();
        this.exposed = new Set();
        this.selected = new Set();
        this.message = '';
        this.error = false;
        this.busy = false;
        this.progress = null;
        this.apply = null;
        this.signature = '';
        host.setAttribute('role', 'complementary');
        host.setAttribute('aria-label', 'Local assistance');
        this.render();
        this.timer = setInterval(() => this.sync(), 500);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) this.sync(); });
    }
    current() {
        const view = legacy();
        if (!view?.ann?.text && view?.ann?.text !== '')
            return { ...view, key: '', run: null };
        if (!view?.ann)
            return { ...view, key: '', run: null };
        const key = documentKey(view.ann._filename ?? 'document', view.ann.text ?? '');
        return { ...view, key, run: this.runs.get(key) ?? null };
    }
    sync() {
        const host = document.querySelector('nextmedtator-assist');
        if (host && host !== this.host) {
            this.host = host;
            this.root = host.attachShadow({ mode: 'open' });
            host.assist = this;
            host.setAttribute('role', 'complementary');
            host.setAttribute('aria-label', 'Local assistance');
            this.signature = '';
        }
        const next = this.viewSignature();
        if (next !== this.signature)
            this.render();
    }
    viewSignature() {
        const view = this.current();
        const ann = view?.ann;
        const dtd = view?.data?.dtd;
        return JSON.stringify({
            open: this.open,
            mode: this.mode,
            model: this.model?.manifest?.id ?? '',
            codec: this.model?.manifest?.variants?.map(v => v.codec).join(',') ?? '',
            message: this.message,
            error: this.error,
            busy: this.busy,
            progress: this.progress,
            key: view?.key ?? '',
            filename: ann?._filename ?? '',
            tags: ann?.tags?.length ?? 0,
            schema: dtd?.name ?? '',
            files: (view?.data?.anns ?? []).map(item => item?._filename ?? ''),
            selected: [...this.selected],
            exposed: [...this.exposed],
            run: view?.run ? { status: view.run.status, decisions: view.run.decisions, count: view.run.records.length } : null,
            apply: this.apply?.id ?? ''
        });
    }
    async perform(action) {
        if (this.busy)
            return;
        this.busy = true;
        this.error = false;
        this.render();
        try {
            await action();
        }
        catch (error) {
            this.error = true;
            this.message = error?.message ?? 'The annotation was left unchanged.';
        }
        finally {
            this.busy = false;
            this.progress = null;
            this.render();
        }
    }
    setOpen(open) {
        this.open = open;
        sessionStorage.setItem('nmt-assist-open', String(open));
        this.render();
        requestAnimationFrame(() => window.app_hotpot?.codemirror?.refresh?.());
    }
    structured() {
        return !!this.model?.manifest.variants.some(variant => variant.codec === GLINER_STRUCTURED);
    }
    async importPackage(file) {
        if (file.size > MODEL_LIMITS.archive)
            throw new Error('Model archive exceeds 1 GiB');
        const candidate = await importModelPackage(new Uint8Array(await file.arrayBuffer()));
        this.model = candidate;
        const structured = candidate.manifest.variants.some(variant => variant.codec === GLINER_STRUCTURED);
        const qualified = candidate.manifest.variants.some(variant => CODECS[variant.codec].clinicalInference);
        this.message = structured
            ? 'GLiNER2.5 structured package loaded in memory. Analyze fills spans and enum attributes on this device.'
            : qualified
                ? 'GLiNER2.5 span package loaded in memory. Analyze fills spans and scores on this device.'
                : 'Package hashes validated. This package can run tensor fixtures only.';
    }
    async analyzeDocuments(anns) {
        if (!this.model)
            throw new Error('Import a GLiNER2.5 boundary model package in this panel');
        if (!anns.length)
            throw new Error('Open a document first');
        const qualification = qualifyForSchema(this.model, DEMO_SCHEMA);
        if (qualification.level !== 'entity-span' && qualification.level !== 'structured-span')
            throw new Error('This package’s codec is not a local GLiNER2.5 decoder');
        const codec = qualification.level === 'structured-span' ? GLINER_STRUCTURED : GLINER_CODEC;
        const notice = codec === GLINER_STRUCTURED ? STRUCTURED_NOTICE : SPAN_NOTICE;
        const variants = this.model.manifest.variants.filter(variant => variant.codec === codec);
        const variant = variants.find(item => item.backend === 'wasm') ?? variants.find(item => item.backend === 'webgpu' && navigator.gpu);
        if (!variant)
            throw new Error('No browser GLiNER2.5 variant is available in the imported package');
        const prompt = codec === GLINER_STRUCTURED
            ? schemaPrompt(DEMO_SCHEMA)
            : { ...schemaEntityLabels(DEMO_SCHEMA), contentCount: undefined, groups: undefined };
        for (const [index, ann] of anns.entries()) {
            this.progress = { index: index + 1, total: anns.length, filename: ann._filename ?? 'document' };
            this.message = `Analyzing ${index + 1} of ${anns.length} on this device.`;
            this.render();
            const doc = { id: ann._filename ?? `document-${index + 1}`, text: ann.text };
            const result = await this.modelRunner.analyze(this.model, variant.id, {
                text: doc.text,
                labels: prompt.labels,
                contentCount: prompt.contentCount,
                groups: prompt.groups,
                threshold: variant.threshold
            });
            if (result.kind !== codec)
                throw new Error('Worker did not return GLiNER span output');
            const records = spansToRecords(doc, DEMO_SCHEMA, result.spans);
            const key = documentKey(ann._filename ?? 'document', ann.text ?? '');
            this.runs.set(key, { key, filename: ann._filename, records, notice, status: result.status, backend: result.backend, precision: result.precision, decisions: {} });
        }
        const hidden = this.mode === 'blind';
        this.message = hidden
            ? 'Local analysis finished. Suggestions stay hidden in blind mode until you reveal them.'
            : `${notice}`;
    }
    chosenDocuments(onlySelected) {
        const view = legacy();
        const anns = view?.data?.anns ?? [];
        if (!onlySelected)
            return view?.ann ? [view.ann] : [];
        return anns.filter(ann => ann && this.selected.has(documentKey(ann._filename ?? 'document', ann.text ?? '')));
    }
    writeAnnotation(record, tagName, values) {
        const view = legacy();
        const ann = view?.ann;
        const tagDef = view?.data?.dtd?.tag_dict?.[tagName];
        if (!ann)
            throw new Error('Open a document first');
        if (!tagDef || tagDef.is_non_consuming)
            throw new Error('Choose a span entity tag from the loaded schema');
        const spans = medtatorSpans(ann.text, record.anchor);
        const text = record.anchor.map(span => span.text).join(' ... ');
        const tag = view.app.make_etag({ spans, text }, tagDef, ann);
        for (const [name, value] of Object.entries(values))
            tag[name] = value;
        ann.tags.push(tag);
        view.vpp.set_ann_unsaved(ann);
        view.app.update_hint_dict_by_tag(ann, tag);
        view.app.cm_update_marks?.();
        view.app.scroll_annlist_to_bottom?.();
        view.data.display_tag_name = '__all__';
        view.vpp.$forceUpdate();
        return tag.id;
    }
    locate(record) {
        const view = legacy();
        const ann = view?.ann;
        const editor = view?.app?.codemirror;
        if (!ann || !editor)
            throw new Error('Open the document in the source view first');
        const spans = medtatorSpans(ann.text, record.anchor);
        const range = view.app.cm_spans2range(spans.split(',')[0], ann);
        editor.focus();
        editor.setSelection(range.anchor, range.head);
        editor.scrollIntoView({ from: range.anchor, to: range.head }, 80);
    }
    render() {
        this.signature = this.viewSignature();
        this.host.dataset.open = String(this.open);
        this.root.replaceChildren(node('style', styles));
        if (!this.open) {
            this.root.append(button('Show assistance', () => this.setOpen(true), { id: 'assist-expand', title: 'Show the local assistance panel' }));
            this.root.lastChild.className = 'rail';
            return;
        }
        const dock = node('div', null, { class: 'dock' });
        this.root.append(dock);
        const head = node('div', null, { class: 'head' });
        const title = node('div', null, { class: 'row' });
        title.append(node('strong', 'Assistance'), node('span', null, { class: 'grow' }), button('Hide', () => this.setOpen(false), { id: 'assist-collapse', title: 'Collapse the assistance panel' }));
        const mode = node('select', null, { 'aria-label': 'Workspace mode', 'data-testid': 'assist-mode' });
        for (const [value, label] of [['assisted', 'Assisted'], ['blind', 'Blind']])
            mode.append(node('option', label, { value }));
        mode.value = this.mode;
        mode.addEventListener('change', () => { this.mode = mode.value; this.apply = null; this.render(); });
        const view = this.current();
        const schema = view?.data?.dtd?.name;
        const status = node('div', null, { class: 'row' });
        status.append(node('span', this.structured() ? 'Structured package' : this.model ? 'Span package' : 'No local model', { class: 'badge', 'data-testid': 'model-status' }), node('span', 'Runs on this device', { class: 'badge' }));
        head.append(title, labeled('Mode', mode), status, node('p', `${schema ? `Schema: ${schema}` : 'Schema: none loaded'}. Documents stay in the annotation workspace.`, { class: 'muted' }));
        dock.append(head);
        if (this.message)
            dock.append(node('div', this.message, { class: `message${this.error ? ' error' : ''}`, role: this.error ? 'alert' : 'status', 'data-testid': 'assist-message' }));
        const body = node('div', null, { class: 'body' });
        dock.append(body);
        const actions = node('div', null, { class: 'row' });
        actions.append(button('Analyze note', () => this.perform(() => this.analyzeDocuments(this.chosenDocuments(false))), { primary: true, disabled: this.busy || !view?.ann, id: 'assist-analyze', title: 'Analyze the open note on this device' }));
        actions.append(button('Analyze selected', () => this.perform(() => this.analyzeDocuments(this.chosenDocuments(true))), { disabled: this.busy || this.selected.size === 0, id: 'assist-analyze-selected', title: 'Analyze the notes checked in this panel' }));
        actions.append(button('Pause', () => this.modelRunner.cancel(), { disabled: !this.busy, id: 'assist-pause', title: 'Stop the local analysis' }));
        body.append(actions);
        body.append(node('p', this.structured()
            ? 'Enum attributes come from the local span-attribute head. Value, unit, and relations stay empty.'
            : 'Import a local package to fill spans. Contextual fields stay empty until the package includes the span-attribute head.', { class: 'muted' }));
        const file = node('input', null, { type: 'file', accept: '.zip', 'aria-label': 'Import model package into the annotation assistance panel' });
        file.addEventListener('change', () => { const picked = file.files?.[0]; if (picked) this.perform(() => this.importPackage(picked)); });
        body.append(labeled('Local model package', file));
        const anns = view?.data?.anns ?? [];
        if (anns.length) {
            const docs = node('div', null, { class: 'docs', 'aria-label': 'Documents to analyze' });
            docs.append(node('p', 'Check notes for Analyze selected. The file list on the left still opens a note.', { class: 'muted' }));
            for (const ann of anns) {
                if (!ann?.text && ann?.text !== '')
                    continue;
                const key = documentKey(ann._filename ?? 'document', ann.text ?? '');
                const input = node('input', null, { type: 'checkbox' });
                input.checked = this.selected.has(key);
                input.addEventListener('change', () => { if (input.checked) this.selected.add(key); else this.selected.delete(key); this.render(); });
                const row = node('label', null, { class: 'check' });
                row.append(input, node('span', ann._filename ?? 'document'));
                docs.append(row);
            }
            body.append(docs);
        }
        else
            body.append(node('p', 'Load a schema and a note with the usual Annotation controls. Assistance stays optional.', { class: 'muted' }));
        this.renderRun(body, view);
        body.append(button('Open evidence project', () => this.openProject(), { id: 'open-workspace', title: 'Open the portable evidence project for snapshots and comparison' }));
    }
    renderRun(body, view) {
        const run = view?.run;
        if (!run)
            return;
        if (this.mode === 'blind') {
            body.append(node('h2', 'Blind annotation'), node('p', 'Suggestions, scores, and counts stay hidden. Reveal is explicit and applies to this note.', { class: 'muted' }));
            if (!this.exposed.has(view.key))
                body.append(button('Reveal suggestions', () => { this.exposed.add(view.key); this.mode = 'assisted'; this.message = 'Suggestions revealed for this note. Earlier blind labels stay in the annotation file.'; this.render(); }, { id: 'assist-reveal' }));
            else
                body.append(node('p', 'This note was revealed earlier. Choose Assisted to show the suggestions again.', { class: 'muted' }));
            return;
        }
        const unresolved = run.records.filter(record => !run.decisions[record.id]).length;
        body.append(node('h2', 'Suggestions'), node('p', `${unresolved} suggestions unresolved · ${run.status} · ${run.backend} / ${run.precision}`, { class: 'muted', 'data-testid': 'assist-summary' }), node('p', 'Suggestions use the clinical-evidence demonstration schema. Choose the annotation entity tag separately.', { class: 'muted' }), node('p', run.notice, { class: 'muted' }));
        if (!run.records.length)
            body.append(node('p', run.status === 'complete' ? 'No suggestions in the completed run. Omission review is still required.' : 'Incomplete run. An empty result is not a negative label.', { class: 'muted' }));
        for (const record of run.records)
            body.append(this.card(view, run, record));
    }
    card(view, run, record) {
        const card = node('article', null, { class: 'card', 'data-testid': 'assist-suggestion' });
        const decision = run.decisions[record.id];
        card.append(node('div', 'Machine suggestion', { class: 'tag' }), node('p', record.anchor.map(span => span.text).join(' … '), { class: 'anchor' }), node('p', `${record.family.replaceAll('_', ' ')} · score ${Number(record.score).toFixed(3)}`, { class: 'muted' }));
        for (const [name, value] of Object.entries(record.fields))
            card.append(node('p', `${name}: ${value == null ? 'Unknown' : value}`, { class: 'muted' }));
        if (decision)
            card.append(node('p', decision.status === 'rejected' ? 'Rejected. The annotation file was not changed.' : `Added to the annotation as ${decision.tagId}. The suggestion stays here.`, { 'data-testid': 'assist-decision' }));
        const actions = node('div', null, { class: 'row' });
        actions.append(button('Locate', () => { try { this.locate(record); this.error = false; } catch (error) { this.error = true; this.message = error.message; this.render(); } }, { id: 'assist-locate' }));
        if (!decision) {
            actions.append(button('Add to annotation', () => { this.apply = { id: record.id, tag: preferredTag(record.family, view?.data?.dtd?.etags) }; this.render(); }, { id: 'assist-accept' }), button('Reject', () => { run.decisions[record.id] = { status: 'rejected' }; if (this.apply?.id === record.id) this.apply = null; this.message = 'Suggestion rejected. Original annotation tags stay as they were.'; this.render(); }, { id: 'assist-reject' }));
        }
        card.append(actions);
        if (this.apply?.id === record.id)
            card.append(this.applyForm(view, run, record));
        return card;
    }
    applyForm(view, run, record) {
        const tags = spanTags(view?.data?.dtd?.etags);
        const form = node('div');
        if (!tags.length) {
            form.append(node('p', 'Load a schema with a span entity tag before adding this suggestion to the annotation.', { class: 'unmatched' }));
            return form;
        }
        const picker = node('select', null, { 'aria-label': 'Entity tag', 'data-testid': 'assist-target-tag' });
        picker.append(node('option', 'Choose an entity tag', { value: '' }));
        for (const tag of tags)
            picker.append(node('option', tag.name, { value: tag.name }));
        picker.value = tags.some(tag => tag.name === this.apply.tag) ? this.apply.tag : '';
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
            form.append(labeled(attr.name, input));
        }
        form.append(node('p', 'Link attributes stay empty. Confirming writes a new annotation tag and leaves this suggestion unchanged.', { class: 'muted' }));
        form.append(button('Write annotation', () => {
            const values = {};
            for (const [name, input] of inputs)
                values[name] = input.value;
            this.perform(() => {
                const tagId = this.writeAnnotation(record, picker.value, values);
                run.decisions[record.id] = { status: 'accepted', tagId };
                this.apply = null;
                this.message = `Added ${tagId} to the open annotation. The machine suggestion remains in this panel.`;
            });
        }, { primary: true, id: 'assist-add' }));
        picker.addEventListener('change', () => { this.apply = { id: record.id, tag: picker.value }; this.render(); });
        return form;
    }
}
function labeled(text, input) {
    const label = node('label');
    label.append(node('span', text), input);
    return label;
}
