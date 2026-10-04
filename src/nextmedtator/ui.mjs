import {previewSchemaMigration,applySchemaMigration} from './migration.mjs';
import {ModelStore,downloadCatalogPackage} from './model-store.mjs';
import {SMALL_CODEC,SMALL_NOTICE,validateSmallSchema} from './gliner-small.mjs';
import { ReviewProject, machineSnapshot, makeRun } from './project.mjs';
import { DEMO_SCHEMA, validateSchema } from './contracts.mjs';
import { demoProject, authoredSuggestionRun, DEMO_NOTICE } from './samples.mjs';
import { OffsetMap, TextareaOffsetMap, sourceDocument, uuid, clone, invariant, jsonParse, canonical } from './integrity.mjs';
import { exportBundle, importBundle, localDownload } from './bundle.mjs';
import { RecoveryStore, ActiveTimer } from './recovery.mjs';
import { compareSnapshots, comparisonCSV } from './compare.mjs';
import { importJSONL, importMedTator, exportMedTator, evidenceJSONL, eventCSV } from './interchange.mjs';
import { importModelPackage, ConformanceWorker, qualifyForSchema, modelRunProvenance, CODECS, MODEL_LIMITS } from './model-package.mjs';
import { schemaEntityLabels, schemaPrompt, spansToRecords, SPAN_NOTICE, STRUCTURED_NOTICE, GLINER_CODEC, GLINER_STRUCTURED } from './gliner.mjs';
import { mountLegacyAssist } from './assist.mjs';
import {CorpusSearch} from './corpus-search.mjs';
const styles = `
:host { --ink:#1a3041;--muted:#536976;--paper:#fff;--line:#d7e1e7;--accent:#076b74; color:var(--ink);font:15px/1.5 system-ui,sans-serif; }
*{box-sizing:border-box} button,input,select,textarea{font:inherit} button,.file{border:1px solid var(--line);border-radius:7px;background:white;color:var(--ink);padding:7px 11px;cursor:pointer;display:inline-block}button:hover,.file:hover{background:#eef5f7}button:disabled{opacity:.5;cursor:not-allowed}button.primary{background:var(--accent);color:white;border-color:var(--accent)}:focus-visible{outline:3px solid #137aab;outline-offset:2px}button:focus:not(:focus-visible){outline:none}input,select,textarea{border:1px solid var(--line);border-radius:5px;padding:7px;max-width:100%;color:var(--ink)}textarea{width:100%}label{display:flex;flex-direction:column;gap:4px}input[type=file]{max-width:235px;font-size:12px}.app{position:fixed;inset:18px;z-index:10020;display:flex;flex-direction:column;background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 16px 80px #162b4a44;overflow:hidden}.app.full{position:relative;inset:auto;border:0;box-shadow:none;min-height:100vh;border-radius:0}.top{display:flex;align-items:center;gap:14px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding:12px 18px}.brand{font-size:21px;font-weight:750;letter-spacing:-.6px}.badge{border-radius:20px;padding:3px 9px;background:#e8f5ef;font-size:12px}.stage{background:#f2f5f7}.muted{color:var(--muted);font-size:13px}.grow{flex:1}.toolbar{display:flex;gap:7px;padding:10px 18px;border-bottom:1px solid var(--line);flex-wrap:wrap;align-items:center}.main{display:grid;grid-template-columns:205px minmax(260px,1fr) 370px;flex:1;min-height:460px;overflow:auto}.documents{background:#f7f9fa;border-right:1px solid var(--line);padding:14px;overflow:auto}.documents button{display:block;text-align:left;width:100%;margin:6px 0;word-break:break-word}.documents button[aria-current=true]{border-color:var(--accent);background:#e6f2f3}.source{padding:20px;overflow:auto;min-width:0}.source textarea{white-space:pre-wrap;min-height:300px;resize:vertical;background:#fbfcfd;line-height:1.8;font-size:var(--source-size,17px);border:1px solid var(--line);tab-size:4}.panel{padding:16px;border-left:1px solid var(--line);overflow:auto;max-height:75vh}.card{padding:12px;border:1px solid var(--line);border-radius:9px;margin:10px 0;background:white}.card p{margin:5px 0;overflow-wrap:anywhere}.anchor{font-weight:650}.actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:9px}.fields label{font-size:12px}.status{min-height:37px;border-top:1px solid var(--line);padding:8px 18px;font-size:13px;background:#f7f9fa}.message{margin:10px 18px;padding:10px;border-radius:7px;background:#edf4f6;overflow-wrap:anywhere}.message.error{background:#fff0ec;border:1px solid #db927f}.welcome{max-width:850px;margin:40px auto;padding:24px}.welcome h1{font-size:34px;letter-spacing:-1px;line-height:1.2}.welcome p{font-size:16px}.welcome .choices{display:flex;gap:15px;flex-wrap:wrap;margin:25px 0}.details{padding:14px 18px;border-bottom:1px solid var(--line);max-height:55vh;overflow:auto}.details h3{margin:4px 0 12px}.details pre{max-height:220px;overflow:auto;white-space:pre-wrap;background:#f7f9fa;padding:10px}.banner{padding:7px 18px;background:#fff9e9;border-bottom:1px solid #ebdfb7;font-size:12px}.closed{position:fixed;right:18px;bottom:16px;z-index:10010;border-color:var(--accent);box-shadow:0 4px 20px #193a4522}.check{display:flex;flex-direction:row;align-items:center;gap:8px}h2{font-size:19px;margin:0 0 12px}h3{font-size:16px;margin:16px 0 8px}.tag{font-size:11px;text-transform:uppercase;letter-spacing:.4px}.source-note{font-size:12px;color:var(--muted)}.compare{display:grid;grid-template-columns:1fr 1fr;gap:12px}.hidden{display:none!important}@media(max-width:1000px){.main{grid-template-columns:155px 1fr}.panel{grid-column:1/-1;border-top:1px solid var(--line);max-height:none}.app{inset:4px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;
function node(tag, text, attrs = {}) { const n = document.createElement(tag); if (text !== null && text !== undefined)
    n.textContent = String(text); for (const [k, v] of Object.entries(attrs)) {
    if (v !== false && v !== undefined && v !== null)
        n.setAttribute(k, String(v));
} return n; }
function button(text, fn, { disabled = false, primary = false, id } = {}) { const n = node('button', text, { type: 'button', disabled, class: primary ? 'primary' : '', ...(id ? { 'data-testid': id } : {}), 'data-focus-key': text }); n.addEventListener('click', fn); return n; }
function labeled(text, input) { const l = node('label'); l.append(node('span', text), input); return l; }
function choose(values, current) { const s = node('select'); for (const [value, label] of values) {
    const o = node('option', label, { value });
    s.append(o);
} s.value = current; return s; }
export class EvidenceWorkspace {
    constructor(host, { standalone = false, startOpen = false } = {}) {
        this.host = host;
        this.root = host.attachShadow({ mode: 'open' });
        this.standalone = standalone;
        this.open = standalone || startOpen;
        host.workspace = this;
        this.project = null;
        this.index = 0;
        this.mode = 'assisted';
        this.actor = 'annotator';
        this.message = '';
        this.error = false;
        this.dirty = false;
        this.saveState = 'No project open';
        this.recovery = new RecoveryStore();
        this.timer = new ActiveTimer();
        this.documentTimers=new Map();this.manualPause=false;this.waitMs=0;
        this.panel = null;
        this.editor = null;
        this.busy = false;
        this.model = null;
        this.modelStore = new ModelStore();
        this.selectedSuggestions = new Set();
        this.modelReport = null;
        this.modelRunner = new ConformanceWorker();
        this.previousFocus = null;
        window.addEventListener('beforeunload', e => { if (this.dirty) {
            e.preventDefault();
            e.returnValue = '';
        } });
        document.addEventListener('visibilitychange', () => this.timer.visibility(!document.hidden));
        this.root.addEventListener('pointerdown', () => this.timer.touch());
        this.root.addEventListener('keydown', e => { this.timer.touch(); if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && this.project) {
            e.preventDefault();
            this.perform(() => this.save());
        } if(e.key==='Tab'&&!this.standalone&&this.open){const controls=[...this.root.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(n=>n.getClientRects().length);const first=controls[0],last=controls.at(-1);if(e.shiftKey&&this.root.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&this.root.activeElement===last){e.preventDefault();first?.focus();}} if (e.key === 'Escape' && !this.standalone) {
            this.open = false;
            this.render();
            this.previousFocus?.focus();
        } });
        this.render();
    }
    async perform(action) { if (this.busy)
        return; this.busy = true; this.root.querySelector('.app')?.setAttribute('aria-busy', 'true'); for (const b of this.root.querySelectorAll('button'))
        if (b.textContent !== 'Force stop')
            b.disabled = true; try {
        this.timer.pause(true);
        const waiting=performance.now();try{await action();}finally{this.waitMs+=performance.now()-waiting;}
        this.error = false;
    }
    catch (e) {
        this.error = true;
        this.message = e?.message ?? 'Operation failed; current project was preserved.';
    }
    finally {
        this.busy = false;
        this.timer.pause(this.manualPause);
        this.render();
    } }
    async adopt(project, { recoveryHash = null, recoveryBackend = null } = {}) {
        if (this.project && this.dirty && !confirm('Open another project? Export unsaved changes first, or choose OK to discard this working copy.'))
            return false;
        this.recovery.disable();
        this.project = project;
        this.index = 0;
        this.editor = null;
        this.dirty = false;
        this.saveState = 'Project loaded in memory';
        this.timer = new ActiveTimer();this.documentTimers=new Map();this.manualPause=false;this.waitMs=0;
        if (recoveryHash) {
            try{
                await this.recovery.enable(project.current.id, { consent: true, expectedHash: recoveryHash });
                this.saveState = this.recovery.migrated?'Legacy recovery migrated; original copy retained':'Recovered local database checkpoint; export a portable copy';
            }catch(error){
                if(recoveryBackend!=='indexeddb-legacy'||error.code!=='STORAGE_UNAVAILABLE')throw error;
                this.dirty=true;this.saveState='Legacy checkpoint loaded in memory; recovery unavailable. Export to save changes.';
                this.message='The original legacy recovery copy is retained. Local database recovery is unavailable; export a portable backup.';
            }
        }
        return true;
    }
    changed() { this.dirty = true; this.saveState = 'Unsaved changes'; }
    get doc() { return this.project?.current.documents[this.index]; }
    async analyzeCurrent() {
        // Bind every await to the source and package selected when analysis started.
        const project=this.project,doc=this.doc,model=this.model;
        invariant(doc, 'Open a document first');
        invariant(model, 'Import a GLiNER2.5 boundary model package in Models');
        const qualification = qualifyForSchema(model, project.current.schema);
        invariant(qualification.level === 'entity-span' || qualification.level === 'structured-span' || qualification.level === 'occurrence-record', 'This package’s codec is not a local GLiNER2.5 decoder');
        const codec = qualification.level === 'occurrence-record' ? SMALL_CODEC : qualification.level === 'structured-span' ? GLINER_STRUCTURED : GLINER_CODEC;
        const notice = codec === SMALL_CODEC ? SMALL_NOTICE : codec === GLINER_STRUCTURED ? STRUCTURED_NOTICE : SPAN_NOTICE;
        const variants = model.manifest.variants.filter(v => v.codec === codec);
        const variant = variants.find(v => v.backend === 'wasm') ?? variants.find(v => v.backend === 'webgpu' && navigator.gpu);
        invariant(variant, 'No browser GLiNER2.5 variant is available in the imported package');
        const prompt = (codec === GLINER_STRUCTURED || codec===SMALL_CODEC) ? schemaPrompt(project.current.schema) : { ...schemaEntityLabels(project.current.schema), contentCount: undefined, groups: undefined };
        if(codec===SMALL_CODEC)validateSmallSchema(project.current.schema);
        if(this.modelReport?.manifestHash!==model.manifestHash||this.modelReport?.variantId!==variant.id){this.modelReport=await this.modelRunner.run(model,variant.id);invariant(this.modelReport.pass,'Selected model failed its public conformance fixtures');}
        const runSettings={codec,threshold:variant.threshold??.5,overlapPolicy:'flat',maxSequenceLength:512,wordOverlap:32,notice,limitations:codec===SMALL_CODEC?['cross-window-relations','anchorless-records',...(Object.keys(project.current.schema.relations??{}).length?['automatic-relations-unqualified']:[])]:[]};
        let result;const started=performance.now();
        try {
            result = await this.modelRunner.analyze(model, variant.id, { text: doc.text, labels: prompt.labels, contentCount: prompt.contentCount, groups: prompt.groups, schema: project.current.schema, threshold: variant.threshold });
        } catch(error) {
            const identity=modelRunProvenance(model,variant.id,{manifestHash:model.manifestHash,variantId:variant.id,kind:codec,backend:variant.backend,precision:variant.precision});
            const failed=await makeRun(project,doc,[],{...identity,producer:{...identity.producer,notice},status:/Cancelled/.test(error.message)?'cancelled':'failed',coverage:[],settings:runSettings,failures:[{category:/Cancelled/.test(error.message)?'cancelled':'local-runtime-failure'}],timing:{inferenceMs:performance.now()-started}});
            await project.addRun(failed);if(this.project===project)this.changed();throw error;
        }
        invariant(result.kind === codec, 'Worker returned a different decoder output');
        const provenance = modelRunProvenance(model, variant.id, result);
        const records = result.records ? result.records.map(r=>({...r,documentId:doc.id})) : spansToRecords(doc, project.current.schema, result.spans);
        const run = await makeRun(project, doc, records, { producer: { ...provenance.producer, notice }, status: result.status, coverage: result.coverage, windows: result.windows ?? [], timing: { inferenceMs: performance.now()-started }, settings: runSettings, runtime: provenance.runtime });
        await project.addRun(run);
        if(this.project===project){
            this.changed();
            this.message = project.canSeeMachine
                ? `${records.length} local span suggestion${records.length === 1 ? '' : 's'} for ${doc.provenance?.filename??doc.id}. ${notice}`
                : 'Local analysis finished. Suggestions stay hidden until you reveal them.';
        }
    }
    async save() { const data = await exportBundle(this.project.current); localDownload(data, `${this.project.current.id}.nmt.zip`, 'application/zip'); this.saveState = 'Project export created; verify your downloaded file'; this.dirty = false; this.message = 'Export stays on your device. The application cannot verify a durable backup.'; }
    async checkpoint() { try{await this.recovery.checkpoint(this.project.current);}catch(error){this.dirty=true;this.saveState='Unsaved changes; recovery failed. Export this project.';throw error;} this.saveState = 'Recovery checkpoint saved in this browser; export still recommended'; this.message = 'Verified local database recovery copy. Export a portable backup.'; }
    fileInput(label, accept, handler, { multiple = false } = {}) { const i = node('input', null, { type: 'file', accept, multiple, 'aria-label': label }); i.addEventListener('change', () => { const files = [...i.files]; if (files.length)
        this.perform(() => handler(files)); }); return labeled(label, i); }
    async openFiles(files) {
        const file = files[0];
        invariant(file.size <= 128 * 1024 * 1024, 'Project file exceeds the preview import limit');
        if (file.name.endsWith('.nmt.zip') || file.name.endsWith('.zip')) {
            const p = await importBundle(new Uint8Array(await file.arrayBuffer()));
            await this.adopt(await ReviewProject.open(p));
            return;
        }
        if (file.name.endsWith('.xml')) {
            const result = await importMedTator(await file.text(), { mode: this.mode, actor: this.actor });
            if (await this.adopt(result.project))
                this.message = result.losses.length ? `${result.losses.length} legacy import limitations. Export the native bundle to retain the report.` : 'MedTator XML imported; attributes are strings until explicitly mapped.';
            return;
        }
        if (file.name.endsWith('.jsonl')) {
            const idField = prompt('Document ID field', 'id'), textField = prompt('Document text field', 'text');
            if (!idField || !textField)
                return;
            await this.adopt(await importJSONL(await file.text(), DEMO_SCHEMA, { idField, textField, groupField:prompt('Group ID field (optional)','')||null,splitField:prompt('Split role field (optional)','')||null, mode: this.mode, actor: this.actor }));
            return;
        }
        const documents = [];
        for (const [i, f] of files.entries()) {
            invariant(f.size <= 16 * 1024 * 1024, 'Text file exceeds 16 MiB');
            documents.push(await sourceDocument(`document-${i + 1}`, new Uint8Array(await f.arrayBuffer()), { provenance: { kind: 'local-file', filename: f.name } }));
        }
        await this.adopt(await ReviewProject.create(documents, DEMO_SCHEMA, { mode: this.mode, actor: this.actor }));
    }
    render() {
        const focused = this.root.activeElement?.dataset?.focusKey;
        const source = this.root.querySelector('[data-testid=source]');
        const sourceState = source ? { start: source.selectionStart, end: source.selectionEnd, scroll: source.scrollTop } : null;
        this.root.replaceChildren(node('style', styles));
        const docked = !!document.querySelector('nextmedtator-assist');
        this.host.hidden = !this.open && !this.standalone && docked;
        if (!this.open) {
            if (docked)
                return;
            this.root.append(button('Clinical Evidence', () => { this.previousFocus = document.activeElement; this.open = true; this.render(); }, { id: 'open-workspace' }));
            this.root.lastChild.className = 'closed';
            return;
        }
        const app = node('section', null, { class: `app${this.standalone ? ' full' : ''}`, role: this.standalone ? 'main' : 'dialog', 'aria-label': 'NextMedTator evidence workspace' });
        this.root.append(app);
        const top = node('header', null, { class: 'top' });
        top.append(node('span', 'NextMedTator', { class: 'brand' }), node('span', 'On this device', { class: 'badge' }), node('span', 'Engineering preview', { class: 'muted' }), node('span', null, { class: 'grow' }));
        if (this.project)
            top.append(node('span', `${this.project.current.mode} · ${this.project.current.phase}`, { class: 'badge stage', 'data-testid': 'phase' }));
        top.append(button('Privacy & storage', () => { this.panel = this.panel === 'privacy' ? null : 'privacy'; this.render(); }), button('Models', () => { this.panel = this.panel === 'models' ? null : 'models'; this.render(); }));
        if (!this.standalone)
            top.append(button('Back to MedTator', () => { this.open = false; this.render(); this.previousFocus?.focus(); }));
        app.append(top);
        const warning = node('div', 'Research annotation preview. Local model capabilities depend on the selected package. Authored sample suggestions are not model output; no fine-tuned LoRA is supplied.', { class: 'banner' });
        app.append(warning);
        if (this.message)
            app.append(node('div', this.message, { class: `message${this.error ? ' error' : ''}`, role: this.error ? 'alert' : 'status', 'data-testid': 'message' }));
        if (this.panel)
            this.renderPanel(app);
        if (!this.project) {
            this.renderWelcome(app);
            return;
        }
        const toolbar = node('div', null, { class: 'toolbar' }), p = this.project.current;
        toolbar.append(button('Save project', () => this.perform(() => this.save()), { primary: true, id: 'save' }), button('Undo', () => this.perform(() => { this.project.undo(); this.changed(); }), { disabled: p.phase === 'frozen' }), button('Freeze snapshot', () => this.perform(async () => { await this.project.snapshot(); this.changed(); this.message = 'Human snapshot frozen. Existing snapshots will not be overwritten.'; }), { disabled: p.phase === 'frozen', id: 'freeze' }));
        if (p.mode === 'blind' && p.phase === 'frozen')
            toolbar.append(button('Reveal comparison', () => this.perform(() => { this.project.reveal(); this.changed(); }), { disabled: p.runs.length === 0, id: 'reveal' }));
        toolbar.append(button('Compare & adjudicate', () => { this.panel = this.panel === 'compare' ? null : 'compare'; this.render(); }), button('Export & assignments', () => { this.panel = this.panel === 'exports' ? null : 'exports'; this.render(); }));
        toolbar.append(this.fileInput('Open project/files', '.nmt.zip,.zip,.txt,.xml,.jsonl', files => this.openFiles(files), { multiple: true }));
        app.append(toolbar);
        const main = node('div', null, { class: 'main' }), docs = node('nav', null, { class: 'documents', 'aria-label': 'Documents' });
        docs.append(node('h2', 'Documents'));
        for (const [i, d] of p.documents.entries()) {
            const full = p.draft.completeness[d.id]?.full;
            const b = button(`${i + 1}. ${d.provenance?.filename ?? d.id}\n${full ? 'Reviewed' : 'Not fully reviewed'}`, () => { if(this.doc){this.timer.pause(true);this.documentTimers.set(this.doc.id,this.timer);}this.index = i;this.timer=this.documentTimers.get(d.id)??new ActiveTimer({idleMs:this.timer.idleMs});this.timer.pause(this.manualPause);this.editor = null; this.render(); });
            b.setAttribute('aria-current', String(i === this.index));
            b.dataset.testid = `doc-${i}`;
            docs.append(b);
        }
        main.append(docs);
        const center = node('section', null, { class: 'source' });
        center.append(node('h2', this.doc?.provenance?.filename ?? this.doc?.id ?? 'No documents'));
        if (this.doc) {
            const note = node('textarea', null, { readonly: true, 'aria-label': 'Source text', 'data-testid': 'source', 'data-focus-key': 'source' });
            note.value = new TextareaOffsetMap(this.doc.text).view;
            center.append(note, node('p', 'Select source text, then add an occurrence. Text and line endings remain immutable.', { class: 'source-note' }));
            const tools = node('div', null, { class: 'actions' });
            tools.append(button('Add selected evidence', () => this.perform(() => { const a = note.selectionStart, b = note.selectionEnd; invariant(a !== b, 'Select source text first'); this.editor = { record: { id: uuid(), documentId: this.doc.id, family: Object.keys(p.schema.families)[0], anchor: [new TextareaOffsetMap(this.doc.text).selection(a, b)], fields: {} }, runId: null, predictionId: null }; }), { disabled: p.phase === 'frozen', id: 'add-evidence' }), button('Review completeness', () => { this.panel = this.panel === 'completeness' ? null : 'completeness'; this.render(); }, { disabled: p.phase === 'frozen' }));
            const font = choose([['15', 'Text: compact'], ['17', 'Text: default'], ['21', 'Text: large']], this.textSize ?? '17');
            font.addEventListener('change', () => { this.textSize = font.value; note.style.fontSize = `${font.value}px`; });
            note.style.fontSize = `${this.textSize ?? 17}px`;
            tools.append(font);
            const documentFamily=Object.keys(p.schema.families).find(id=>p.schema.families[id].documentLevel);if(documentFamily)tools.append(button('Add document label',()=>this.perform(()=>{this.editor={record:{id:uuid(),documentId:this.doc.id,family:documentFamily,anchor:[],fields:{}},runId:null,predictionId:null};})));
            center.append(tools);
            center.append(node('h3', 'Human evidence'));
            for (const r of p.draft.records.filter(r => r.documentId === this.doc.id))
                center.append(this.recordCard(r, { human: true }));
            if (!p.draft.records.some(r => r.documentId === this.doc.id))
                center.append(node('p', 'No human records yet. Missing records are not negative labels.', { class: 'muted' }));
        }
        main.append(center);
        const aside = node('aside', null, { class: 'panel', 'aria-label': 'Evidence and suggestions' });
        if (this.editor)
            this.renderEditor(aside);
        else
            this.renderSuggestions(aside);
        main.append(aside);
        app.append(main, node('footer', `${this.saveState} · Recovery ${this.recovery.enabled ? 'ON' : 'OFF'} · ${p.actor}`, { class: 'status', 'data-testid': 'save-status' }));
        if (sourceState && source && this.doc && new TextareaOffsetMap(this.doc.text).view === source.value) {
            const n = this.root.querySelector('[data-testid=source]');
            n?.setSelectionRange(sourceState.start, sourceState.end);
            if (n)
                n.scrollTop = sourceState.scroll;
        }
        if (focused)
            [...this.root.querySelectorAll('[data-focus-key]')].find(n=>n.dataset.focusKey===focused)?.focus({ preventScroll: true });
    }
    renderWelcome(app) {
        const w = node('div', null, { class: 'welcome' });
        w.append(node('h1', 'Your evidence. Your device.'), node('p', 'Review structured clinical evidence with portable projects, independent snapshots, and no document upload. Existing MedTator annotation remains available in the original workspace.'), node('p', 'Synthetic examples include authored suggestions, which are not model output. A span package predicts anchors and scores. A structured package also fills schema enum attributes from the exported span-attribute head. Measurement value, unit, and relations stay empty.', { class: 'muted' }));
        const mode = choose([['assisted', 'Assisted annotation'], ['blind', 'Blind annotation, compare later']], this.mode);
        mode.addEventListener('change', () => { this.mode = mode.value; });
        const actor = node('input', null, { value: this.actor, maxlength: 100, 'aria-label': 'Annotator identifier' });
        actor.addEventListener('input', () => { this.actor = actor.value; });
        w.append(labeled('Workflow', mode), labeled('Local annotator identifier', actor));
        const c = node('div', null, { class: 'choices' });
        c.append(button('Try synthetic sample', () => this.perform(async () => { await this.adopt(await demoProject(this.mode, this.actor)); this.message = DEMO_NOTICE; }), { primary: true, id: 'sample' }), this.fileInput('Open local documents or project', '.txt,.jsonl,.xml,.zip', files => this.openFiles(files), { multiple: true }));
        w.append(c, node('p', 'Your documents and annotations stay in memory unless you explicitly enable local recovery or export. Exported files may contain sensitive information.', { class: 'muted' }));
        if (window.app_hotpot?.vpp)
            w.append(button('Copy current MedTator documents', () => this.perform(async () => { const anns = window.app_hotpot.vpp.$data.anns; invariant(anns?.length, 'No MedTator documents loaded'); const docs = []; for (const [i, a] of anns.entries())
                docs.push(await sourceDocument(`legacy-${i + 1}`, new TextEncoder().encode(a.text), { provenance: { kind: 'medtator-working-copy', filename: String(a.fn ?? a.filename ?? i + 1) } })); await this.adopt(await ReviewProject.create(docs, DEMO_SCHEMA, { mode: this.mode, actor: this.actor })); this.message = 'Copied source text only. Original annotations remain in MedTator; use XML import for representable tags.'; })));
        app.append(w);
    }
    recordCard(r, { human = false, run = null } = {}) {
        const card = node('article', null, { class: 'card', 'data-testid': human ? 'human-record' : 'suggestion' });
        card.append(node('div', human ? 'Human annotation' : run?.producer?.kind === 'author-demo' ? 'Authored example' : 'Machine suggestion', { class: 'tag' }), node('p', r.anchor.map(s => s.text).join(' … ') || 'Document-level record', { class: 'anchor' }), node('p', `${r.family.replaceAll('_', ' ')}${r.score == null ? '' : ` · score ${r.score.toFixed(3)}`}`, { class: 'muted' }));
        for (const [k, v] of Object.entries(r.fields))
            card.append(node('p', `${k}: ${v === null ? 'Unknown / not supplied' : typeof v === 'object' ? JSON.stringify(v) : v}`, { class: 'muted' }));
        const actions = node('div', null, { class: 'actions' });
        if (run) {const check=node('input',null,{type:'checkbox','aria-label':'Select suggestion for group review'});check.checked=this.selectedSuggestions.has(`${run.id}/${r.id}`);check.onchange=()=>{const key=`${run.id}/${r.id}`;check.checked?this.selectedSuggestions.add(key):this.selectedSuggestions.delete(key);};card.append(check);}
        if (this.project.current.phase !== 'frozen') {
            if (!human) {
                const state = this.project.current.draft.decisions[`${run.id}/${r.id}`]?.status;
                card.append(node('p', `Review: ${state ?? 'unreviewed'}`, { 'data-testid': 'decision' }));
                actions.append(button('Accept', () => this.perform(() => { this.project.review(run.id, r.id, 'accepted'); this.changed(); }), { id: 'accept' }), button('Reject', () => this.perform(() => { this.project.review(run.id, r.id, 'rejected'); this.changed(); })), button('Defer', () => this.perform(() => { this.project.review(run.id, r.id, 'deferred'); this.changed(); })));
            }
            actions.append(button('Edit', () => { this.editor = { record: clone(r), runId: run?.id ?? null, predictionId: run ? r.id : null }; this.render(); }));
            if(human){
                actions.append(button('Split at selected boundary',()=>this.perform(()=>{const input=this.root.querySelector('[data-testid=source]'),viewMap=new TextareaOffsetMap(this.doc.text),point=viewMap.source.toCodePoint(viewMap.viewToSource.get(input.selectionStart));invariant(r.anchor.length===1&&point>r.anchor[0].start&&point<r.anchor[0].end,'Select a boundary inside this occurrence');const map=new OffsetMap(this.doc.text);const copies=[[r.anchor[0].start,point],[point,r.anchor[0].end]].map(([a,b])=>({...clone(r),id:uuid(),anchor:[map.span(a,b)],origin:{kind:'human-split',actor:this.project.current.actor,parents:[r.id]}}));this.project.transformRecords([r.id],copies,'split');this.changed();})));
                const others=this.project.current.draft.records.filter(x=>x.documentId===r.documentId&&x.family===r.family&&x.id!==r.id);
                if(others.length){const merge=choose(others.map(x=>[x.id,x.anchor.map(s=>s.text).join(' … ')]),others[0].id);actions.append(labeled('Merge with',merge),button('Merge occurrences',()=>this.perform(()=>{this.project.mergeRecords(r.id,merge.value);this.message='Merged occurrences: retained first fields, combined supporting evidence and external links, and removed links between merged occurrences. Review field differences.';this.changed();})));}
            }
            if (human)
                actions.append(button('Delete', () => this.perform(() => { this.project.remove(r.id); this.changed(); })));
        }
        const locate = button('Locate', () => { const n = this.root.querySelector('[data-testid=source]'); if (!r.anchor.length)
            return; const map = new TextareaOffsetMap(this.doc.text); try {
            n.focus();
            n.setSelectionRange(map.viewOffset(r.anchor[0].start), map.viewOffset(r.anchor.at(-1).end));
        }
        catch (error) {
            this.message = error.message;
            this.error = true;
            this.render();
        } });
        actions.append(locate);
        card.append(actions);
        return card;
    }
    renderSuggestions(aside) {
        const p = this.project.current;
        aside.append(node('h2', this.project.canSeeMachine ? 'Suggestions' : 'Independent annotation'));
        if (p.mode === 'blind' && p.phase === 'annotation') {
            aside.append(node('p', 'Machine suggestions, counts and hints are hidden. Freeze your human snapshot before importing predictions or comparing.'));
            return;
        }
        const isDemo = this.doc?.provenance?.origin === 'synthetic';
        if (isDemo)
            aside.append(button(p.phase === 'frozen' ? 'Prepare authored examples for reveal' : 'Show authored suggestions', () => this.perform(async () => { await this.project.addRun(await authoredSuggestionRun(this.project, this.doc)); this.changed(); this.message = DEMO_NOTICE; }), { id: 'demo-suggest' }));
        aside.append(this.fileInput('Import prediction run', '.json', async ([f]) => { invariant(f.size <= 64 * 1024 * 1024, 'Run size limit'); await this.project.addRun(jsonParse(await f.text())); this.changed(); }));
        const analyze = button('Analyze locally', () => this.perform(() => this.analyzeCurrent()), { disabled: !this.doc, id: 'analyze' });
        const structured = this.model?.manifest.variants.some(variant => variant.codec === GLINER_STRUCTURED || variant.codec===SMALL_CODEC);
        const small=this.model?.manifest.variants.some(v=>v.codec===SMALL_CODEC);
        analyze.title = small ? SMALL_NOTICE : structured ? 'Run the imported GLiNER2.5 package on this device. Spans plus enum attributes; value, unit, and relations stay empty.' : 'Run the imported GLiNER2.5 boundary package on this device. Span text and scores only; contextual fields stay empty.';
        aside.append(analyze, button('Force stop', () => this.modelRunner.cancel()), node('p', small ? SMALL_NOTICE : structured ? 'No remote inference. Enum attributes come from the local span-attribute head. Value, unit, and relations are not predicted.' : 'No remote inference. Import the local model package under Models. This run does not fill assertion, temporality, experiencer, or relations.', { class: 'muted' }));
        if (!this.project.canSeeMachine) {
            aside.append(node('p', 'The human snapshot is frozen. Use Reveal comparison when ready.'));
            return;
        }
        aside.append(button('Accept selected suggestions',()=>this.perform(()=>{const groups=new Map();for(const key of this.selectedSuggestions){const [run,id]=key.split('/');if(!groups.has(run))groups.set(run,[]);groups.get(run).push(id);}invariant(groups.size===1,'Select one explicit set from a single run');for(const [run,ids] of groups)this.project.reviewGroup(run,ids);this.selectedSuggestions.clear();this.changed();})));
        for (const run of p.runs.filter(r => r.documentId === this.doc?.id)) {
            aside.append(node('h3', run.producer.name ?? run.producer.kind), node('p', `Coverage status: ${run.status}. ${run.runtime.backend} / ${run.runtime.precision}. ${run.settings?.notice ?? run.producer.notice ?? ''}`, { class: 'muted' }));
            for (const r of run.records)
                aside.append(this.recordCard(r, { run }));
            if (!run.records.length)
                aside.append(node('p', run.status === 'complete' ? 'No suggestions in completed run. Human omission review is still required.' : 'Incomplete run: no negative conclusion.', { class: 'muted' }));
        }
    }
    renderEditor(aside) {
        const editing = this.editor, r = editing.record, p = this.project.current;
        aside.append(node('h2', 'Edit occurrence'), node('p', r.anchor.map(s => s.text).join(' … '), { class: 'anchor' }));
        const family = choose(Object.entries(p.schema.families).map(([id, def]) => [id, def.label ?? id]), r.family);
        aside.append(labeled('Occurrence family', family));
        family.addEventListener('change', () => { editing.record.family = family.value; editing.record.fields = {};if(p.schema.families[family.value].documentLevel)editing.record.anchor=[]; this.render(); });
        const grid = node('div', null, { class: 'fields' }), inputs = new Map();
        for (const [name, field] of Object.entries(p.schema.families[r.family].fields)) {
            let input;
            if (field.type === 'enum' || field.type === 'boolean') {
                const values = field.type === 'enum' ? field.values : ['true', 'false'];
                input = choose([['', 'Unknown / unreviewed'], ...values.map(v => [v, v])], r.fields[name] == null ? '' : String(r.fields[name]));
            }
            else {
                input = node('input', null, { type: field.type === 'number' ? 'number' : 'text', value: r.fields[name] == null ? '' : field.type === 'span' ? JSON.stringify(r.fields[name]) : String(r.fields[name]), 'aria-label': name });
            }
            input.dataset.field = name;
            input.addEventListener('change',()=>{const v=input.value;r.fields[name]=v===''?null:field.type==='number'?Number(v):field.type==='boolean'?v==='true':field.type==='span'?jsonParse(v):v;});
            inputs.set(name, { input, field });
            grid.append(labeled(name, input));
        }
        aside.append(grid);
        const selectSpan=()=>{const input=this.root.querySelector('[data-testid=source]');invariant(input&&input.selectionEnd>input.selectionStart,'Select source text first');return new TextareaOffsetMap(this.doc.text).selection(input.selectionStart,input.selectionEnd);};
        aside.append(button('Replace anchor with selected text',()=>this.perform(()=>{r.anchor=[selectSpan()];})),button('Add supporting selection',()=>this.perform(()=>{r.evidence??=[];r.evidence.push(selectSpan());})),button('Clear supporting evidence',()=>{r.evidence=[];this.render();}));
        for(const span of r.evidence??[])aside.append(node('p',`Supporting evidence: ${span.text}`));
        const targets=p.draft.records.filter(target=>target.documentId===r.documentId&&target.id!==r.id);
        if(targets.length){const target=choose(targets.map(t=>[t.id,t.anchor.map(s=>s.text).join(' … ')]),targets[0].id),type=node('input',null,{'aria-label':'Relation type',placeholder:'Relation type'});aside.append(labeled('Related occurrence',target),labeled('Relation type',type),button('Add relation',()=>this.perform(()=>{invariant(type.value.trim(),'Enter a relation type');r.relations??=[];r.relations.push({type:type.value.trim(),targetId:target.value});})));}
        for(const [index,rel] of (r.relations??[]).entries())aside.append(button(`Remove ${rel.type} relation`,()=>{r.relations.splice(index,1);this.render();}));
        const reason = node('textarea' , null, { rows: 2, 'aria-label': 'Review rationale', placeholder: 'Optional review rationale' });
        aside.append(labeled('Review rationale', reason));
        const actions = node('div', null, { class: 'actions' });
        actions.append(button('Save evidence', () => this.perform(() => {
            const updated = clone(r);
            updated.fields = {};
            for (const [name, { input, field }] of inputs) {
                const value = input.value;
                updated.fields[name] = value === '' ? null : field.type === 'number' ? Number(value) : field.type === 'boolean' ? value === 'true' : field.type === 'span' ? jsonParse(value) : value;
            }
            if (editing.runId)
                this.project.review(editing.runId, editing.predictionId, 'modified', updated, reason.value);
            else
                this.project.record(updated);
            this.editor = null;
            this.changed();
        }), { primary: true, id: 'save-evidence' }), button('Cancel', () => { this.editor = null; this.render(); }));
        aside.append(actions);
    }
    renderPanel(app) {
        const box = node('section', null, { class: 'details' });
        box.append(button('Close panel', () => { this.panel = null; this.render(); }));
        app.append(box);
        if (this.panel === 'privacy') {
            box.append(node('h3', 'Local data and recovery'), node('p', 'Documents are processed on this device. No documents, annotations, filenames or review events are uploaded. Public app assets are downloaded. Browser extensions, shared devices and cloud-synced download folders are outside this application’s control.'));
            const idle=node('input',null,{type:'number',min:5,max:3600,'aria-label':'Timing idle cutoff in seconds'});idle.value=this.timer.idleMs/1000;idle.onchange=()=>{const seconds=Number(idle.value);if(seconds>=5&&seconds<=3600){this.timer.tick();this.timer.idleMs=seconds*1000;}};box.append(labeled('Timing idle cutoff in seconds',idle),button(this.manualPause?'Resume active timing':'Pause active timing',()=>{this.manualPause=!this.manualPause;this.timer.pause(this.manualPause);this.render();}));
            box.append(node('p', 'Browser recovery is optional, contains project data and may be evicted. A portable export is your durable copy. Deleting browser data is not a promise of forensic erasure.'));
            if (this.project) {
                if (!this.recovery.enabled)
                    box.append(button('Enable local recovery', () => this.perform(async () => { if (!confirm('Store this project, including clinical text, in this browser profile? Do not enable on a shared device.'))
                        return; await this.recovery.enable(this.project.current.id, { consent: true }); await this.checkpoint(); }), { id: 'recovery-enable' }));
                else
                    box.append(button('Save recovery checkpoint', () => this.perform(() => this.checkpoint()), { id: 'checkpoint' }), button('Delete recovery & disable', () => this.perform(async () => { if (!confirm('Delete this project’s browser recovery copy? Current in-memory work will remain.'))
                        return; await this.recovery.forget(); this.recovery.disable(); this.saveState = 'Recovery deleted; export work to keep it'; })));
            }
            if(this.recovery.enabled)box.append(button('Inspect saved project',()=>this.perform(async()=>{this.databaseReport=await this.recovery.query();})),button('Export SQLite project backup',()=>this.perform(async()=>{await this.checkpoint();localDownload(await this.recovery.exportDatabase(),`${this.project.current.id}.nmt.sqlite3`,'application/vnd.sqlite3');})));if(this.databaseReport)box.append(node('pre',JSON.stringify(this.databaseReport,null,2)));
            box.append(button('Inspect storage usage',()=>this.perform(async()=>{const estimate=await navigator.storage?.estimate?.();const models=await this.modelStore.list();this.storageReport={browserBytes:estimate?.usage??null,quotaBytes:estimate?.quota??null,modelBytes:models.reduce((n,m)=>n+m.bytes,0),recoveryProjects:(await this.recovery.list()).length};})));if(this.storageReport)box.append(node('pre',JSON.stringify(this.storageReport,null,2)));
            box.append(button('Clear all local application data',()=>this.perform(async()=>{if(!confirm('Delete installed models, browser recovery projects and app caches? Export current work first.'))return;this.modelRunner.cancel();await this.recovery.clear();for(const m of await this.modelStore.list())await this.modelStore.remove(m.manifestHash);for(const key of await caches.keys())if(key.startsWith('nextmedtator-app-'))await caches.delete(key);const registration=await navigator.serviceWorker.getRegistration();if(registration)await registration.unregister();this.model=null;this.installedModels=[];this.recoveryList=[];this.saveState='Browser application data deleted; current work remains in memory';})));
            box.append(button('List saved recovery projects', () => this.perform(async () => { this.recoveryList = await this.recovery.list(); })));
            for(const warning of this.recovery.listWarnings)box.append(node('p',warning,{role:'status','data-testid':'recovery-list-warning'}));
            for (const r of this.recoveryList ?? [])
                box.append(button(`Recover ${r.id} (${r.updatedAt}; ${r.backend==='indexeddb-legacy'?'legacy recovery':'local database'})`, () => this.perform(async () => { const saved = await this.recovery.read(r.id,{backend:r.backend}); invariant(saved, 'Recovery entry no longer exists'); await this.adopt(await ReviewProject.open(saved.data), { recoveryHash: saved.hash, recoveryBackend:r.backend }); })));
            box.append(button('Install app for offline use', () => this.perform(async () => { invariant('serviceWorker' in navigator, 'Service workers unavailable'); const registration = await navigator.serviceWorker.register(new URL('../../service-worker.js', import.meta.url), { scope: new URL('../../', import.meta.url).pathname }); await navigator.serviceWorker.ready; this.message = 'App cache installed. Reload once, then test offline. Model assets require separate qualification.'; })), button('Export local timing report', () => localDownload(new TextEncoder().encode(JSON.stringify({projectId:this.project?.current.id,actor:this.project?.current.actor,schemaHash:this.project?.current.schemaHash,waitingMs:Math.round(this.waitMs),documents:this.project?.current.documents.map(d=>({documentId:d.id,sourceHash:d.textSha256,groupId:d.groupId,split:d.split,...(d.id===this.doc?.id?this.timer:this.documentTimers.get(d.id))?.report()}))??[]}, null, 2)), 'timing.json', 'application/json')));
        }
        else if (this.panel === 'models') {
            box.append(node('h3', 'Local model packages'), node('p', 'Training and export stay external. Import a .nmt-model.zip with exact hashes, runtime version, baseline/LoRA lineage and fixtures. No package-supplied JavaScript or WASM plugins are accepted.'));
            box.append(node('p', 'Live analysis uses an imported GLiNER2.5 package. A span package predicts anchors and scores. A structured package also fills enum attributes from the span-attribute head. Value, unit, relations, and model weights are not bundled.', { class: 'banner' }));
            box.append(button('List installed models',()=>this.perform(async()=>{this.installedModels=await this.modelStore.list();})));
            for(const installed of this.installedModels??[])box.append(node('p',`${installed.manifest.id} · ${installed.bytes} bytes`),button('Use installed '+installed.manifest.id,()=>this.perform(async()=>{this.model=await this.modelStore.read(installed.manifestHash);invariant(this.model,'Installed package missing');this.message='Installed model loaded; works without network';})),button('Delete installed '+installed.manifest.id,()=>this.perform(async()=>{await this.modelStore.remove(installed.manifestHash);this.installedModels=await this.modelStore.list();})));
            box.append(button('Show approved public model',()=>this.perform(async()=>{const response=await fetch(new URL('../../models/catalog.json',import.meta.url),{credentials:'omit'});invariant(response.ok,'Model catalog unavailable');this.catalog=await response.json();})));
            for(const entry of this.catalog?.entries??[]){const m=entry.manifest,total=m.files.reduce((n,f)=>n+f.bytes,0);box.append(node('p',`${m.id} ${entry.revision} · ${m.license.id} · ${total} download bytes; allow at least ${total*2} bytes storage · ${m.variants.map(v=>v.backend).join(', ')} · anchored records and enums; automatic relations withheld; no anchorless records`),button('Download and install '+m.id,()=>this.perform(async()=>{this.installController=new AbortController();try{const candidate=await downloadCatalogPackage(entry,{signal:this.installController.signal,onProgress:({received,total})=>{this.message=`Downloading ${received} of ${total} bytes`;const message=this.root.querySelector('[data-testid=message]');if(message)message.textContent=this.message;}});const installed=await this.modelStore.install(candidate,{signal:this.installController.signal});this.model=installed;this.message='Public model installed and hashes verified';}finally{this.installController=null;}})),button('Force stop',()=>this.installController?.abort()));}
            box.append(this.fileInput('Import local model package', '.zip', async ([f]) => { invariant(f.size <= MODEL_LIMITS.archive, 'Model archive exceeds 1 GiB preview limit'); const candidate = await importModelPackage(new Uint8Array(await f.arrayBuffer())); this.model = candidate; this.modelReport = null; const small=candidate.manifest.variants.some(v=>v.codec===SMALL_CODEC);const structured = candidate.manifest.variants.some(v => v.codec === GLINER_STRUCTURED); const qualified = candidate.manifest.variants.some(v => CODECS[v.codec].clinicalInference); this.message = small ? 'GLiNER2.5-small record package loaded in memory. Anchors, enums and supported record fields; automatic relations remain unqualified.' : structured ? 'GLiNER2.5 structured package loaded in memory. Analyze locally fills spans and enum attributes on this device only.' : qualified ? 'GLiNER2.5 span package loaded in memory. Analyze locally uses it on this device only.' : 'Package hashes validated. This package can run tensor fixtures only.'; }));
            if (this.model) {
                box.append(button('Install imported package for offline use',()=>this.perform(async()=>{this.model=await this.modelStore.install(this.model);this.message='Model package installed and read-back verified';})),button('Verify offline readiness',()=>this.perform(async()=>{invariant(navigator.serviceWorker.controller,'Install and reload the app first');invariant(await this.modelStore.read(this.model.manifestHash),'Install this model first');const report=await this.modelRunner.run(this.model,this.model.manifest.variants.find(v=>v.backend==='wasm').id);invariant(report.pass,'Model conformance failed');this.message='App controlled by installed cache; selected model stored and conformance passed. Restart with network blocked to verify the full workflow.';})));
                const m = this.model.manifest;
                box.append(node('p', `${m.id} ${m.version} · ${m.lineage.adapter ? 'LoRA-derived' : 'Baseline'} · ${m.license.id}`));
                for (const v of m.variants)
                    box.append(button(`Run ${v.id} conformance`, () => this.perform(async () => { this.modelReport = await this.modelRunner.run(this.model, v.id); this.message = this.modelReport.pass ? (v.codec===SMALL_CODEC ? 'Source spans, exact tokenizer IDs and native ONNX numerical head fixtures passed. This does not establish clinical accuracy.' : CODECS[v.codec].coverage === 'structured-span' ? 'Span fixtures matched. Enum attributes, value, unit, and relations were not part of this fixture.' : CODECS[v.codec].coverage === 'entity-span' ? 'Span fixtures matched. Attributes and relations were not tested.' : 'Graph fixtures passed. This codec does not extract clinical text.') : 'Fixture differences found.'; })), button('Force stop', () => this.modelRunner.cancel()));
                box.append(button('Unload package', () => { this.modelRunner.cancel(); this.model = null; this.modelReport = null; this.render(); }));
                if (this.modelReport)
                    box.append(node('pre', JSON.stringify(this.modelReport, null, 2)));
            }
        }
        else if (this.panel === 'completeness' && this.doc) {
            box.append(node('h3', 'Review completeness'), node('p', 'Accepting suggestions does not check for omitted evidence. Mark complete only after reviewing the entire document for all schema families.'));
            const checked = node('input', null, { type: 'checkbox' });
            const check = labeled('I checked the whole document for omissions and unresolved evidence across all listed families.', checked);
            check.className = 'check';
            const relations = node('input', null, { type: 'checkbox' });
            box.append(labeled('I checked all declared relations, including absent links.', relations));
            box.append(check, button('Mark document fully reviewed', () => this.perform(() => { invariant(checked.checked, 'Confirm omission review first'); this.project.completeness(this.doc.id, { families: Object.keys(this.project.current.schema.families), ranges: [[0, new OffsetMap(this.doc.text).length]], omissionsChecked: true, relationsChecked: relations.checked }); this.changed(); this.panel = null; }), { id: 'complete' }));
        }
        else if (this.panel === 'exports' && this.project) {
            const p = this.project.current;
            box.append(node('h3', 'Exports and independent assignments'));
            box.append(button('Export current MedTator XML', () => this.perform(() => { const { xml, losses } = exportMedTator(this.doc, p.draft.records.filter(r => r.documentId === this.doc.id), p.schema); localDownload(new TextEncoder().encode(xml), `${this.doc.id}.xml`, 'application/xml'); localDownload(new TextEncoder().encode(JSON.stringify(losses, null, 2)), `${this.doc.id}.loss-report.json`, 'application/json'); this.message = 'Legacy XML is lossy for provenance and grouped records. The separate report lists the losses.'; })), button('Export review events', () => localDownload(new TextEncoder().encode(eventCSV(p.events)), 'review-events.csv', 'text/csv')), button('Export schema', () => localDownload(new TextEncoder().encode(JSON.stringify(p.schema, null, 2)), 'schema.json', 'application/json')));
            box.append(this.fileInput('Start new project with schema JSON', '.json', async ([f]) => { const schema = validateSchema(jsonParse(await f.text())); await this.adopt(await ReviewProject.create(p.documents, schema, { mode: p.mode, actor: p.actor })); this.message = 'Created a new schema-specific project. Existing annotations were not reinterpreted.'; }));
            box.append(this.fileInput('Preview schema revision and mapping JSON', '.json', async([f])=>{const input=jsonParse(await f.text());this.migrationProposal=await previewSchemaMigration(this.project,input.schema??input,input.mapping??{});this.message='Schema migration preview prepared; review losses before applying.';}));if(this.migrationProposal){box.append(node('pre',JSON.stringify(this.migrationProposal.report,null,2)),button('Apply reviewed schema revision',()=>this.perform(async()=>{const next=await applySchemaMigration(this.project,this.migrationProposal);if(await this.adopt(next)){this.migrationProposal=null;this.changed();this.message='New revision created; original schema, project and migration report retained.';}})));}
            box.append(button('Create blind assignment bundle', () => this.perform(async () => { const actor = prompt('Independent annotator identifier'); if (!actor)
                return; const assignment = await this.project.blindAssignment(actor); localDownload(await exportBundle(assignment.current), `${assignment.current.id}.nmt.zip`, 'application/zip'); this.message = 'Assignment excludes predictions, human snapshots and review history. Do not use a previously exposed reviewer as independent.'; })));
            for (const s of p.snapshots) {
                box.append(node('p', `${s.id} · ${s.kind} · ${s.independent ? 'independent' : 'exposed/adjudicated'}`), button('Export snapshot JSON', () => localDownload(new TextEncoder().encode(canonical(s)), `${s.id}.snapshot.json`, 'application/json')), button('Export evidence JSONL', () => localDownload(new TextEncoder().encode(evidenceJSONL(p, s)), `${s.id}.jsonl`, 'application/jsonl')), button('Export training candidates', () => localDownload(new TextEncoder().encode(this.project.trainingCandidates(s.id).map(r => JSON.stringify(r)).join('\n')), `${s.id}.train.jsonl`, 'application/jsonl')));
            }
        }
        else if (this.panel === 'compare' && this.project) {
            const p = this.project.current;
            box.append(node('h3', 'Independent comparison and adjudication'));
            if (p.mode === 'blind' && p.phase !== 'revealed') {
                box.append(node('p', 'Freeze and reveal before showing comparison results. Independent annotation remains hidden from machine cues.'));
                return;
            }
            box.append(this.fileInput('Import independent snapshot', '.json', async ([f]) => { invariant(f.size <= 64 * 1024 * 1024, 'Snapshot size limit'); await this.project.importSnapshot(jsonParse(await f.text())); this.changed(); }));
            if (p.runs.length) {
                const selected = new Set();
                const list = node('div');
                list.append(node('p', 'Create a machine comparison snapshot: select one run per document from the same model and settings.'));
                for (const run of p.runs) {
                    const input = node('input', null, { type: 'checkbox' });
                    input.onchange = () => { if (input.checked)
                        selected.add(run.id);
                    else
                        selected.delete(run.id); };
                    const label = labeled(`${run.documentId} · ${run.producer.name ?? run.producer.kind} · ${run.status} · ${run.id.slice(0, 8)}`, input);
                    label.className = 'check';
                    list.append(label);
                }
                list.append(button('Freeze selected machine layer', () => this.perform(async () => { const s = await machineSnapshot(this.project, [...selected]); await this.project.importSnapshot(s); this.changed(); }), { id: 'machine-snapshot' }));
                box.append(list);
            }
            if (p.snapshots.length < 2) {
                box.append(node('p', 'Freeze or import two snapshots under the same exact source and schema. Unreviewed coverage is excluded from scoring.'));
                return;
            }
            const choices = p.snapshots.map(s => [s.id, `${s.actor} · ${s.kind} · ${s.id.slice(0, 8)}`]);
            const left = choose(choices, this.leftId ?? choices[0][0]), right = choose(choices, this.rightId ?? choices[1][0]);
            left.setAttribute('aria-label','Left / reference snapshot');right.setAttribute('aria-label','Right / candidate snapshot');
            left.onchange = () => { this.leftId = left.value; refreshCandidates(); };
            right.onchange = () => { this.rightId = right.value; refreshCandidates(); };
            const referenceDeclared=node('input',null,{type:'checkbox'}),matchMode=choose([['exact','Exact anchors'],['overlap','Overlap anchors, IoU ≥ 0.5']],'exact');box.append(labeled('Left / reference snapshot', left), labeled('Right / candidate snapshot', right),labeled('Study protocol explicitly declares the left snapshot as reference',referenceDeclared),labeled('Matching policy',matchMode));
            box.append(button('Compare snapshots', () => this.perform(async () => { invariant(left.value !== right.value, 'Choose different snapshots'); this.leftId = left.value; this.rightId = right.value; const worker=new Worker(new URL('./compare-worker.mjs',import.meta.url),{type:'module'});try{this.comparison=await new Promise((resolve,reject)=>{worker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.report);worker.onerror=()=>reject(new Error('Comparison worker failed'));worker.postMessage([p.snapshots.find(s=>s.id===left.value),p.snapshots.find(s=>s.id===right.value),{referenceDeclared:referenceDeclared.checked,mode:matchMode.value,iou:.5}]);});}finally{worker.terminate();}await this.project.addComparison(this.comparison);this.changed(); })), button('Adjudicate current human draft as third snapshot', () => this.perform(async () => { invariant(left.value !== right.value, 'Choose different input snapshots'); const rationale = prompt('Rationale for the current human evidence as the adjudicated result'); if (!rationale)
                return; await this.project.adjudicate(left.value, right.value, p.draft.records, { rationale,unresolved:(prompt('Unresolved case identifiers, separated by commas','')||'').split(',').map(x=>x.trim()).filter(Boolean) }); this.changed(); this.message = 'Created third adjudicated snapshot. Both inputs are unchanged; completeness requires separate confirmation.'; })));
            const candidates=node('div',null,{'data-testid':'adjudication-candidates'});
            const refreshCandidates=()=>{candidates.replaceChildren();for(const snapshotId of new Set([left.value,right.value])){const snapshot=p.snapshots.find(s=>s.id===snapshotId);for(const r of snapshot.records)candidates.append(button(`Use ${r.anchor.map(s=>s.text).join(' … ')} from ${snapshot.actor} in adjudication draft`,()=>this.perform(()=>{invariant([left.value,right.value].includes(snapshot.id),'Choose a candidate from the selected inputs');this.project.copyAdjudicationGroup(snapshot.id,r.id);this.changed();})));}};
            refreshCandidates();box.append(candidates);
            if (this.comparison) {
                box.append(button('Export comparison CSV',()=>localDownload(new TextEncoder().encode(comparisonCSV(this.comparison)),'comparison.csv','text/csv')),node('pre', JSON.stringify(this.comparison, null, 2)), button('Export comparison report', () => localDownload(new TextEncoder().encode(JSON.stringify(this.comparison, null, 2)), 'comparison.json', 'application/json')));
            }
        }
    }
}
let booted = false;
function boot() {
    if (booted)
        return;
    if (document.querySelector('#app_hotpot') && !window.app_hotpot?.vpp) {
        setTimeout(boot, 50);
        return;
    }
    booted = true;
    const assistHost = document.querySelector('nextmedtator-assist');
    const searchHost=document.querySelector('nextmedtator-search');
    if(searchHost)new CorpusSearch(searchHost,window.app_hotpot.vpp);
    const existing = document.querySelector('nextmedtator-workspace');
    if (existing)
        new EvidenceWorkspace(existing, { standalone: existing.hasAttribute('standalone') });
    else if (!assistHost) {
        const host = document.createElement('nextmedtator-workspace');
        document.body.append(host);
        new EvidenceWorkspace(host);
    }
    if (assistHost)
        mountLegacyAssist(assistHost, { async openProject(project) {
            let host = document.querySelector('nextmedtator-workspace');
            if (!host) {
                host = document.createElement('nextmedtator-workspace');
                document.body.append(host);
                new EvidenceWorkspace(host, { startOpen: true });
                if(project)await host.workspace.adopt(project);
                host.workspace.render();
                return;
            }
            host.workspace.open = true;
            if(project)await host.workspace.adopt(project);
            host.workspace.render();
        } });
}
boot();
