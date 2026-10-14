import {themeColors} from './theme-colors.mjs';
import {conformanceMessage} from './conformance-report.mjs';
import {detectDevice,deviceRecommendation} from './device-profile.mjs';
import {suggestionPage,validateUndoTags} from './review-queue.mjs';
import {exportCollection,exportCollectionBlob,importCollectionBackup} from './collection-backup.mjs';
import {CollectionStore} from './collection-store.mjs';
import {LONG_CONTEXT_SETTINGS} from './long-context.mjs';
import {defaultCpuThreads} from './inference-options.mjs';
import {CorpusCommitGate,createBatchQueue,restoreBatchQueue,checkpointBatchQueue,queueCounts,queueWork,batchReport} from './batch-queue.mjs';
import {loadWasmFallback} from './model-fallback.mjs';
import {renderLoadingProgress} from './loading-progress.mjs';
import {PRACTICE_TASKS} from './practice-tasks.mjs';
import {ENTITY_ATTRIBUTES_CODEC,entityContractSchema} from './entity-contract.mjs';
import {suggestionThreshold,thresholdControl} from './threshold.mjs';
import {CLINICAL_V3_CODEC,clinicalV3Schema} from './clinical-v3.mjs';
import {LegacyRecoverySession} from './backend/legacy-session.mjs';
import {presetScope, compileScope, freezeScope, importScope, scopeIdentity, nativeScopeDTD, sameScope} from './scope.mjs';
import {renderScopeEditor} from './scope-ui.mjs';
import {ModelIntegrityError,ModelStore,downloadCatalogPackage,cacheModelForSession} from './model-store.mjs';
import {createModelSelectionState,saveModelSelectionState,setModelSelection,selectionThresholdOverride,setSelectionThresholdOverride,restoreSelectionThresholdOverride,modelSelectionKey,modelSelectionControlValue,modelSelectionLabel,modelSelectionMatchesManifest,matchingInstalledModels,selectionFromManifest,localAdapterSelection,renderModelSelectionControls} from './model-selection.mjs';
import {ReviewProject,makeRun} from './project.mjs';
import {exportBundle,localDownload} from './bundle.mjs';
import {isRecordsCodec,recordsNotice,validateSmallSchema,smallPromptCost} from './gliner-small.mjs';
import { DEMO_SCHEMA } from './contracts.mjs';
import { importModelPackage, ConformanceWorker, qualifyForSchema, selectInferenceVariant, activeVariantForSchema, modelRunProvenance, CODECS, MODEL_LIMITS } from './model-package.mjs';
import {EXECUTION_POLICY,graphTransforms,supportsWebGPU} from './execution-policy.mjs';
import { schemaEntityLabels, schemaPrompt, spansToRecords, SPAN_NOTICE, STRUCTURED_NOTICE, GLINER_CODEC, GLINER_STRUCTURED, GlinerTokenizer, planWindows } from './gliner.mjs';
import { clone, freeze, sourceDocument, uuid, OffsetMap, fingerprint, invariant, jsonParse, sha256 } from './integrity.mjs';

const styles = `
:host{--assist-accent:#0078d7;display:block;height:100%;color:#222;font:12px/1.45 "Segoe UI",Arial,sans-serif}
*{box-sizing:border-box}
button,input,select{font:inherit;color:inherit}
button,select{border:1px solid #bdbdbd;border-radius:0;background:#fafafa;padding:4px 7px;cursor:pointer;max-width:100%}
button{min-height:28px;text-align:left;overflow-wrap:anywhere}
button:hover{background:#e5f3ff;border-color:#0078d7}
button:disabled{opacity:.5;cursor:not-allowed}
button.primary{background:#0078d7;color:#fff;border-color:#0078d7}
button.primary:hover{background:#005a9e}
:focus-visible{outline:3px solid #137aab;outline-offset:2px}
button:focus:not(:focus-visible){outline:none}
.dock{height:100%;display:flex;flex-direction:column;background:#fff}
.rail{height:100%;width:100%;border:0;border-radius:0;background:#f7f9fa;writing-mode:vertical-rl;text-orientation:mixed;letter-spacing:.04em}
.head{flex-shrink:0;min-height:0;padding:12px;border-bottom:1px solid #d7e1e7;display:flex;flex-direction:column;gap:4px}
.head p{margin:0;overflow-wrap:anywhere}.head strong{font-size:15px}.head .document-name{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.action-bar{padding:10px 12px;border-bottom:1px solid #d7e1e7;flex-shrink:0;background:#fff}.action-bar .row{display:grid;grid-template-columns:1fr 1fr auto;gap:6px}.action-bar button{min-height:34px}.action-bar p{margin:6px 0 0;font-size:11px;color:#536976}.section{margin:0 0 12px;padding:10px;background:#fff;border:1px solid #d7e1e7;border-radius:8px}.section summary{font-weight:650;cursor:pointer;padding:2px 0}.section summary:focus-visible{outline:2px solid #137aab}.section[open]>summary{margin-bottom:10px}.section>h3{margin:0 0 8px;font-size:13px}.section .row{margin:6px 0}.section .model-selection h3{margin:0 0 8px;font-size:13px}.section .model-selection [role=status]{font-size:11px;color:#536976}.section .model-selection pre{font-size:10px}.body>.card{box-shadow:0 1px 2px #1a304108}.setup-hint{padding:8px;background:#edf4f6;border-radius:5px;margin:8px 0;font-size:12px}.body>.muted{margin:8px 0}.badge.pending{background:#fff2db;color:#78571c}.badge.ready{background:#e8f5ef;color:#176444}
.head label{flex-direction:row;align-items:center}
.head select{flex:1;min-width:0}
.row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.grow{flex:1}
.badge{border-radius:2px;padding:1px 5px;background:#eef5f0;font-size:10px;border:1px solid #d5e3da}
.muted{color:#536976;font-size:12px}
.body{overflow:auto;padding:8px;flex:1;min-height:80px;scrollbar-gutter:stable}
.card{background:#fff;border:1px solid #d7e1e7;border-radius:8px;padding:8px;margin:0 0 8px}
.card p{margin:3px 0;overflow-wrap:anywhere}
.anchor{font-weight:650}
.tag{font-size:10px;letter-spacing:.04em;text-transform:uppercase}
.message{margin:0 8px 8px;padding:8px;border-radius:6px;background:#edf4f6;overflow-wrap:anywhere;max-height:25%;overflow:auto;flex-shrink:0}
.message.error{background:#fff0ec;border:1px solid #db927f}
.docs{max-height:112px;overflow:auto;border:1px solid #d7e1e7;border-radius:6px;background:#fff;padding:4px 6px}
.check{display:flex;gap:6px;align-items:center;flex-direction:row}
label{display:flex;flex-direction:column;gap:3px;font-size:12px}
input[type=file]{max-width:100%;font-size:11px}
.threshold{margin:0 0 8px}.threshold-title{display:flex;align-items:center;justify-content:space-between;gap:8px}.threshold output{font-weight:650;font-variant-numeric:tabular-nums}.threshold input[type=range]{width:100%;margin:6px 0;padding:0;accent-color:#076b74;cursor:pointer}.threshold p{margin:4px 0}.threshold button{margin-top:4px}
.model-selection{min-width:0;max-width:100%;overflow-wrap:anywhere}.model-selection label,.model-selection details{min-width:0;max-width:100%}.model-selection input[type=text],.model-selection select{width:100%;min-width:0}.model-selection select{text-overflow:ellipsis}.model-selection pre{max-width:100%;overflow:auto;white-space:pre;font-size:11px}
.scope{border:1px solid #d7e1e7;border-radius:6px;background:#fff;padding:8px;margin:8px 0}
.scope p{margin:5px 0}.scope label{margin:5px 0}.scope textarea{width:100%;font:inherit;color:inherit;border:1px solid #d7e1e7;border-radius:5px;resize:vertical}
.scope fieldset{border:1px solid #d7e1e7;margin:8px 0;padding:6px}.scope h3{margin:10px 0 5px}
.unmatched{color:#8a3b16}
.compact{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}
.compact td{border-bottom:1px solid #d7e1e7;padding:3px 2px;vertical-align:middle}
.compact td:last-child{width:110px;text-align:right}
.compact button{font-size:10px;padding:3px 4px;margin-left:2px}
.compact strong,.compact small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.compact small{font-size:10px;color:#536976}
.icon{font-family:"Font Awesome 5 Free";font-weight:900;font-style:normal;display:inline-block;width:1.15em;text-align:center;margin-right:6px;line-height:1;flex-shrink:0;speak:none}
.icon::before{content:attr(data-glyph)}
.head{padding:8px 10px;background:#f5f5f5;border-color:#d9d9d9;gap:5px}
.head strong{font-size:13px;font-weight:600}.head .row>.icon{font-size:16px;margin-right:0}
.head select{background:#fff}.head .document-name{font-size:11px}
.action-bar{padding:8px;background:#f5f5f5;border-color:#d9d9d9}.action-bar .row{gap:4px}.action-bar button{min-height:42px;padding:5px 3px;text-align:center;line-height:1.25;font-size:11px}.action-bar button .icon{display:block;margin:0 auto 4px;font-size:16px}
.section{padding:8px;margin-bottom:8px;border:1px solid #d9d9d9;border-radius:0;background:#fff}
.section>summary{margin:-8px;padding:7px 8px;background:#f5f5f5;font-weight:600;font-size:12px;user-select:none}
.section>summary:hover{background:#e5f3ff}.section[open]>summary{margin-bottom:8px;border-bottom:1px solid #ddd}
.section>summary .icon{color:#444}.section .section{margin-top:8px;margin-bottom:0}.section .section>summary{font-size:11px;background:#fafafa}
.section>button{margin:3px 3px 3px 0}.section>label{margin:7px 0}.section>h3,.section .model-selection h3{font-size:12px;font-weight:600}
.setup-hint{border-radius:0;border-left:3px solid #0078d7;background:#eff6fc;padding:7px 8px;margin:7px 0;font-size:11px}.setup-hint p{margin:4px 0}.setup-hint .section{border:0;padding-bottom:0}.setup-hint .section>summary{background:transparent}
.message{border-radius:0;background:#eff6fc;border-left:3px solid #0078d7;margin:0 8px 6px;font-size:11px;padding:6px 8px}
.card,.docs,.scope,.scope textarea{border-radius:0;border-color:#d9d9d9}.body>.card{box-shadow:none}
.muted,.section .model-selection [role=status]{color:#595959;font-size:11px}.threshold input[type=range]{accent-color:#0078d7}
input[type=text],textarea{border:1px solid #bdbdbd;padding:4px;max-width:100%}input[type=checkbox]{accent-color:#0078d7}
input[type=file]{width:100%;padding:4px 0}input::file-selector-button{font:inherit;border:1px solid #bdbdbd;border-radius:0;background:#fafafa;padding:4px 7px;margin-right:6px;cursor:pointer}
a{color:#0067b8}label{gap:4px;font-size:11px}.section label>span{font-weight:600}.check{font-weight:400}
.model-download{border-top:1px solid #ddd;padding-top:6px;margin-top:8px}.model-download button{width:100%;padding:7px;text-align:left}.model-download p{margin:4px 0}
.dock .loading-progress{border-color:#d9d9d9;border-radius:0;color:#222;font:12px/1.45 "Segoe UI",Arial,sans-serif;padding:8px}.dock .loading-progress progress{accent-color:#0078d7;height:10px}
.rail{background:#f5f5f5;color:#333;font-size:12px}.rail .icon{margin:0 0 6px}
.action-bar{background:#fff;border:0;padding:7px 0 0}.action-bar .row{grid-template-columns:1fr}.action-bar button{min-height:32px;font-size:12px}.action-bar button .icon{display:inline-block;font-size:12px;margin:0 6px 0 0}.section>h3{margin-bottom:7px}.section p{margin:5px 0}.head{padding:7px 8px}.head>[data-testid=assist-pause]{align-self:flex-end}.section>.primary{width:100%;padding:7px}.body>.section{margin-bottom:8px}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

// Reuse the same local Font Awesome face as the original ribbon. Decorative
// glyphs stay out of accessible names; every action retains its text label.
const ICONS={assist:'f0d0',practice:'f15c',collections:'f07c',options:'f1de',recovery:'f0c7',packages:'f1b2','device-details':'f108','package-details':'f05a','local-packages':'f0a0',batch:'f03a',download:'f019',upload:'f093',play:'f04b',pause:'f04c',save:'f0c7',open:'f07c',check:'f00c',undo:'f0e2',remove:'f2ed',close:'f00d',list:'f03a',hide:'f054',search:'f002'};
function firstManifestPrecision(manifest){
    if(!Array.isArray(manifest?.variants)||manifest.variants.length===0)return null;
    const precision=manifest.variants[0]?.precision;
    return typeof precision==='string'&&precision.length?precision:null;
}
function icon(name){return node('span',null,{class:'icon','aria-hidden':'true','data-glyph':String.fromCodePoint(parseInt(ICONS[name]??ICONS.assist,16))});}
function actionIcon(text){
    for(const [pattern,name] of [[/^Analyze|^Resume/,'play'],[/^Pause/,'pause'],[/^Download|^Export|^Use browser download/,'download'],[/^Import|^Install/,'upload'],[/^Save|^Enable local/,'save'],[/^Open|^Restore|^Use installed/,'open'],[/^Reject|^Cancel|^Close|^Unload|^Disable/,'close'],[/^Remove|^Delete/,'remove'],[/^Undo|^Retry|^Reset/,'undo'],[/^Check GPU|^Select|^Apply|^Write|^Add to|^Use recommended/,'check'],[/^List/,'list'],[/^Show approved/,'search'],[/^Hide/,'hide'],[/^P10|^BPSD/,'practice']])if(pattern.test(text))return name;
    return null;
}

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

export function legacySchema(dtd) {
    const families={};
    for(const tag of dtd?.etags??[])families[tag.name]={label:tag.name,...(tag.is_non_consuming?{documentLevel:true}:{}),fields:{concept:{type:'text'},...Object.fromEntries(editableAttrs(tag).map(attr=>[attr.name,{type:attr.vtype==='list'?'enum':'text',...(attr.vtype==='list'?{values:attr.values}:{})}]))}};
    invariant(Object.keys(families).length,'Load a span annotation schema');
    const relations={};for(const tag of dtd?.rtags??[]){const refs=(tag.attrs??[]).filter(a=>a.vtype==='idref');if(refs.length===2)relations[tag.name]={head:Object.keys(families),tail:Object.keys(families),legacy:{head:refs[0].name,tail:refs[1].name}};}return {id:'medtator-schema',version:'1',families,...(Object.keys(relations).length?{relations}:{})};
}
export function legacyRecords(ann,doc,schema){
 const map=new OffsetMap(doc.text),records=(ann.tags??[]).filter(t=>t.spans&&schema.families[t.tag]).map(t=>({id:t.id,documentId:doc.id,family:t.tag,anchor:schema.families[t.tag].documentLevel?[]:t.spans.split(',').map(range=>{const [a,b]=range.split('~').map(Number);return map.selection(a,b);}),fields:Object.fromEntries(Object.entries(schema.families[t.tag].fields).map(([name,def])=>[name,name==='concept'?t.text:((def.type==='enum'&&t[name]===''&&!def.values.includes(''))?null:t[name]??null)])),origin:{kind:'imported',source:'medtator-working-copy',reviewStatus:'unknown'}}));
 for(const tag of ann.tags??[]){const rel=schema.relations?.[tag.tag];if(!rel)continue;const head=records.find(r=>r.id===tag[rel.legacy.head]),tail=records.find(r=>r.id===tag[rel.legacy.tail]);invariant(head&&tail,'Legacy relation endpoint is missing');head.relations??=[];head.relations.push({type:tag.tag,targetId:tail.id});}return records;
}
function disclosure(assist,key,title,defaultOpen=false) {
    assist.sectionState ??= new Map();
    const details=node('details',null,{class:'section','data-testid':`assist-${key}`});
    details.open=assist.sectionState.get(key)??defaultOpen;
    const summary=node('summary',title);
    if(ICONS[key])summary.prepend(icon(key));
    // The native toggle event is deferred. Preserve the user's intent before
    // another control rerenders this panel in the same event cycle.
    summary.addEventListener('click',()=>assist.sectionState.set(key,!details.open));
    details.append(summary);
    details.addEventListener('toggle',()=>{if(details.isConnected)assist.sectionState.set(key,details.open);});
    return details;
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
    const guide=actionIcon(text);if(guide)n.prepend(icon(guide));
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
        this.modelSelectionState=createModelSelectionState();this.modelSelection=this.modelSelectionState.selection;this.selectionDraftMode=modelSelectionControlValue(this.modelSelection);this.selectionDraft=null;this.thresholdOverride=selectionThresholdOverride(this.modelSelectionState);
        this.modelSelectionEpoch=0;
        this.scope = null;this.scopeDraft=presetScope();this.scopeEditing=false;
        this.suggestionView = 'cards';
        this.detail = null;
        this.model = null;
        this.modelRunner = new ConformanceWorker();this.modelStore=new ModelStore();this.collectionStore=new CollectionStore();
        this.unavailableInstalledModels=new Map();
        this.runs = new Map();
        this.projects = new Map();
        this.runHistory = [];this.corpusCreatedAt=null;this.corpusIdentity=null;
        this.exposed = new Set();
        this.exposure = [];
        this.blinded = new Set();
        this.blindSnapshots = new Map();
        this.selected = new Set();
        this.message = '';
        this.error = false;
        this.busy = false;
        this.progress = null;
        this.apply = null;
        this.signature = '';
        this.recoverySession=new LegacyRecoverySession({capture:id=>this.captureCorpus(id),restore:project=>this.restoreCorpus(project),onStatus:()=>this.render()});
        this.unwatch=null;
        host.setAttribute('role', 'complementary');
        host.setAttribute('aria-label', 'Local assistance');
        this.root.addEventListener('keydown',event=>this.reviewShortcut(event));
        this.render();
        void this.restoreSelectedModel();
        void detectDevice().then(device=>{this.deviceProfile=device;this.render();});
        this.timer = setInterval(() => this.sync(), 500);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) this.sync(); });
        window.addEventListener('beforeunload',event=>{const session=this.recoverySession;if(this.collectionDirty||session.enabled&&(session.pending||session.revision!==session.savedRevision)){event.preventDefault();event.returnValue='';}});
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
        if(!this.unwatch&&legacy()?.vpp?.$watch)this.unwatch=legacy().vpp.$watch(()=>({dtd:legacy().data.dtd,anns:legacy().data.anns}),()=>{if(this.collection){this.collectionEditRevision=(this.collectionEditRevision??0)+1;this.collectionDirty=true;clearTimeout(this.collectionSaveTimer);this.collectionSaveTimer=setTimeout(()=>{if(!this.busy)this.perform(()=>this.saveCollectionCurrent());},1200);}else this.recoverySession.touch();},{deep:true});
        const host = document.querySelector('nextmedtator-assist');
        if (host && host !== this.host) {
            this.host = host;
            this.root = host.attachShadow({ mode: 'open' });
            host.assist = this;this.root.addEventListener('keydown',event=>this.reviewShortcut(event));
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
            section: view?.data?.section,
            visible: !document.hidden && this.host.getClientRects().length > 0,
            mode: this.mode,
            modelSelection:modelSelectionKey(this.modelSelection),
            model: this.model?.manifest?.id ?? '',
            codec: this.model?.manifest?.variants?.map(v => v.codec).join(',') ?? '',
            message: this.message,
            recoveryStatus:this.recoverySession.status,
            error: this.error,
            busy: this.busy,
            progress: this.progress,
            key: view?.key ?? '',
            filename: ann?._filename ?? '',
            tags: ann?.tags?.length ?? 0,
            schema: dtd?.name ?? '',
            files: (view?.data?.anns ?? []).map(item => item?._filename ?? ''),
            selected: this.selected.size,
            exposed: [...this.exposed],
            frozen: this.blindSnapshots.has(view?.key),
            run: view?.run ? { status: view.run.status, decisions: view.run.decisions, count: view.run.records.length } : null,
            apply: this.apply?.id ?? '',
            suggestionView: this.suggestionView, detail: this.detail,
            scope:this.scope?.semanticSchema.schema_hash??null,scopeEditing:this.scopeEditing
        });
    }
    async perform(action) {
        if (this.busy)
            return;
        this.busy = true;
        this.loadingProgress={phase:'Loading model / working locally',started:performance.now()};
        this.error = false;
        this.render();
        try {
            await action();
            if(this.collection)await this.saveCollectionCurrent();
            if(this.recoverySession.enabled)this.recoverySession.touch();
        }
        catch (error) {
            const cancelled=/cancelled/i.test(error?.message??'')||error?.name==='AbortError';
            this.error = !cancelled;
            this.message = cancelled&&this.batchQueue?.state==='paused'?'Batch paused. Completed results are retained. Choose Resume unfinished to continue.':error?.message ?? 'The annotation was left unchanged.';
        }
        finally {
            this.busy = false;
            this.loadingProgress=null;
            this.progress = null;this.windowProgress=null;
            if(this.collection&&this.current().ann?._diskKey&&this.collectionDirty&&!this.error){clearTimeout(this.collectionSaveTimer);this.collectionSaveTimer=setTimeout(()=>{if(!this.busy)this.perform(()=>this.saveCollectionCurrent());},1200);}
            this.render();
        }
    }
    async loadSelectedPackage(){
        const precision=this.downloadPrecision??deviceRecommendation(this.deviceProfile,{execution:this.executionPreference}).precision??'fp32';
        const selection=this.modelSelection,selectionKey=modelSelectionKey(selection),epoch=this.modelSelectionEpoch;
        const installedCandidates=matchingInstalledModels(selection,this.installedModels??[]).filter(item=>firstManifestPrecision(item.manifest)===precision);
        const installed=installedCandidates.find(item=>!this.unavailableInstalledModels.has(item.manifestHash))??installedCandidates[0];
        if(installed&&!this.unavailableInstalledModels.has(installed.manifestHash)){
            await this.useInstalledModel(installed.manifestHash);this.message='Model ready. Continue to Analyze note.';return;
        }
        if(!this.catalog){const response=await fetch(new URL('../../models/catalog.json',import.meta.url),{credentials:'omit'});invariant(response.ok,'Model list could not load. Check your connection and retry.');this.catalog=await response.json();}
        invariant(epoch===this.modelSelectionEpoch&&selectionKey===modelSelectionKey(this.modelSelection),'Model selection changed while loading. Select the model again and retry.');
        const entry=this.catalog.entries.find(item=>modelSelectionMatchesManifest(selection,item.manifest)&&firstManifestPrecision(item.manifest)===precision);
        invariant(entry,'No public download matches this source. Choose P10 or BPSD, or import a local package.');
        const total=entry.manifest.files.reduce((n,f)=>n+f.bytes,0);
                this.installController=new AbortController();
                try{
                    this.loadingProgress={phase:'Downloading model',received:0,total:total,started:performance.now()};renderLoadingProgress(this.root,this.loadingProgress);const candidate=await downloadCatalogPackage(entry,{signal:this.installController.signal,onStage:stage=>{this.loadingProgress={...stage,started:performance.now()};renderLoadingProgress(this.root,this.loadingProgress);},onProgress:({received,total,file})=>{if(this.loadingProgress.phase!=='Downloading model')this.loadingProgress.started=performance.now();Object.assign(this.loadingProgress,{received,total,file,phase:received===total?'Verifying model integrity':'Downloading model'});renderLoadingProgress(this.root,this.loadingProgress);}});
                    invariant(epoch===this.modelSelectionEpoch&&selectionKey===modelSelectionKey(this.modelSelection)&&modelSelectionMatchesManifest(selection,candidate.manifest),'Model selection changed during download');
                    this.loadingProgress.phase='Installing and verifying local storage';renderLoadingProgress(this.root,this.loadingProgress);const installed=await cacheModelForSession(this,candidate,{signal:this.installController.signal});
                    invariant(epoch===this.modelSelectionEpoch,'Model selection changed during installation');
                    if(!this.modelStorageNotice)this.unavailableInstalledModels.delete(installed.manifestHash);
                    this.adoptModel(installed);await this.inspectStorage();this.message='Model ready. Continue to Analyze note in step 4.';
                }finally{this.installController=null;}

    }
    async exportCollectionBackup({browserDownload=false}={}){
        let handle;
        if(!browserDownload&&typeof window.showSaveFilePicker==='function'){
            try{handle=await window.showSaveFilePicker({suggestedName:'collection.nmt.jsonl',types:[{description:'NextMedTator collection',accept:{'application/x-ndjson':['.jsonl']}}]});}
            catch(error){if(error?.name==='AbortError')return;/* Ordinary browser download needs no file-system grant. */}
        }
        await this.perform(async()=>{
            this.installController=new AbortController();
            try{
                const started=performance.now();await this.saveCollectionCurrent();
                const options={signal:this.installController.signal,onProgress:progress=>{this.loadingProgress={phase:'Exporting collection',...progress,started};renderLoadingProgress(this.root,this.loadingProgress);}};
                if(handle){await exportCollection(this.collectionStore,this.collection,await handle.createWritable(),options);this.message='Portable collection backup saved with per-note integrity checks.';}
                else{const blob=await exportCollectionBlob(this.collectionStore,this.collection,options);localDownload(blob,'collection.nmt.jsonl','application/x-ndjson');this.message='Collection backup download requested. Check your browser downloads and keep the file safely. Browser-download backups are limited to 64 MiB.';}
            }finally{this.installController=null;}
        });
    }
    setOpen(open) {
        this.open = open;
        sessionStorage.setItem('nmt-assist-open', String(open));
        this.render();
        requestAnimationFrame(() => window.app_hotpot?.codemirror?.refresh?.());
    }
    async loadPracticeTask(task) {
        const view=legacy();
        invariant(view, 'The annotation workspace is still starting.');
        if(view.data.anns.length&&!confirm('Replace the current notes with a fictional practice task? Export your current work first.'))return;
        const schema=window.dtd_parser.parse(task.dtd,'dtd');
        if(this.collection){await this.saveCollectionCurrent();this.collection=null;}
        await this.recoverySession.disable();
        this.runs.clear();this.projects.clear();this.runHistory=[];this.batchQueue=null;
        this.corpusIdentity=null;this.corpusCreatedAt=null;
        this.exposed.clear();this.exposure=[];this.blinded.clear();this.blindSnapshots.clear();this.selected.clear();
        this.apply=null;this.detail=null;this.scope=null;this.scopeEditing=false;this.mode='assisted';
        view.data.anns=[];view.data.ann_idx=0;
        view.app.set_dtd(schema);view.data.dtd=schema;
        const ann=view.vpp.add_sample_txt_as_ann(task.text);
        ann._filename=task.id+'-practice.txt.xml';
        view.data.mn4anns=1;view.vpp.set_ann_idx(0);
        this.setSelectedModel({id:task.model},{render:false});
        this.message='Practice note ready. Next: load the model in step 3.';
    }
    structured() {
        return !!this.model?.manifest.variants.some(variant => variant.codec === GLINER_STRUCTURED || isRecordsCodec(variant.codec));
    }
    beginModelSelectionAction() {
        this.modelSelectionEpoch++;
        return this.modelSelectionEpoch;
    }
    setSelectedModel(selection,{render=true,restoreInstalled=true,intent=true}={}) {
        if(intent)this.beginModelSelectionAction();
        const epoch=this.modelSelectionEpoch;
        const next=setModelSelection(this.modelSelectionState,selection),changed=modelSelectionKey(next)!==modelSelectionKey(this.modelSelection);
        if(changed){this.modelRunner.cancel();this.model=null;this.gpuCheck=null;this.qualifiedManifest=null;this.qualifiedVariant=null;this.message='';}
        this.modelSelection=next;this.selectionDraftMode=modelSelectionControlValue(next);this.selectionDraft=null;this.thresholdOverride=selectionThresholdOverride(this.modelSelectionState);saveModelSelectionState(this.modelSelectionState);
        if(restoreInstalled)void this.restoreSelectedModel({epoch});
        if(render)this.render();
    }
    adoptModel(candidate,{selectSource=false}={}){
        this.executionStatus=null;this.gpuCheck=null;
        if(candidate&&!modelSelectionMatchesManifest(this.modelSelection,candidate.manifest)){
            if(!selectSource)throw new Error('Installed model does not match the selected source. Choose the package lineage explicitly before loading it.');
            this.setSelectedModel(selectionFromManifest(candidate.manifest),{render:false,restoreInstalled:false,intent:false});
        }
        if(selectSource){this.selectionDraftMode=modelSelectionControlValue(this.modelSelection);this.selectionDraft=null;saveModelSelectionState(this.modelSelectionState);}
        if(this.model&&candidate&&this.model.manifestHash!==candidate.manifestHash)this.modelRunner.cancel();
        this.model=candidate;
        if(!this.scope&&sameScope(this.scopeDraft,presetScope())&&candidate.manifest.variants[0].codec===CLINICAL_V3_CODEC)this.scopeDraft=presetScope('all',CLINICAL_V3_CODEC,candidate.manifest.variants[0].threshold);
    }
    async restoreSelectedModel({epoch=this.modelSelectionEpoch}={}) {
        const requested=modelSelectionKey(this.modelSelection);
        const current=()=>epoch===this.modelSelectionEpoch&&requested===modelSelectionKey(this.modelSelection);
        try {
            const installed=await this.modelStore.listExisting();
            if(!current()||this.model)return;
            this.installedModels=installed;
        } catch(error) {if(current()){this.error=true;this.message=`Selected model could not be verified from local storage: ${error.message}`;}}
        if(current())this.render();
    }
    unloadModel(){
        this.beginModelSelectionAction();this.modelRunner.cancel();this.model=null;this.modelStorageNotice=null;this.scopeTokenizer=null;this.scopeTokenizerManifest=null;this.scopeTokenizerPath=null;this.qualifiedManifest=null;this.qualifiedVariant=null;this.executionStatus=null;
        this.message='Model unloaded from memory. Installed files and annotations remain available.';this.render();
    }
    async inspectStorage(){
        this.installedModels=await this.modelStore.listExisting().catch(()=>[]);this.storageEstimate=await navigator.storage?.estimate?.().catch(()=>null);
    }
    rememberGPUCheck(summary){
        if(summary.backend!=='webgpu')return;
        this.gpuCheck={format:'nextmedtator-gpu-check-v1',createdAt:new Date().toISOString(),browser:navigator.userAgent,
            modelId:this.model?.manifest.id,runtimeVersion:this.model?.manifest.runtimeVersion,
            ...summary};
    }
    async checkGPU(){
        invariant(this.model,'Load a model first');this.gpuCheck=null;
        this.message='Checking the loaded model on this GPU using public synthetic examples. No FP32 download will start.';
        await this.modelRunner.checkGPU(this.model,this.model.manifest.variants[0].id,{
            onConformance:summary=>this.rememberGPUCheck(summary),
            onInitialization:stage=>{this.loadingProgress={...stage,started:performance.now()};renderLoadingProgress(this.root,this.loadingProgress);}});
        this.message=conformanceMessage(this.gpuCheck);
    }
    async useInstalledModel(manifestHash) {
        const epoch=this.beginModelSelectionAction();
        let candidate;
        try{candidate=await this.modelStore.read(manifestHash);}
        catch(error){if(error instanceof ModelIntegrityError)this.unavailableInstalledModels.set(manifestHash,'corrupt');throw error;}
        if(epoch!==this.modelSelectionEpoch)return false;
        if(!candidate){this.unavailableInstalledModels.set(manifestHash,'missing');throw new Error('Installed package is missing from local storage. Download it again before continuing.');}
        this.unavailableInstalledModels.delete(manifestHash);
        this.adoptModel(candidate,{selectSource:true});this.modelStorageNotice=null;
        return true;
    }
    async importPackage(file) {
        const epoch=this.beginModelSelectionAction();
        if (file.size > MODEL_LIMITS.archive)
            throw new Error('Model archive exceeds 1 GiB');
        const candidate = await importModelPackage(new Uint8Array(await file.arrayBuffer()));
        if(epoch!==this.modelSelectionEpoch)return;
        this.adoptModel(candidate,{selectSource:true});this.modelStorageNotice=null;
        const structured = candidate.manifest.variants.some(variant => variant.codec === GLINER_STRUCTURED || isRecordsCodec(variant.codec));
        const qualified = candidate.manifest.variants.some(variant => CODECS[variant.codec].clinicalInference);
        this.message = candidate.manifest.variants[0].codec===ENTITY_ATTRIBUTES_CODEC
            ? 'Entity/attribute package loaded locally. Complete native prompt, explicit applicability, declared overlap and token budget; no bindings or relations.'
            : structured
            ? 'GLiNER2.5 structured package loaded in memory. Analyze fills spans and enum attributes on this device.'
            : qualified
                ? 'GLiNER2.5 span package loaded in memory. Analyze fills spans and scores on this device.'
                : 'Package hashes validated. This package can run tensor fixtures only.';
    }
    checkScopeBudget(schema,variant) {
        invariant(isRecordsCodec(variant.codec),'Clinical scopes require a GLiNER2.5 record package');
        if(this.scopeTokenizerManifest!==this.model.manifestHash||this.scopeTokenizerPath!==variant.tokenizer){
            this.scopeTokenizer=GlinerTokenizer.fromJson(new TextDecoder().decode(this.model.files.get(variant.tokenizer)));
            this.scopeTokenizerManifest=this.model.manifestHash;this.scopeTokenizerPath=variant.tokenizer;
        }
        const prompt=schemaPrompt(schema),prefixTokens=smallPromptCost(schema,this.scopeTokenizer,{completeClinicalPrompt:!!variant.clinicalRelease});
        planWindows(this.scopeTokenizer,prompt.labels,[{text:'clinical',start:0,end:8}],{prefixTokens});
    }
    async applyScope() {
        const draft=clone(this.scopeDraft),schema=compileScope(draft,legacySchema(legacy().data.dtd),this.model?.manifest.variants[0]?.codec);
        if(this.model)this.checkScopeBudget(schema,selectInferenceVariant(this.model,qualifyForSchema(this.model,schema).level));
        const old=this.scope?.semanticSchema,s=draft.semanticSchema;
        if(old&&old.name===s.name){s.parent_schema_hash=old.schema_hash;if(s.version===old.version)s.version=/^\d+$/.test(s.version)?String(Number(s.version)+1):s.version+'.1';}
        this.scope=await freezeScope(draft);this.thresholdOverride=setSelectionThresholdOverride(this.modelSelectionState,null);saveModelSelectionState(this.modelSelectionState);this.scopeDraft=clone(this.scope);this.scopeEditing=false;
        for(const project of this.projects.values())project.setSuggestionScope(this.scope);
        this.message=`Scope applied: ${this.scope.semanticSchema.name}. Analyze to create a new scoped run; existing predictions stay unchanged.`;
    }
    async importScope(input) {this.scopeDraft=await importScope(input);this.scopeEditing=true;this.message='Scope imported for editing. Apply scope to use it for the next analysis.';}
    disableScope() {this.scope=null;for(const project of this.projects.values())project.setSuggestionScope(null);this.message='Scope disabled for future runs. Existing machine runs retain their recorded scopes.';if(this.recoverySession.enabled)this.recoverySession.touch();this.render();}
    async exportScope(semanticOnly) {
        invariant(this.scope,'Apply a scope before exporting');
        localDownload(new TextEncoder().encode(JSON.stringify(semanticOnly?this.scope.semanticSchema:this.scope,null,2)+'\n'),semanticOnly?'clinical-evidence-semantic-schema.json':'clinical-suggestion-scope.json','application/json');
    }
    async useScopeSchema() {
        const view=legacy();invariant(view,'Original annotation workspace unavailable');
        invariant(!view.data.anns.some(ann=>ann.tags?.length)&&!this.projects.size,'Existing annotations or evidence projects require a new task or reviewed schema migration; download this schema first');
        const dtd=window.dtd_parser.parse(nativeScopeDTD(this.scopeDraft),'dtd');
        view.app.set_dtd(dtd);view.data.dtd=dtd;
        for(const ann of view.data.anns)ann._has_saved=false;
        view.vpp.refresh_v_anns();
        view.vpp.$forceUpdate();this.message='Clinical annotation schema loaded. Apply scope, then analyze your notes.';
    }
    allDocuments(){return this.collection?.notes??legacy()?.data?.anns??[];}
    async openCollection(id,{replaceConfirmed=false}={}){
        if(this.collection)await this.saveCollectionCurrent();
        else if(!replaceConfirmed&&legacy().data.anns.length&&!confirm('Open this disk-backed collection? Export the current ordinary workspace first.'))return;
        await this.recoverySession.disable();
        const meta=await this.collectionStore.read(id);invariant(meta,'Collection no longer exists');
        this.collection=meta;this.batchQueue=restoreBatchQueue(meta.queue);this.mode=meta.settings?.mode??meta.queue?.settings?.mode??'assisted';this.longContext=meta.settings?.longContext??true;this.selected.clear();this.batchPage=0;
        this.projects.clear();this.runs.clear();this.runHistory=[];this.blindSnapshots.clear();this.blinded.clear();this.exposed.clear();this.exposure=[];this.reviewUndo=[];
        const view=legacy();view.data.anns=[];view.app.set_dtd(meta.dtd);view.data.dtd=meta.dtd;view.vpp.refresh_v_anns();
        this.message=`${meta.notes.length} notes on disk. Open a note or select notes to analyze.`;
    }
    async importCollection(files){
        invariant(legacy()?.data.dtd,'Load an annotation schema first');
        if(this.collection)await this.saveCollectionCurrent();
        if(legacy().data.anns.length&&!this.collection&&!confirm('Store a new collection on this device? Export the current workspace before replacing it.'))return;
        const meta=await this.collectionStore.create(legacy().data.dtd,files[0]?.name?'Collection · '+files[0].name:'Local collection');
        this.installController=new AbortController();const started=performance.now();
        try{await this.collectionStore.importFiles(meta,files,{keyFor:documentKey,signal:this.installController.signal,onProgress:progress=>{this.loadingProgress={phase:'Storing collection locally',...progress,started};renderLoadingProgress(this.root,this.loadingProgress);}});}
        finally{this.installController=null;await this.openCollection(meta.id,{replaceConfirmed:true});}
    }
    async hydrateCollectionNote(item){
        const row=await this.collectionStore.note(this.collection.id,item._diskKey);
        invariant(row.sourceHash===item.sourceHash,'Collection source changed');
        if(row.project){const project=await ReviewProject.open(row.project);this.projects.set(item._diskKey,project);if(row.run){const saved=project.current.runs.find(r=>r.id===row.run.nativeRunId);invariant(saved,'Stored prediction history is missing');this.runs.set(item._diskKey,{...row.run,records:saved.records,project});}}
        if(row.blindSnapshot)this.blindSnapshots.set(item._diskKey,freeze(row.blindSnapshot));
        if(row.blinded)this.blinded.add(item._diskKey);if(row.exposed)this.exposed.add(item._diskKey);
        return row.ann;
    }
    evictCollectionNotes(){
        const key=this.current().key;
        for(const map of [this.projects,this.runs,this.blindSnapshots])for(const id of map.keys())if(id!==key)map.delete(id);
        this.runHistory=[];this.reviewUndo=(this.reviewUndo??[]).filter(u=>u.key===key);
        this.blinded=new Set([...this.blinded].filter(id=>id===key));this.exposed=new Set([...this.exposed].filter(id=>id===key));this.exposure=this.exposure.filter(e=>e.key===key);
    }
    async saveCollectionNote(ann,{editRevision=this.collectionEditRevision??0}={}){
        if(!this.collection||!ann?._diskKey)return;
        const item=this.collection.notes.find(n=>n._diskKey===ann._diskKey);invariant(item&&documentKey(ann._filename,ann.text)===item._diskKey,'Collection source or filename changed. Export this note before reopening the collection.');
        const project=this.projects.get(item._diskKey),run=this.runs.get(item._diskKey);
        this.collection.queue=this.batchQueue;this.collection.settings={mode:this.mode,longContext:this.longContext!==false};
        await this.collectionStore.commit(this.collection,{key:item._diskKey,sourceHash:item.sourceHash,ann:jsonParse(JSON.stringify(ann,(key,value)=>key==='_fh'?null:value)),project:project?.current??null,run:run?{...run,project:undefined,records:undefined}:null,blindSnapshot:this.blindSnapshots.get(item._diskKey)??null,blinded:this.blinded.has(item._diskKey),exposed:this.exposed.has(item._diskKey)});
        this.collectionDirty=(this.collectionEditRevision??0)!==editRevision;
    }
    async saveCollectionCurrent(){
        const ann=this.current().ann;if(!this.collection||!ann?._diskKey){clearTimeout(this.collectionSaveTimer);this.collectionDirty=false;return;}
        const editRevision=this.collectionEditRevision??0,snapshot=jsonParse(JSON.stringify(ann,(key,value)=>key==='_fh'?null:value));
        await this.syncProject(snapshot);await this.saveCollectionNote(snapshot,{editRevision});
    }
    async openCollectionNote(key){
        await this.saveCollectionCurrent();
        invariant(!legacy().data.anns.some(a=>!a._diskKey),'Close the collection before importing ordinary workspace notes; export those notes first.');
        const item=this.collection.notes.find(n=>n._diskKey===key);invariant(item,'Collection note missing');
        const ann=await this.hydrateCollectionNote(item),view=legacy();
        view.data.anns=[];const active=view.vpp.add_sample_txt_as_ann(ann.text);Object.assign(active,ann);view.vpp.set_ann_idx(0);view.vpp.refresh_v_anns();
        this.apply=null;this.detail=null;this.evictCollectionNotes();this.refreshNativeHints();this.message='Note loaded from local storage. Other notes and histories remain on disk.';
    }
    async closeCollection(){
        await this.saveCollectionCurrent();this.collection=null;this.batchQueue=null;this.selected.clear();this.projects.clear();this.runs.clear();this.runHistory=[];this.reviewUndo=[];legacy().data.anns=legacy().data.anns.filter(a=>!a._diskKey);legacy().vpp.refresh_v_anns();this.message='Collection closed. Its local files remain available under List collections.';
    }
    async ensureProject(ann,schema=legacySchema(legacy().data.dtd)) {
        const key=documentKey(ann._filename??'document',ann.text??''),hash=await fingerprint(schema);
        let project=this.projects.get(key);
        if(!project||project.current.schemaHash!==hash){const doc=await sourceDocument('legacy-note',new TextEncoder().encode(ann.text),{provenance:{kind:'medtator-working-copy',filename:ann._filename}});project=await ReviewProject.create([doc],schema,{mode:this.mode==='blind'?'blind':'assisted',actor:'legacy-annotator'});const data=clone(project.current);data.draft.records=legacyRecords(ann,doc,schema);if(this.scope)data.extensions.suggestionScope=clone(this.scope);if(this.exposed.has(key))data.exposure=clone(this.exposure.filter(e=>e.key===key));project=await ReviewProject.open(data);this.projects.set(key,project);}
        return project;
    }
    async syncProject(ann,schema=legacySchema(legacy().data.dtd)){
        const project=await this.ensureProject(ann,schema),records=legacyRecords(ann,project.current.documents[0],project.current.schema),key=documentKey(ann._filename??'document',ann.text),viewRun=this.runs.get(key);
        const mapping=new Map(project.current.draft.records.filter(r=>r.origin?.legacyTagId).map(r=>[r.origin.legacyTagId,r.id]));
        for(const [predictionId,d]of Object.entries(viewRun?.decisions??{}))if(d.tagId){const id=project.current.draft.decisions[`${viewRun.nativeRunId}/${predictionId}`]?.humanId;if(id)mapping.set(d.tagId,id);}
        for(const record of records)if(mapping.get(record.id)){const original=project.current.draft.records.find(r=>r.id===mapping.get(record.id));const legacyId=record.id;record.id=mapping.get(legacyId);record.origin={...original?.origin,legacyTagId:legacyId};if(original?.conceptId&&JSON.stringify(original.anchor)===JSON.stringify(record.anchor))record.conceptId=original.conceptId;}
        for(const record of records)for(const rel of record.relations??[])if(mapping.get(rel.targetId))rel.targetId=mapping.get(rel.targetId);
        if(project.current.phase!=='frozen'&&JSON.stringify(records)!==JSON.stringify(project.current.draft.records)){
            if(project.current.draft.records.length)project.transformRecords(project.current.draft.records.map(r=>r.id),records,'legacy-working-copy-sync','Explicit native export of the current legacy annotation');
            else for(const record of records)project.record(record);
        }
        return project;
    }
    async withCorpusCommit(action){
        this.corpusCommits??=new CorpusCommitGate();
        return this.corpusCommits.run(action);
    }
    async captureCorpus(id=uuid()){
        return this.withCorpusCommit(()=>this.captureCorpusSnapshot(id));
    }
    async captureCorpusSnapshot(id){
        const view=legacy();invariant(view?.data.dtd&&view.data.anns.length,'Load a schema and documents before enabling recovery');
        const workspace=jsonParse(JSON.stringify({dtd:view.data.dtd,anns:view.data.anns,annIndex:view.data.ann_idx},(key,value)=>key==='_fh'?null:value));
        const schema=legacySchema(workspace.dtd),documents=[],records=[],children=[];
        for(const [index,ann]of workspace.anns.entries()){
            const project=await this.syncProject(ann,schema),doc=await sourceDocument(`note-${index+1}`,new TextEncoder().encode(ann.text),{provenance:{kind:'medtator-working-copy',filename:ann._filename}});
            invariant(!children.some(child=>child.key===documentKey(ann._filename??'document',ann.text)),'Duplicate document identity; rename duplicate notes before recovery');documents.push(doc);children.push({documentId:doc.id,key:documentKey(ann._filename??'document',ann.text),project:clone(project.current)});
            const current=legacyRecords(ann,doc,schema),ids=new Map();for(const record of current)ids.set(record.id,'record-'+await sha256(doc.id+'\0'+record.id));
            for(const record of current)records.push({...record,id:ids.get(record.id),relations:(record.relations??[]).map(rel=>({...rel,targetId:ids.get(rel.targetId)})),origin:{kind:'imported',source:'legacy-recovery',legacyProjectId:project.current.id,legacyRecordId:record.id,reviewStatus:'preserved-in-child-project'}});
        }
        const project=await ReviewProject.create(documents,schema,{id,actor:'legacy-annotator'}),data=clone(project.current);data.draft.records=records;if(this.corpusIdentity!==id){this.corpusIdentity=id;this.corpusCreatedAt=data.createdAt;}data.createdAt=this.corpusCreatedAt;
        const capturedRuns=new Map(children.map(c=>[c.key,new Set(c.project.runs.map(r=>r.id))]));
        data.extensions.legacyWorkspace={version:1,dtd:workspace.dtd,anns:workspace.anns,annIndex:workspace.annIndex,mode:this.mode,thresholdOverride:this.thresholdOverride,thresholdSelectionKey:modelSelectionKey(this.modelSelection),scope:clone(this.scope),children,runs:[...this.runs].map(([key,run])=>[key,{...run,project:undefined}]),exposed:[...this.exposed],exposure:clone(this.exposure),blinded:[...this.blinded],blindSnapshots:[...this.blindSnapshots],batchQueue:checkpointBatchQueue(this.batchQueue,(key,id)=>capturedRuns.get(key)?.has(id))};
        // JSON transport excludes file handles/functions; public model bytes stay in ModelStore.
        return (await ReviewProject.open(jsonParse(JSON.stringify(data)))).current;
    }
    async restoreCorpus(project){
        const saved=project.extensions.legacyWorkspace;invariant(saved?.version===1,'Unsupported legacy corpus recovery');
        const scope=saved.scope?await importScope(saved.scope):null;
        const children=new Map();for(const child of saved.children??[])children.set(child.key,await ReviewProject.open(child.project));
        const view=legacy();invariant(view,'Original annotation workspace unavailable');
        view.app.set_vpp_data_json({dtd:clone(saved.dtd),anns:clone(saved.anns),ann_idx:saved.annIndex,mn4anns:1});
        this.corpusIdentity=project.id;this.corpusCreatedAt=project.createdAt;this.projects=children;this.runHistory=[...children.values()].flatMap(child=>child.current.runs);this.runs=new Map((saved.runs??[]).map(([key,run])=>[key,{...run,project:children.get(key)}]));this.mode=saved.mode??'auto';this.thresholdOverride=restoreSelectionThresholdOverride(this.modelSelectionState,saved.thresholdSelectionKey,saved.thresholdOverride);if(saved.thresholdSelectionKey===modelSelectionKey(this.modelSelection))saveModelSelectionState(this.modelSelectionState);this.scope=scope;this.scopeDraft=scope?clone(scope):presetScope();this.scopeEditing=false;this.exposed=new Set(saved.exposed??[]);this.exposure=clone(saved.exposure??[]);this.blinded=new Set(saved.blinded??[]);this.blindSnapshots=new Map(saved.blindSnapshots??[]);this.batchQueue=restoreBatchQueue(checkpointBatchQueue(saved.batchQueue,(key,id)=>children.get(key)?.current.runs.some(r=>r.id===id)));this.selected.clear();this.apply=null;this.render();
    }
    async freezeNote(view){
        invariant(!this.exposed.has(view.key),'This note was already exposed');
        const project=await this.ensureProject(view.ann), data=clone(project.current);data.draft.records=legacyRecords(view.ann,data.documents[0],data.schema);this.projects.set(view.key,await ReviewProject.open(data));await this.projects.get(view.key).snapshot();
        this.blindSnapshots.set(view.key,freeze(clone({filename:view.ann._filename,text:view.ann.text,tags:view.ann.tags,frozenAt:new Date().toISOString()})));
        this.message='Independent annotation frozen in the portable evidence project. Analyze and reveal when ready.';
    }
    async analyzeDocuments(anns, {batch=false,resume=false,retryFailed=false}={}) {
        const managed=batch&&!!this.collection;
        if(managed)await this.saveCollectionCurrent();
        const annKey=a=>a._diskKey??documentKey(a._filename??'document',a.text);
        if(resume){
            invariant(this.batchQueue,'No batch to resume');
            const eligible=this.batchQueue.notes.filter(n=>retryFailed?n.status==='failed':['pending','cancelled'].includes(n.status));
            const available=new Map(anns.map(a=>[annKey(a),a]));
            for(const note of eligible)if(!available.has(note.key)){note.status='failed';note.error='Source note was removed or changed; start a new batch for its current version.';}
            anns=eligible.filter(n=>available.has(n.key)).map(n=>available.get(n.key));
        }
        invariant(!this.selectionDraft&&this.selectionDraftMode===modelSelectionControlValue(this.modelSelection),'Apply the pending model source before analysis.');
        // Original-screen notes stay editable while the worker runs. Retain the
        // submitted text/filename and schema instead of rereading mutable Vue data.
        const model=this.model,sourceAnns=[...anns],sourceDtd=legacy().data.dtd;
        anns=managed?anns.map(ann=>({...ann})):anns.map(ann=>({_filename:ann._filename,text:ann.text,tags:clone(ann.tags??[])}));
        if (!model)
            throw new Error('Import a GLiNER2.5 boundary model package in this panel');
        invariant(modelSelectionMatchesManifest(this.modelSelection,this.model.manifest),'The active package does not match the selected model source. Load a matching package before analysis.');
        if (!anns.length)
            throw new Error(resume?'No matching unfinished notes remain. Changed or removed notes need a new batch.':'Open a document first');
        const nativeSchema=legacySchema(legacy().data.dtd),scope=this.scope?clone(this.scope):null;
        const activeVariant=selectInferenceVariant(model,qualifyForSchema(model,nativeSchema).level),activeCodec=activeVariant.codec;
        invariant(activeCodec!==ENTITY_ATTRIBUTES_CODEC||!scope,'Clear the clinical suggestion scope before using a fixed entity-contract model. Its complete native prompt must be retained.');
        const schema=activeCodec===ENTITY_ATTRIBUTES_CODEC?entityContractSchema(nativeSchema,model.entityContracts.get(activeVariant.id)):scope?compileScope(scope,nativeSchema,activeCodec):activeCodec===CLINICAL_V3_CODEC?clinicalV3Schema(nativeSchema):nativeSchema;
        if(managed)invariant(this.mode!=='blind','For blind review, open and freeze each collection note and analyze it individually.');
        if(this.mode==='blind')for(const ann of anns)invariant(this.blindSnapshots.has(documentKey(ann._filename??'document',ann.text)),'Freeze each independent annotation before analysis');
        const autoApply = this.mode === 'auto';
        if (autoApply) for (const ann of anns) {
            const key = annKey(ann);
            invariant(!this.blinded.has(key) || this.exposed.has(key), 'Reveal each protected note explicitly before auto apply');
        }
        const qualification = qualifyForSchema(model, schema);
        if (qualification.level !== 'entity-span' && qualification.level !== 'structured-span' && qualification.level !== 'occurrence-record')
            throw new Error('This package’s codec is not a local GLiNER2.5 decoder');
        const variant = selectInferenceVariant(model,qualification.level);
        invariant(variant.precision!=='int8'||!autoApply,'Experimental INT8 requires suggestion review. Select Assist mode or use FP32 for auto apply.');
        const codec = variant.codec;
        const thresholdSettings=suggestionThreshold(this.thresholdOverride,scope,variant);
        if(scope)this.checkScopeBudget(schema,variant);
        const notice = isRecordsCodec(codec) ? recordsNotice(codec) : codec === GLINER_STRUCTURED ? STRUCTURED_NOTICE : SPAN_NOTICE;
        let executionModel=model;
        const executionOptions={onConformance:summary=>this.rememberGPUCheck(summary),onInitialization:stage=>{this.loadingProgress={phase:stage.phase,detail:stage.detail,started:performance.now()};renderLoadingProgress(this.root,this.loadingProgress);},maxThreads:batch&&this.batchCpu==='low'?1:batch&&this.batchCpu==='balanced'?4:defaultCpuThreads(),backend:this.executionPreference??'auto',resolveFallback:(target,context)=>loadWasmFallback(this,target,context),onBackend:({backend,precision,packageData,fallbackReason,fallbackDetail})=>{executionModel=packageData;this.model=packageData;this.executionStatus={backend,precision,fallbackReason,fallbackDetail};this.message=fallbackReason?'WebGPU unavailable or interrupted. Continuing locally with FP32 WASM.':`Preparing ${backend==='webgpu'?'WebGPU':'WASM'} ${precision.toUpperCase()} inference on this device.`;this.render();}};
        // Validate and analyze in the same session, including CPU-only packages.
        const prompt = (codec === GLINER_STRUCTURED || isRecordsCodec(codec))
            ? schemaPrompt(schema)
            : { ...schemaEntityLabels(schema), contentCount: undefined, groups: undefined };
        const requests = {length:anns.length,at:async index => {
            if(managed){const item=anns[index];const active=this.current().ann;const loaded=active?._diskKey===item._diskKey?active:await this.hydrateCollectionNote(item);sourceAnns[index]=loaded;anns[index]={...loaded,tags:clone(loaded.tags??[]),sourceHash:item.sourceHash};}
            const ann=anns[index];
            const doc = { id: ann._filename ?? `document-${index + 1}`, text: ann.text };
            const key = documentKey(ann._filename ?? 'document', doc.text ?? '');
            if (this.mode === 'blind')
                this.blinded.add(key);
            return { text: doc.text, labels: prompt.labels, contentCount: prompt.contentCount, groups: prompt.groups, schema, threshold: thresholdSettings.threshold, longContext:this.longContext!==false };
        }};
        const runSettings={codec,...(codec===ENTITY_ATTRIBUTES_CODEC?{overlapPolicy:model.entityContracts.get(variant.id).overlapPolicy,maxEncodedTokens:variant.maxSequenceLength,...(this.longContext===false?{contextPolicy:'reject',wordOverlap:0}:LONG_CONTEXT_SETTINGS)}:{}),...((codec===CLINICAL_V3_CODEC||codec===ENTITY_ATTRIBUTES_CODEC)?{inferenceSchema:clone(schema),inferenceSchemaHash:await fingerprint(schema)}:{}),...thresholdSettings,...(scope?{scope:await scopeIdentity(scope,schema)}:{}),limitations:isRecordsCodec(codec)?[...(codec===CLINICAL_V3_CODEC?['family-choice-spans-unqualified','literal-spans-unqualified','record-binding-unsupported']:[]),'cross-window-relations','anchorless-records',...(Object.keys(schema.relations??{}).length?['automatic-relations-unqualified']:[])]:[]};
        const context=await fingerprint({manifestHash:model.manifestHash,variantId:variant.id,schema:nativeSchema,settings:runSettings,mode:this.mode});
        let queueRows=[];
        if(batch){
            if(resume){
                const eligible=new Map(queueWork(this.batchQueue,context,{retryFailed}).map(n=>[n.key,n]));
                queueRows=anns.map(ann=>eligible.get(annKey(ann)));
                for(const [i,row]of queueRows.entries())invariant(row&&row.sourceHash===(managed?anns[i].sourceHash:await sha256(anns[i].text)),'Queued source changed; start a new batch.');
            }else{
                const notes=[];for(const ann of anns)notes.push({key:annKey(ann),filename:ann._filename??'document',sourceHash:managed?ann.sourceHash:await sha256(ann.text)});
                this.batchQueue=createBatchQueue(context,notes);queueRows=this.batchQueue.notes;
                this.batchQueue.model={packageId:model.manifest.id,manifestHash:model.manifestHash,variantId:variant.id};
                this.batchQueue.settings={schemaHash:await fingerprint(nativeSchema),mode:this.mode,...thresholdSettings};
            }
            this.batchQueue.state='running';if(managed){this.collection.queue=this.batchQueue;await this.collectionStore.commit(this.collection);}
        }
        const completed=new Set();let activeIndex=0,analysisStarted=null;
        const updateProgress=()=>{
            const counts=batch?queueCounts(this.batchQueue):{completed:completed.size,failed:0,total:anns.length};
            this.loadingProgress={phase:'Analyzing notes',completed:counts.completed+counts.failed,failed:counts.failed,total:counts.total,started:analysisStarted-(batch?this.batchQueue.elapsedMs:0)};
        };
        try{await this.modelRunner.analyzeBatch(model, variant.id, requests, { ...executionOptions, collectResults:false, qualify:true, onWindowProgress: progress=>{this.windowProgress=progress;this.message=`${this.progress?.filename??'Note'} · window ${Math.min(progress.completed+1,progress.total)} / ${progress.total}`;this.render();}, onProgress: index => {
            analysisStarted??=performance.now();
            if(batch){const row=queueRows[index];row.status='running';row.attempts++;row.startedAt=new Date().toISOString();delete row.error;}
            updateProgress();
            activeIndex=index;this.windowProgress=null;
            const ann = anns[index];
            this.progress = { index: index + 1, total: anns.length, filename: ann._filename ?? 'document' };
            this.message = `Analyzing ${index + 1} of ${anns.length} on this device.`;
            this.render();
        }, onResult: (result, index) => this.withCorpusCommit(async()=>{
            const ann = anns[index];
            const doc = { id: ann._filename ?? `document-${index + 1}`, text: ann.text };
            if (result.kind !== codec)
                throw new Error('Worker did not return GLiNER span output');
            const provenance = modelRunProvenance(executionModel, result.variantId, result);
            const records = result.records ?? spansToRecords(doc, schema, result.spans);
            const key = documentKey(ann._filename ?? 'document', doc.text ?? '');
            const project=await this.ensureProject(ann,nativeSchema),nativeDoc=project.current.documents[0];
            const nativeRecords=records.map(r=>({...r,documentId:nativeDoc.id}));
            const nativeRun=await makeRun(project,nativeDoc,nativeRecords,{...provenance,status:result.status,coverage:result.coverage,windows:result.windows??[],settings:runSettings});await project.addRun(nativeRun);const storedRun=project.current.runs.at(-1);this.runHistory.push(storedRun);
            // Project now owns the annotation snapshot; release this queue copy.
            ann.tags=[];
            this.runs.set(key, { nativeRunId:nativeRun.id, project, key, filename: ann._filename, records:storedRun.records, notice:result.notice??notice, ...provenance, status: result.status, backend: result.backend, precision: result.precision, decisions: {} });
            if (autoApply && result.status==='complete' && legacy().data.dtd===sourceDtd && (managed||legacy().data.anns.includes(sourceAnns[index])) && sourceAnns[index].text===ann.text && sourceAnns[index]._filename===ann._filename) await this.applyAllSuggestions(sourceAnns[index]);
            completed.add(index);
            if(batch){Object.assign(queueRows[index],{status:result.status==='complete'?'completed':'failed',runId:nativeRun.id,suggestions:records.length,backend:result.backend,precision:result.precision,wasmThreads:result.wasmThreads,finishedAt:new Date().toISOString()});if(result.status!=='complete')queueRows[index].error=result.reason??'Input is unsupported by this model';}
            if(managed){await this.saveCollectionNote(sourceAnns[index]);const item=this.collection.notes.find(n=>n._diskKey===key);anns[index]=item;sourceAnns[index]=item;this.evictCollectionNotes();}
            updateProgress();renderLoadingProgress(this.root,this.loadingProgress);
            if(batch&&completed.size%10===0&&this.recoverySession.enabled)this.recoverySession.touch();
        }) });}catch(error){if(batch&&!completed.has(activeIndex)){const row=queueRows[activeIndex];row.status=/Cancelled|AbortError/.test(error.message+' '+error.name)?'cancelled':'failed';row.error=row.status==='cancelled'?'Stopped by user':'Local inference failed; retry this note';row.finishedAt=new Date().toISOString();}if(!completed.has(activeIndex)&&typeof anns[activeIndex]?.text==='string'){const project=await this.ensureProject(anns[activeIndex],nativeSchema),doc=project.current.documents[0],identity=modelRunProvenance(model,variant.id,{manifestHash:model.manifestHash,variantId:variant.id,kind:codec,backend:variant.backend,precision:variant.precision,...(variant.backend==='webgpu'?{executionPolicy:EXECUTION_POLICY,graphTransforms:graphTransforms(model.manifest,variant,'webgpu')}:{})});const failed=await makeRun(project,doc,[],{...identity,status:/Cancelled/.test(error.message)?'cancelled':'failed',coverage:[],settings:runSettings,failures:[{category:/Cancelled/.test(error.message)?'cancelled':'local-runtime-failure'}]});await project.addRun(failed);this.runHistory.push(failed);}throw error;}
        finally{if(batch){if(analysisStarted!==null)this.batchQueue.elapsedMs+=performance.now()-analysisStarted;const counts=queueCounts(this.batchQueue);this.batchQueue.state=counts.pending+counts.cancelled?'paused':counts.failed?'needs-attention':'completed';if(managed){this.collection.queue=this.batchQueue;await this.collectionStore.commit(this.collection);this.evictCollectionNotes();}if(this.recoverySession.enabled)this.recoverySession.touch();}}
        const hidden = this.mode === 'blind';
        this.message = hidden
            ? 'Local analysis finished. Suggestions stay hidden in blind mode until you reveal them.'
            : autoApply ? `Auto apply finished for ${anns.length} notes. Machine-applied tags are unreviewed; original predictions remain in the evidence project.` : `${batch?`Batch: ${queueCounts(this.batchQueue).completed} completed, ${queueCounts(this.batchQueue).failed} failed. Open each note to review its results. `:''}${notice}`;
    }
    chosenDocuments(onlySelected) {
        const view = legacy();
        const anns = this.allDocuments();
        if (!onlySelected)
            return view?.ann ? [view.ann] : [];
        return anns.filter(ann => ann && this.selected.has(ann._diskKey??documentKey(ann._filename ?? 'document', ann.text ?? '')));
    }
    forCurrentNote(key, action) {
        return (...args) => {
            if (this.current().key !== key) {
                this.apply = null;
                this.render();
                return;
            }
            return action(...args);
        };
    }
    recordExposure(view, run, kind) {
        this.exposed.add(view.key);
        const project=this.projects.get(view.key);if(project&&project.current.mode==='blind'&&project.current.phase==='frozen'){project.reveal();}else if(project&&!project.current.exposure.length)project.expose(kind);
        if (run.exposedAt) return;
        run.exposedAt = new Date().toISOString();
        this.exposure.push({ key: view.key, at: run.exposedAt, kind,
            manifestHash: run.producer.manifestHash, variantId: run.runtime.variantId });
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
    async applyAllSuggestions(ann = this.current().ann) {
        const view = legacy(), dtd = view?.data?.dtd;
        invariant(ann && (view.data.anns.includes(ann)||this.collection&&ann._diskKey), 'Open a document first');
        const key = documentKey(ann._filename ?? 'document', ann.text), run = this.runs.get(key);
        invariant(this.mode !== 'blind' && (!this.blinded.has(key) || this.exposed.has(key)), 'Reveal this protected note explicitly before auto apply');
        invariant(run?.status === 'complete', 'Auto apply requires a complete run');
        invariant(run.precision!=='int8','Experimental INT8 requires individual suggestion review');
        const pending = run.records.filter(record => !run.decisions[record.id]);
        if (!pending.length) { this.message = 'No remaining suggestions to apply. Existing and rejected tags were preserved.'; return; }
        const project = await this.syncProject(ann);
        invariant(project === run.project && legacy().data.dtd === dtd && project.current.documents[0].text === ann.text, 'Source or schema changed; analyze this note again');
        invariant(this.mode !== 'blind' && (!this.blinded.has(key) || this.exposed.has(key)), 'Reveal this protected note explicitly before auto apply');
        // Build and validate the complete batch before touching the native tags.
        // Staging also makes native IDs unique within a family.
        const staged = {...ann, tags:[...ann.tags]}, additions = [], replacements = [];
        for (const record of pending) {
            const tagDef = dtd.tag_dict[record.family];
            invariant(tagDef && !tagDef.is_non_consuming && record.anchor.length, 'Auto apply requires an exact span-family schema mapping');
            invariant(!record.relations?.length, 'Automatic relation application is not supported');
            const values = {};
            for (const attr of editableAttrs(tagDef)) {
                const value = record.fields[attr.name];
                invariant(value == null || typeof value === 'string', 'Review non-text attributes individually');
                invariant(value == null || attr.vtype !== 'list' || attr.values.includes(value), 'Model attribute is outside the native schema');
                values[attr.name] = value ?? ''; // Unknown predictions do not acquire schema defaults.
            }
            const tag = view.app.make_etag({spans:medtatorSpans(ann.text,record.anchor),text:record.anchor.map(s=>s.text).join(' ... ')},tagDef,staged);
            Object.assign(tag, values); staged.tags.push(tag); additions.push({record,tag});
            const native = legacyRecords({text:ann.text,tags:[tag]},project.current.documents[0],project.current.schema)[0];
            replacements.push({...clone(record),documentId:native.documentId,fields:native.fields,origin:{legacyTagId:tag.id}});
        }
        const candidate = new ReviewProject(project.current);
        candidate.applyMachineGroup(run.nativeRunId, replacements);
        // Commit native tags and their evidence lineage together. No await can
        // interleave source navigation or human editing in this section.
        ann.tags.push(...additions.map(({tag})=>tag));
        const undoDecisions=Object.fromEntries(additions.map(({record})=>[record.id,run.decisions[record.id]??null]));
        run.project = candidate; this.projects.set(key,candidate);
        for (const {record,tag} of additions) run.decisions[record.id] = {status:'applied',tagId:tag.id,reviewStatus:'unreviewed'};
        this.rememberReviewUndo(run,undoDecisions,additions.map(({tag})=>tag));
        this.recordExposure({ann,key},run,'auto-apply');
        ann._has_saved = false; view.vpp.refresh_v_anns();
        if(!this.collection||legacy().ann===ann)for (const {tag} of additions) view.app.update_hint_dict_by_tag(ann,tag);
        if (legacy().ann === ann) {
            view.data.display_tag_name = '__all__'; view.app.cm_update_marks?.();
            view.vpp.set_ann_unsaved(ann);
        }
        view.vpp.$forceUpdate(); this.apply = null; this.detail = null;
        this.message = `Auto-applied ${additions.length} suggestions as native annotation tags. Machine-applied tags are unreviewed; existing tags and original predictions were preserved.`;
    }
    rememberReviewUndo(run,decisions,added=[]){
        this.reviewUndo??=[];
        const event=[...run.project.current.events].reverse().find(e=>e.details?.undo||e.details?.before);
        this.reviewUndo.push({key:run.key,runId:run.nativeRunId,eventId:event?.id,decisions:clone(decisions),added:clone(added)});if(this.reviewUndo.length>20)this.reviewUndo.shift();
    }
    refreshNativeHints(){
        const view=legacy();view.vpp.hint_dict={};for(const ann of view.data.anns)view.app.update_hint_dict_by_ann(ann);view.app.cm_update_marks?.();
    }
    undoReview(){
        const view=this.current(),run=view.run,entry=this.reviewUndo?.at(-1);
        invariant(entry&&entry.key===view.key&&entry.runId===run?.nativeRunId,'Open the note and run for the last review action');
        const undone=new Set(run.project.current.events.filter(e=>e.action==='undo').map(e=>e.details.undoes));
        const event=[...run.project.current.events].reverse().find(e=>!undone.has(e.id)&&(e.details?.undo||e.details?.before));
        invariant(event?.id===entry.eventId,'Another annotation change follows this action; review it before undoing');
        const tags=validateUndoTags(view.ann.tags,entry.added);
        run.project.undo();view.ann.tags=tags;
        for(const [id,decision]of Object.entries(entry.decisions)){if(decision)run.decisions[id]=decision;else delete run.decisions[id];}
        this.reviewUndo.pop();view.vpp.set_ann_unsaved(view.ann);view.vpp.refresh_v_anns();this.refreshNativeHints();view.vpp.$forceUpdate();this.apply=null;this.message='Last assistance action undone. Original model predictions are retained.';
    }
    rejectSuggestion(view,run,record){
        const before={[record.id]:run.decisions[record.id]??null};
        run.project.review(run.nativeRunId,record.id,'rejected');run.decisions[record.id]={status:'rejected'};this.rememberReviewUndo(run,before);
        this.apply=null;this.message='Suggestion rejected. Original annotation tags stay as they were.';
    }
    reviewShortcut(event){
        if(!event.altKey||event.ctrlKey||event.metaKey||this.busy)return;
        const view=this.current(),run=view.run;if(!run||this.mode==='blind'||this.blinded.has(view.key)&&!this.exposed.has(view.key))return;
        const key=event.key.toLowerCase();if(!['j','k','a','r','u','enter'].includes(key))return;
        const target=event.composedPath()[0];if(['INPUT','SELECT','TEXTAREA'].includes(target?.tagName)&&key!=='enter')return;
        event.preventDefault();
        const records=suggestionPage(run.records,run.decisions,{...this.reviewFilter,page:this.reviewPage??0}).records;
        let at=records.findIndex(r=>r.id===this.reviewFocus);if(at<0)at=0;
        if(key==='j'||key==='k'){at=Math.max(0,Math.min(records.length-1,at+(key==='j'?1:-1)));const record=records[at];if(record){this.reviewFocus=record.id;this.detail=record.id;this.locate(record);this.render();this.root.querySelector('[data-testid=assist-review-controls]')?.focus();}return;}
        if(key==='u'){this.perform(()=>this.undoReview());return;}
        if(key==='enter'){this.root.querySelector('[data-testid=assist-add]')?.click();return;}
        const record=records[at];if(!record||run.decisions[record.id])return;
        this.reviewFocus=record.id;this.detail=record.id;
        if(key==='a'){this.apply={id:record.id,tag:preferredTag(record.family,view.data.dtd.etags)};this.render();this.root.querySelector('[data-testid=assist-add]')?.focus();}
        else this.perform(()=>this.rejectSuggestion(view,run,record));
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
        const scrollTop=this.root.querySelector('.body')?.scrollTop??0;
        // Entering blind mode protects each source even after the selector changes.
        if (this.mode === 'blind')
            for (const ann of legacy()?.data?.anns ?? [])
                this.blinded.add(documentKey(ann._filename ?? 'document', ann.text ?? ''));
        this.signature = this.viewSignature();
        this.host.dataset.open = String(this.open);
        this.root.replaceChildren(node('style', themeColors(styles)));
        if (!this.open) {
            this.root.append(button('Show assistance', () => this.setOpen(true), { id: 'assist-expand', title: 'Show the local assistance panel' }));
            this.root.lastChild.className = 'rail';
            return;
        }
        const dock = node('div', null, { class: 'dock' });
        this.root.append(dock);
        const head = node('div', null, { class: 'head' });
        const title = node('div', null, { class: 'row' });
        title.append(icon('assist'),node('strong', 'Assistance'), node('span', null, { class: 'grow' }), button('Hide', () => this.setOpen(false), { id: 'assist-collapse', title: 'Collapse the assistance panel' }));
        const mode = node('select', null, { 'aria-label': 'Workspace mode', 'data-testid': 'assist-mode', disabled:this.busy });
        for (const [value, label] of [['assisted', 'Assisted'], ['auto', 'Auto apply'], ['blind', 'Blind']])
            mode.append(node('option', label, { value }));
        mode.value = this.mode;
        mode.addEventListener('change', () => { this.mode = mode.value; this.apply = null; this.render(); });
        const view = this.current();
        const schema = view?.data?.dtd?.name;
        const status = node('div', null, { class: 'row' });
        status.append(node('span', this.structured() ? 'Structured package' : this.model ? 'Span package' : 'Model needed', { class: `badge ${this.model?'ready':'pending'}`, 'data-testid': 'model-status' }), node('span', 'Runs on this device', { class: 'badge' }));
        head.append(title);
        if(this.model)head.append(node('p',modelSelectionLabel(this.modelSelection),{class:'muted','data-testid':'assist-model-identity',title:this.model.manifest.id}));
        if(this.model)head.append(node('p',this.executionStatus?`${this.executionStatus.backend==='webgpu'?'WebGPU':'WASM'} · ${this.executionStatus.precision?.toUpperCase()??'FP32'}${this.executionStatus.fallbackReason?' · automatic fallback':''}`:`${this.model.manifest.variants[0].precision.toUpperCase()} package · ${this.model.manifest.id}`,{class:'muted','data-testid':'assist-execution-status'}));


        if (view?.run && this.mode !== 'blind' && (!this.blinded.has(view.key) || this.exposed.has(view.key)))
            head.append(node('p', `${view.run.records.length} machine suggestions · ${view.ann.tags?.length ?? 0} annotation tags`, { 'data-testid': 'assist-counts' }));
        dock.append(head);
        if(this.model&&this.modelStorageNotice)head.append(node('p',this.modelStorageNotice,{class:'muted',role:'status','data-testid':'assist-storage-notice'}));
        if(this.executionStatus?.fallbackDetail){const details=disclosure(this,'execution-details','Why CPU was used');details.append(node('p',this.executionStatus.fallbackDetail,{class:'muted',style:'overflow-wrap:anywhere'}));head.append(details);}
        if (this.message)
            dock.append(node('div', this.message, { class: `message${this.error ? ' error' : ''}`, role: this.error ? 'alert' : 'status', 'data-testid': 'assist-message' }));
        renderLoadingProgress(this.root,this.busy?this.loadingProgress:null);
        if(this.busy&&this.windowProgress?.total>1){const progress=node('progress',null,{max:this.windowProgress.total,value:this.windowProgress.completed,'aria-label':'Note window progress'});progress.style.width='100%';dock.append(progress);}
        const body = node('div', null, { class: 'body' });
        dock.append(body);
        const practice=disclosure(this,'practice','Try a fictional note',!view?.ann);
        practice.append(node('p','Load a note, matching schema and model selection. Your choice starts no download.',{class:'muted'}));
        const practiceActions=node('div',null,{class:'row'});
        for(const task of PRACTICE_TASKS)practiceActions.append(button(task.title,()=>this.perform(()=>this.loadPracticeTask(task)),{id:'assist-practice-'+task.id,disabled:this.busy||!view?.vpp}));
        practice.append(practiceActions,node('a','Step-by-step tutorials',{href:'https://github.com/sidataplus/NextMedTator/tree/main/tutorial',target:'_blank',rel:'noopener noreferrer'}));
        if(!view?.ann)body.append(practice);
        const collections=disclosure(this,'collections','Large collections · local disk');
        collections.append(node('p','Store up to 10,000 UTF-8 text notes on this device. Only the open note and the note being analyzed enter the editor / memory. Annotations and history are checkpointed per note. Browser storage is not a portable backup.',{class:'muted'}));
        const collectionFiles=node('input',null,{type:'file',multiple:true,accept:'.txt','aria-label':'Store text files as a local collection','data-testid':'assist-collection-import',disabled:this.busy||!view?.data.dtd});collectionFiles.addEventListener('change',()=>{const files=[...collectionFiles.files];if(files.length)this.perform(()=>this.importCollection(files));});collections.append(labeled('Store text files on this device',collectionFiles),button('List collections',()=>this.perform(async()=>{this.savedCollections=await this.collectionStore.list();}),{disabled:this.busy,id:'assist-collection-list'}));
        for(const saved of this.savedCollections??[])collections.append(button(`Open collection: ${saved.name} (${saved.count} notes)`,()=>this.perform(()=>this.openCollection(saved.id)),{disabled:this.busy,id:'assist-collection-restore'}));
        if(this.collection){collections.append(node('p',`${this.collection.notes.length} notes stored · ${this.projects.size} note histories loaded`,{'data-testid':'assist-collection-memory'}),button('Save open note',()=>this.perform(()=>this.saveCollectionCurrent()),{disabled:this.busy,id:'assist-collection-save'}),button('Close collection',()=>this.perform(()=>this.closeCollection()),{disabled:this.busy,id:'assist-collection-close'}));}
        const backup=node('input',null,{type:'file',accept:'.jsonl','aria-label':'Restore collection backup','data-testid':'assist-collection-backup-import',disabled:this.busy});backup.addEventListener('change',()=>{const file=backup.files[0];if(file)this.perform(async()=>{const meta=await importCollectionBackup(this.collectionStore,file,{keyFor:documentKey});await this.openCollection(meta.id);});});collections.append(labeled('Restore portable collection backup',backup));
        if(this.collection){
            collections.append(button('Export collection backup',()=>this.exportCollectionBackup(),{disabled:this.busy,id:'assist-collection-export'}));
            if(typeof window.showSaveFilePicker==='function')collections.append(button('Use browser download instead',()=>this.exportCollectionBackup({browserDownload:true}),{disabled:this.busy,id:'assist-collection-browser-export'}));
            collections.append(node('p',typeof window.showSaveFilePicker==='function'?'Streaming export writes directly to disk. Browser download is also available for backups up to 64 MiB.':'This browser uses a standard download for backups up to 64 MiB. No file-system permission is needed.',{class:'muted'}));
        }
        body.append(collections);
        const modelSettings=node('section',null,{class:'section','aria-label':'Model source','data-testid':'assist-step-model'});body.append(modelSettings);
        modelSettings.append(renderModelSelectionControls({selection:this.modelSelection,draftMode:this.selectionDraftMode,draft:this.selectionDraft,activeModel:this.model,onSelect:selection=>this.setSelectedModel(selection),onDraftMode:mode=>{this.beginModelSelectionAction();this.selectionDraftMode=mode;this.selectionDraft=null;this.render();},onDraftChange:draft=>{this.beginModelSelectionAction();this.selectionDraft=draft;for(const button of this.root.querySelectorAll('[data-testid=analyze],#analyze,#assist-analyze,#assist-analyze-selected'))button.disabled=true;},onUseHub:selection=>this.perform(async()=>{this.setSelectedModel({kind:'hub-adapter',...selection},{render:false});this.message=`Selected ${modelSelectionLabel(this.modelSelection)}. Export the pinned adapter locally, then import its verified ONNX package.`;}),onUseLocal:(files,base)=>this.perform(async()=>{const selection=await localAdapterSelection(files,base);this.setSelectedModel(selection,{render:false});this.message=`Selected local adapter ${selection.adapterSha256.slice(0,12)}. Export it locally, then import its verified ONNX package.`;}),prefix:'assist-model',disabled:this.busy,compact:true}));
        const actions = node('div', null, { class: 'row' });
        const sourcePending=!!this.selectionDraft||this.selectionDraftMode!==modelSelectionControlValue(this.modelSelection);
        actions.append(button('Analyze note', () => this.perform(() => this.analyzeDocuments(this.chosenDocuments(false))), { primary: true, disabled: this.busy || !this.model || !view?.ann || sourcePending, id: 'assist-analyze', title: 'Analyze the open note on this device' }));
        actions.append(button('Analyze selected', () => this.perform(() => this.analyzeDocuments(this.chosenDocuments(true),{batch:true})), { disabled: this.busy || !this.model || this.selected.size === 0 || sourcePending, id: 'assist-analyze-selected', title: 'Analyze the notes checked in this panel' }));
        actions.append(button('Pause', () => {this.installController?.abort();this.modelRunner.cancel();}, { disabled: !this.busy, id: 'assist-pause', title: 'Stop the local analysis or model download' }));
        const options=disclosure(this,'options','Analysis settings',this.scopeEditing);body.append(options);
        options.append(thresholdControl({override:this.thresholdOverride,scope:this.scope,variant:activeVariantForSchema(this.model,view?.data?.dtd?legacySchema(view.data.dtd):null),disabled:this.busy,id:'assist-threshold',onChange:(value,render)=>{this.thresholdOverride=setSelectionThresholdOverride(this.modelSelectionState,value);saveModelSelectionState(this.modelSelectionState);if(render){if(this.recoverySession.enabled)this.recoverySession.touch();this.render();}}}));
        const actionBar=node('div',null,{class:'action-bar'});actionBar.append(actions,node('p',!schema?'Load a schema, then open a note.':!view?.ann?'Open a note to begin.':!this.model?'Load the model in step 3 to continue.':this.mode==='auto'?'Predictions are added as unreviewed tags.':this.mode==='blind'?'Freeze your annotation before revealing predictions.':'Review suggestions before adding them to the note.'));const analysisStep=node('section',null,{class:'section','data-testid':'assist-step-analyze'});analysisStep.append(node('h3','4. Analyze and review'),labeled('Review mode',mode),actionBar);body.append(analysisStep);
        const longNotes=node('input',null,{type:'checkbox','aria-label':'Analyze long notes with overlapping windows','data-testid':'assist-long-context',disabled:this.busy});longNotes.checked=this.longContext!==false;longNotes.addEventListener('change',()=>{this.longContext=longNotes.checked;});options.append(labeled('Analyze long notes with GLiNER2.5 windows',longNotes),node('p','Keeps the full prompt, maps spans back to the original note, and merges overlap duplicates. Attributes use window-local context. Turning this off rejects oversized notes.',{class:'muted'}));
        options.append(renderScopeEditor(this));
        const storage=disclosure(this,'recovery','Local recovery & backups');
        const recovery=node('div',null,{class:'row'});recovery.append(node('p',this.recoverySession.status,{class:'muted',role:'status','data-testid':'assist-recovery-status'}));
        if(!this.recoverySession.enabled)recovery.append(button('Enable local corpus recovery',()=>this.perform(async()=>{if(!confirm('Store this corpus, annotations and prediction history in this browser profile? Export files for a portable backup.'))return;await this.recoverySession.enable();}),{disabled:!view?.ann||!!this.collection,id:'assist-recovery-enable'}));
        else recovery.append(button('Save corpus checkpoint',()=>this.perform(()=>this.recoverySession.save()),{id:'assist-checkpoint'}),button('Disable recovery',()=>this.perform(()=>this.recoverySession.disable())),button('Delete corpus recovery',()=>this.perform(async()=>{if(confirm('Delete this corpus recovery copy? Current in-memory annotations remain.'))await this.recoverySession.forget();})),button('Export SQLite corpus backup',()=>this.perform(async()=>localDownload(await this.recoverySession.exportDatabase(),'corpus.nmt.sqlite3','application/vnd.sqlite3'))));
        recovery.append(button('List saved corpora',()=>this.perform(async()=>{this.savedCorpora=(await this.recoverySession.list()).filter(saved=>saved.corpus);})));for(const saved of this.savedCorpora??[])recovery.append(button('Restore corpus '+saved.id,()=>this.perform(async()=>{if(!confirm('Replace the current in-memory corpus with this recovery copy? Export unsaved files first.'))return;await this.recoverySession.recover(saved.id,saved.backend);})));storage.append(recovery);
        const packages=disclosure(this,'packages',this.model?'3. Model ready':'3. Load the model',!this.model);packages.append(status);
        const recommended=deviceRecommendation(this.deviceProfile,{execution:this.executionPreference});
        let modelDetailsDevice;const deviceCard=node('section',null,{class:'setup-hint','data-testid':'assist-device'});
        deviceCard.append(node('strong',recommended.title));
        if(this.deviceProfile){const details=disclosure(this,'device-details','Device details');details.append(node('p',`${this.deviceProfile.gpu?'WebGPU available':'CPU / WASM'} · ${this.deviceProfile.cores??'Unknown'} logical cores${this.deviceProfile.memory!==null?` · browser memory hint ${this.deviceProfile.memory} GiB`:''}. RAM and GPU memory are not measured.`,{class:'muted'}));details.append(node('p',recommended.reason,{class:'muted'}));modelDetailsDevice=details;}
        if(recommended.caution)deviceCard.append(node('p',recommended.caution));
        packages.append(deviceCard);

        const execution=node('select',null,{'aria-label':'Inference device','data-testid':'assist-execution',disabled:this.busy});
        for(const [value,label]of [['auto','Automatic · WebGPU with WASM fallback'],['wasm','CPU · WASM']])execution.append(node('option',label,{value}));
        execution.value=this.executionPreference??'auto';execution.addEventListener('change',()=>{this.executionPreference=execution.value;this.executionStatus=null;this.qualifiedManifest=null;this.render();});
        const modelDetails=disclosure(this,'package-details','Package details & limitations');
        modelDetails.append(node('p', this.structured()
            ? (this.model.manifest.variants.some(v=>isRecordsCodec(v.codec))?recordsNotice(this.model.manifest.variants.find(v=>isRecordsCodec(v.codec)).codec):'Enum attributes come from the local span-attribute head. Value, unit, and relations stay empty.')
            : 'Import a local package to fill spans. Contextual fields stay empty until the package includes the span-attribute head.', { class: 'muted' }));
        const file = node('input', null, { type: 'file', accept: '.zip', disabled:this.busy, 'aria-label': 'Import model package into the annotation assistance panel' });
        file.addEventListener('change', () => { const picked = file.files?.[0]; if (picked) this.perform(() => this.importPackage(picked)); });
        const localPackages=disclosure(this,'local-packages','Installed packages & local import');
        localPackages.append(labeled('Local model package', file),button('List installed models',()=>this.perform(()=>this.inspectStorage())));
        const precisionValue=this.downloadPrecision??recommended.precision??'fp32';
        const matchingInstalled=matchingInstalledModels(this.modelSelection,this.installedModels??[]);
        const installedCandidates=matchingInstalled.filter(item=>firstManifestPrecision(item.manifest)===precisionValue);
        const installed=installedCandidates.find(item=>!this.unavailableInstalledModels.has(item.manifestHash))??installedCandidates[0];
        const malformedInstalled=installedCandidates.length?null:matchingInstalled.find(item=>firstManifestPrecision(item.manifest)===null);
        const actionableInstalled=installed??malformedInstalled;
        if(!this.model&&['clinical-p10','bpsd-base'].includes(this.modelSelection.id)){
            const modelName=this.modelSelection.id==='clinical-p10'?'P10':'BPSD';
            const unavailableReason=actionableInstalled&&(this.unavailableInstalledModels.get(actionableInstalled.manifestHash)??(malformedInstalled?'corrupt':undefined));
            const loadLabel=unavailableReason==='corrupt'?`Repair download ${modelName} · ${precisionValue.toUpperCase()}`:
                unavailableReason==='missing'?`Download again ${modelName} · ${precisionValue.toUpperCase()}`:
                installed?`Load installed ${modelName}`:malformedInstalled?`Repair download ${modelName} · ${precisionValue.toUpperCase()}`:`Download ${modelName} · ${precisionValue.toUpperCase()}`;
            packages.append(button(loadLabel,()=>this.perform(()=>this.loadSelectedPackage()),{id:'assist-load-model',primary:true,disabled:this.busy||!this.deviceProfile}));
            const loadHint=unavailableReason==='corrupt'?`The installed ${modelName} ${precisionValue.toUpperCase()} failed local integrity checks. Repair downloads a replacement and verifies it before installation.`:
                unavailableReason==='missing'?`The installed ${modelName} ${precisionValue.toUpperCase()} is missing from local storage. Download it again to continue.`:
                installed?'Saved on this device. No download needed.':malformedInstalled?`The installed ${modelName} package metadata is incomplete. Repair downloads the matching catalog package and verifies it before installation.`:'Downloads only when you click. A short verification check may open in another tab.';
            packages.append(node('p',loadHint,{class:'muted'}));
        }
        const downloadOptions=disclosure(this,'download-options','Model options');
        const precision=node('select',null,{'aria-label':'Model precision to download','data-testid':'assist-precision',disabled:this.busy});
        for(const [value,label]of [['fp32','FP32 · CPU compatible'],['fp16','FP16 · smaller GPU download'],['int8','INT8 · experimental']])precision.append(node('option',label,{value}));
        precision.value=precisionValue;precision.addEventListener('change',()=>{this.downloadPrecision=precision.value;this.render();});
        downloadOptions.append(labeled('Download format',precision),labeled('Run on',execution));
        if(recommended.precision)downloadOptions.append(button('Use recommended '+recommended.precision.toUpperCase(),()=>{this.downloadPrecision=undefined;this.render();},{disabled:this.busy}));
        if(precisionValue==='fp16')packages.append(node('p','About 370 MiB. If GPU inference fails, Analyze may download the FP32 CPU fallback (about 725 MiB).',{class:'muted'}));
        if(precisionValue==='fp32')packages.append(node('p','About 725 MiB. Works with CPU inference.',{class:'muted'}));
        if(precisionValue==='int8')packages.append(node('p','Experimental: smaller download, but slower inference and changed results. Review every suggestion.',{class:'setup-hint','data-testid':'assist-int8-notice'}));
        packages.append(downloadOptions);
        for(const item of this.installedModels??[]){
            const matches=modelSelectionMatchesManifest(this.modelSelection,item.manifest);
            const unavailableReason=this.unavailableInstalledModels.get(item.manifestHash);
            const sizeLabel=Number.isSafeInteger(item.bytes)?`${item.bytes} bytes`:'size unavailable';
            localPackages.append(node('p',`${item.manifest.id} · ${sizeLabel} · ${matches?'matches selected source':'different source'}${unavailableReason==='corrupt'?' · failed local integrity checks':unavailableReason==='missing'?' · missing from local storage':''}`,{class:'muted'}));
            if(unavailableReason)localPackages.append(node('p','Use the main model action to download and verify a replacement. This cached entry has not been removed.',{class:'muted'}));
            else localPackages.append(button('Use installed '+item.manifest.id,()=>this.perform(async()=>{await this.useInstalledModel(item.manifestHash);if(this.model)this.message=`Installed package loaded and hashes verified for ${modelSelectionLabel(this.modelSelection)}.`;})));
        }
        downloadOptions.append(node('p',this.model?`Loaded model buffers: ${(this.model.manifest.files.reduce((n,f)=>n+f.bytes,0)/1048576).toFixed(0)} MiB. Runtime memory is additional.`:'No model weights loaded in memory.',{class:'muted','data-testid':'assist-model-memory'}));
        if(this.storageEstimate)downloadOptions.append(node('p',`Browser storage: ${(this.storageEstimate.usage/1048576).toFixed(0)} MiB used of approximately ${(this.storageEstimate.quota/1048576).toFixed(0)} MiB available quota.`,{class:'muted'}));
        for(const item of this.installedModels??[])localPackages.append(button('Remove installed '+item.manifest.id,()=>this.perform(async()=>{if(!confirm('Remove this cached model from this browser? You can download or import it again.'))return;if(this.model?.manifestHash===item.manifestHash)this.unloadModel();await this.modelStore.remove(item.manifestHash);await this.inspectStorage();}),{disabled:this.busy,id:'assist-remove-model'}));
        if(this.model&&supportsWebGPU(this.model.manifest,this.model.manifest.variants[0]))downloadOptions.append(button('Check GPU compatibility',()=>this.perform(()=>this.checkGPU()),{disabled:this.busy,id:'assist-check-gpu',title:'Run public reference examples on the loaded model. No CPU fallback download.'}));
        if(this.gpuCheck){
            downloadOptions.append(node('p',conformanceMessage(this.gpuCheck),{class:'muted','data-testid':'assist-gpu-check-result'}),
                button('Save GPU check report',()=>localDownload(new TextEncoder().encode(JSON.stringify(this.gpuCheck,null,2)+'\n'),'nextmedtator-gpu-check.json','application/json'),{id:'assist-save-gpu-check'}),
                node('p','Report includes public reference-check measurements, model identity and browser version. It excludes your notes and annotations.',{class:'muted'}));
        }
        if(this.model)downloadOptions.append(button('Unload model',()=>this.unloadModel(),{disabled:this.busy,id:'assist-unload-model'}));
        if(this.model)downloadOptions.append(button('Install package for offline use',()=>this.perform(async()=>{
            const installed=await this.modelStore.install(this.model);
            this.unavailableInstalledModels.delete(installed.manifestHash);
            this.adoptModel(installed);this.modelStorageNotice=null;await this.inspectStorage();this.message='Model package installed and read-back verified';
        })));
        const anns = this.allDocuments();
        if (anns.length) {
            const docs = disclosure(this,'batch',`Batch analysis · ${this.selected.size} selected`);docs.setAttribute('aria-label','Documents to analyze');
            docs.append(node('p', 'Check notes for Analyze selected. One note runs at a time; completed results stay available for review.', { class: 'muted' }));
            const cpu=node('select',null,{'aria-label':'Batch CPU usage','data-testid':'assist-batch-cpu',disabled:this.busy});
            for(const [value,label]of [['auto',`Automatic · ${defaultCpuThreads()} WASM threads (cores − 1)`],['low','Low CPU · 1 WASM thread'],['balanced','Balanced · up to 4 WASM threads']])cpu.append(node('option',label,{value}));
            cpu.value=this.batchCpu??'auto';cpu.addEventListener('change',()=>{this.batchCpu=cpu.value;});docs.append(labeled('CPU usage',cpu),node('p','Automatic prefers WebGPU, including Metal on supported Apple browsers. CPU fallback uses browser-reported logical cores minus one (minimum one); without cross-origin isolation it uses one thread. Low CPU and Balanced reduce CPU use. Models load only on request.',{class:'muted'}));
            const queuedByKey=new Map((this.batchQueue?.notes??[]).map(n=>[n.key,n]));
            const selections=node('div',null,{class:'row'});
            selections.append(button('Select all',()=>{for(const ann of anns)if(ann._diskKey||typeof ann?.text==='string')this.selected.add(ann._diskKey??documentKey(ann._filename??'document',ann.text));this.render();},{disabled:this.busy,id:'assist-select-all'}),button('Clear selection',()=>{this.selected.clear();this.render();},{disabled:this.busy,id:'assist-select-none'}));docs.append(selections);
            selections.append(button('Select unfinished',()=>{this.selected.clear();for(const ann of anns){const key=ann._diskKey??documentKey(ann._filename??'document',ann.text??'');if(queuedByKey.get(key)?.status!=='completed')this.selected.add(key);}this.render();},{disabled:this.busy,id:'assist-select-unfinished'}));
            if(this.batchQueue){
                const counts=queueCounts(this.batchQueue),controls=node('div',null,{class:'row'});
                docs.append(node('p',`${counts.completed} completed · ${counts.failed} failed · ${counts.pending+counts.cancelled} unfinished`,{'data-testid':'assist-batch-summary'}));
                const bar=node('progress',null,{max:counts.total,value:counts.completed+counts.failed,'aria-label':'Overall queue progress'});bar.style.width='100%';docs.append(bar);
                controls.append(button('Resume unfinished',()=>this.perform(()=>this.analyzeDocuments(this.allDocuments(),{batch:true,resume:true})),{disabled:this.busy||!this.model||counts.pending+counts.cancelled===0,id:'assist-batch-resume'}),button('Retry failed',()=>this.perform(()=>this.analyzeDocuments(this.allDocuments(),{batch:true,resume:true,retryFailed:true})),{disabled:this.busy||!this.model||counts.failed===0,id:'assist-batch-retry'}),button('Export completion report',()=>localDownload(new TextEncoder().encode(JSON.stringify(batchReport(this.batchQueue,{blind:this.mode==='blind'}),null,2)),`batch-${this.batchQueue.id}.json`,'application/json'),{disabled:this.busy,id:'assist-batch-report'}));
                docs.append(controls,node('p',this.collection?'Each completed note and queue status are saved together on this device. Resume skips finished notes and checks model, schema, threshold and review mode. Export a collection backup for portability.':'Resume skips finished notes and checks model, schema, threshold and review mode. Enable local corpus recovery to preserve the queue across reloads; checkpoints are requested every 10 processed notes and when stopping. The report contains filenames and statuses.',{class:'muted'}));
            }
            // Bound DOM size even when the corpus contains thousands of notes.
            const pages=Math.ceil(anns.length/50),page=Math.min(this.batchPage??0,pages-1);
            if(pages>1){const navigation=node('div',null,{class:'row'});navigation.append(button('Previous notes',()=>{this.batchPage=page-1;this.render();},{disabled:page===0}),node('span',`${page*50+1}–${Math.min((page+1)*50,anns.length)} of ${anns.length}`),button('Next notes',()=>{this.batchPage=page+1;this.render();},{disabled:page===pages-1}));docs.append(navigation);}
            for (const ann of anns.slice(page*50,(page+1)*50)) {
                if (!ann?._diskKey && !ann?.text && ann?.text !== '')
                    continue;
                const key = ann._diskKey??documentKey(ann._filename ?? 'document', ann.text ?? '');
                const input = node('input', null, { type: 'checkbox',disabled:this.busy,'aria-label':ann._filename??'document' });
                input.checked = this.selected.has(key);
                input.addEventListener('change', () => { if (input.checked) this.selected.add(key); else this.selected.delete(key); this.render(); });
                const row = node('label', null, { class: 'check' });
                const queued=queuedByKey.get(key);
                row.append(input, node('span', ann._filename ?? 'document'));
                if(this.collection)row.append(button('Open',()=>this.perform(()=>this.openCollectionNote(key)),{disabled:this.busy,title:'Load this note from disk',id:'assist-collection-open-note'}));
                if(queued)row.append(node('span',queued.status,{class:'badge','data-testid':'assist-note-status',title:queued.error??`${queued.attempts} attempts`}));
                docs.append(row);
            }
            docs.prepend(actions.querySelector('[data-testid=assist-analyze-selected]'));analysisStep.append(docs);
        }
        else
            body.append(node('p', 'Load a schema and a note with the usual Annotation controls. Assistance stays optional.', { class: 'muted' }));
        this.renderRun(analysisStep, view);
        localPackages.append(modelDetails);packages.append(localPackages);if(modelDetailsDevice)downloadOptions.append(modelDetailsDevice);
        const noteStep=node('section',null,{class:'section','data-testid':'assist-step-note'});noteStep.append(node('h3','1. Open a note'));
        if(view?.ann){noteStep.append(node('p',view.ann._filename??'document',{'data-testid':'assist-document'}));}
        else noteStep.append(node('p','Open your schema and notes from the toolbar, or try a fictional note below.',{class:'muted'}));
        if(!view?.ann)noteStep.append(practiceActions);
        if(this.busy)for(const control of packages.querySelectorAll('button,input,select'))control.disabled=true;
        const more=disclosure(this,'more','More tools');more.append(options,storage,collections,practice);
        noteStep.querySelector('h3').prepend(icon('practice'));
        modelSettings.querySelector('h3').prepend(icon('packages'));
        analysisStep.querySelector('h3').prepend(icon('play'));
        more.querySelector('summary').prepend(icon('options'));
        body.replaceChildren(noteStep,modelSettings,packages,analysisStep,more);
        actions.querySelector('[data-testid=assist-analyze-selected]')?.remove();
        for(const detail of head.querySelectorAll('[data-testid=assist-model-identity],[data-testid=assist-execution-status]'))downloadOptions.append(detail);
        if(this.busy)head.append(actions.querySelector('[data-testid=assist-pause]'));else actions.querySelector('[data-testid=assist-pause]')?.remove();
        more.append(button('Open evidence project', () => this.perform(async()=>this.openProject(await this.syncProject(view.ann))), { id: 'open-workspace', disabled:!view?.ann||this.busy, title: 'Open the portable evidence project for snapshots and comparison' }));
        body.scrollTop=scrollTop;
    }
    renderRun(body, view) {
        const run = view?.run;
        if(this.mode==='blind'&&!this.blindSnapshots.has(view.key)&&!this.exposed.has(view.key)){body.append(button('Freeze blind annotation',()=>this.perform(()=>this.freezeNote(view)),{id:'assist-freeze',disabled:this.busy}));}
        const project=this.projects.get(view.key);if(project)body.append(button('Export evidence project',()=>this.perform(async()=>localDownload(await exportBundle(await this.syncProject(view.ann)),`${project.current.id}.nmt.zip`))));
        if (!run) return;
        if (this.mode === 'blind' || (this.blinded.has(view.key) && !this.exposed.has(view.key))) {
            body.append(node('h2', 'Blind annotation'), node('p', 'Suggestions, scores, and counts stay hidden. Reveal is explicit and applies to this note.', { class: 'muted' }));
            if (!this.exposed.has(view.key)) {
                const frozen = this.blindSnapshots.has(view.key);
                body.append(button('Reveal suggestions', this.forCurrentNote(view.key, () => {
                    this.recordExposure(view, run, 'explicit-reveal');
                    run.revealedAt = new Date().toISOString();
                    this.mode = 'assisted';
                    this.message = 'Suggestions revealed for this note. Its frozen blind annotation is preserved in this session.';
                    this.render();
                }), { id: 'assist-reveal', disabled: !frozen || this.busy }));
            }
            else
                body.append(node('p', 'Machine assistance was already shown for this note. Its current annotation cannot be frozen as independent blind labels. Choose Assisted to show suggestions again.', { class: 'muted', 'data-testid': 'assist-exposure' }));
            return;
        }
        if (view.data.section === 'annotation' && !document.hidden && this.host.getClientRects().length)
            this.recordExposure(view, run, 'assisted-display');
        const unresolved = run.records.filter(record => !run.decisions[record.id]).length;
        const settings=run.project.current.runs.find(r=>r.id===run.nativeRunId)?.settings;
        if(settings?.threshold!=null)body.append(node('p',`Run threshold: ${settings.threshold}`,{class:'muted','data-testid':'assist-run-threshold'}));
        const runScope=settings?.scope;
        if(runScope)body.append(node('p',`Run scope: ${runScope.profile.semanticSchema.name} · ${runScope.profile.semanticSchema.version}`,{class:'muted','data-testid':'assist-run-scope'}));
        body.append(node('h2', 'Suggestions'), node('p', `${unresolved} suggestions unresolved · ${run.status} · ${run.backend} / ${run.precision}`, { class: 'muted', 'data-testid': 'assist-summary' }), node('p', 'Suggestions use the loaded annotation schema. Machine runs and review decisions are retained in the portable evidence project.', { class: 'muted' }), node('p', run.notice, { class: 'muted' }));
        const applied = Object.values(run.decisions).filter(d=>d.status==='applied').length;
        if (applied) body.append(node('p', `${applied} machine-applied tags · unreviewed`, {'data-testid':'assist-auto-status'}));
        body.append(button('Apply all suggestions', this.forCurrentNote(view.key, () => this.perform(() => this.applyAllSuggestions(view.ann))), {id:'assist-apply-all',disabled:this.busy||!unresolved||run.status!=='complete'||run.precision==='int8',title:'Add all remaining suggestions to this note without individual review; preserve existing and rejected tags'}));
        if (!run.records.length)
            body.append(node('p', run.status === 'complete' ? 'No suggestions in the completed run. Omission review is still required.' : 'Incomplete run. An empty result is not a negative label.', { class: 'muted' }));
        const display = node('select', null, { 'aria-label': 'Suggestion view', 'data-testid': 'assist-suggestion-view' });
        for (const [value, label] of [['cards', 'Detailed cards'], ['compact', 'Compact list']])
            display.append(node('option', label, { value }));
        display.value = this.suggestionView;
        display.addEventListener('change', () => { this.suggestionView = display.value; this.detail = null; this.apply = null; this.render(); });
        body.append(labeled('Suggestion view', display));
        const reviewControls=node('div',null,{class:'section',tabindex:0,'data-testid':'assist-review-controls','aria-label':'Suggestion review controls'});
        const filter=(name,values)=>{const select=node('select',null,{'aria-label':'Filter suggestions by '+name});for(const [value,label]of values)select.append(node('option',label,{value}));select.value=this.reviewFilter?.[name]??'all';select.addEventListener('change',()=>{this.reviewFilter={...this.reviewFilter,[name]:select.value};this.reviewPage=0;this.reviewFocus=null;this.render();});return labeled(name,select);};
        reviewControls.append(filter('family',[['all','All families'],...[...new Set(run.records.map(r=>r.family))].map(f=>[f,f])]),filter('status',[['all','All decisions'],['unreviewed','Unreviewed'],['accepted','Accepted'],['rejected','Rejected'],['applied','Machine-applied']]));
        const reviewPage=suggestionPage(run.records,run.decisions,{...this.reviewFilter,page:this.reviewPage??0});
        reviewControls.append(node('p',`${reviewPage.total} matching suggestions · page ${reviewPage.page+1} / ${reviewPage.pages}`,{'data-testid':'assist-review-page'}),button('Previous suggestions',()=>{this.reviewPage=reviewPage.page-1;this.render();},{disabled:reviewPage.page===0}),button('Next suggestions',()=>{this.reviewPage=reviewPage.page+1;this.render();},{disabled:reviewPage.page+1===reviewPage.pages}),button('Undo assistance action',()=>this.perform(()=>this.undoReview()),{disabled:this.busy||this.reviewUndo?.at(-1)?.key!==view.key,id:'assist-review-undo'}),node('p','Focus this panel: Alt+J/K next/previous, Alt+A review/add, Alt+Enter write, Alt+R reject, Alt+U undo. Twenty suggestions per page.',{class:'muted'}));body.append(reviewControls);
        const runReceipt=run.project.current.runs.find(r=>r.id===run.nativeRunId);
        if(runReceipt?.windows?.length>1)body.append(node('p',`Long note: ${runReceipt.windows.length} windows · ${run.status}. Attributes use local window context; cross-window mentions are not stitched.`,{'data-testid':'assist-window-coverage'}));
        if (this.suggestionView === 'compact') {
            const table = node('table', null, { class: 'compact', 'aria-label': 'Machine suggestions' });
            const caption = node('caption', `${run.records.length} original machine suggestions`);
            const rows = node('tbody');
            for (const record of reviewPage.records) {
                const row = node('tr', null, { 'data-testid': 'assist-compact-suggestion' });
                const cell = node('td');
                const anchor = record.anchor.map(span => span.text).join(' … ');
                const summary = [record.family.replaceAll('_occurrence', '').replaceAll('_', ' '), record.fields.assertion,
                    record.fields.time_frame, record.fields.experiencer, Number(record.score).toFixed(3)].filter(value => value != null).join(' · ');
                cell.append(node('strong', anchor, { title: anchor }), node('small', summary, { title: summary }));
                if(record.conceptId)cell.append(node('small',`Concept: ${record.conceptId}`));
                const decision = run.decisions[record.id];
                if (decision) cell.append(node('small', decision.status==='applied'?`Auto-applied ${decision.tagId} · unreviewed`:decision.status==='rejected'?'Rejected':`Added ${decision.tagId}`));
                const actions = node('td');
                actions.append(button('Locate', this.forCurrentNote(view.key, () => { try { this.locate(record); this.error = false; } catch (error) { this.error = true; this.message = error.message; this.render(); } }), { id: 'assist-compact-locate' }),
                    button('Review', this.forCurrentNote(view.key, () => { this.detail = record.id; this.apply = null; this.render(); this.root.querySelector('[data-testid="assist-suggestion"]')?.scrollIntoView({block:'nearest'}); }), { id: 'assist-details' }));
                row.append(cell, actions); rows.append(row);
            }
            table.append(caption, rows); body.append(table);
            const detail = run.records.find(record => record.id === this.detail);
            if (detail) body.append(this.card(view, run, detail));
        } else {
            for (const record of reviewPage.records) body.append(this.card(view, run, record));
        }
    }
    card(view, run, record) {
        const card = node('article', null, { class: 'card', tabindex:0, 'data-testid': 'assist-suggestion' });card.addEventListener('focusin',()=>{this.reviewFocus=record.id;});if(this.reviewFocus===record.id)card.style.borderColor='#087e8b';
        const decision = run.decisions[record.id];
        card.append(node('div', 'Machine suggestion', { class: 'tag' }), node('p', record.anchor.map(span => span.text).join(' … '), { class: 'anchor' }), node('p', `${record.family.replaceAll('_', ' ')} · score ${Number(record.score).toFixed(3)}`, { class: 'muted' }));
        if(record.conceptId)card.append(node('p',`Concept: ${record.conceptId}`,{class:'muted'}));
        for (const [name, value] of Object.entries(record.fields))
            card.append(node('p', `${name}: ${value == null ? 'Unknown' : value}`, { class: 'muted' }));
        if (decision)
            card.append(node('p', decision.status === 'rejected' ? 'Rejected. The annotation file was not changed.' : decision.status === 'applied' ? `Auto-applied as ${decision.tagId} · unreviewed. The suggestion stays here.` : `Added to the annotation as ${decision.tagId}. The suggestion stays here.`, { 'data-testid': 'assist-decision' }));
        const actions = node('div', null, { class: 'row' });
        actions.append(button('Locate', this.forCurrentNote(view.key, () => { try { this.locate(record); this.error = false; } catch (error) { this.error = true; this.message = error.message; this.render(); } }), { id: 'assist-locate' }));
        if (!decision) {
            actions.append(button('Add to annotation', this.forCurrentNote(view.key, () => { this.apply = { id: record.id, tag: preferredTag(record.family, view?.data?.dtd?.etags) }; this.render(); }), { id: 'assist-accept' }), button('Reject', this.forCurrentNote(view.key, () => { this.perform(()=>this.rejectSuggestion(view,run,record)); }), { id: 'assist-reject' }));
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
            const field=labeled(attr.name,input);input.addEventListener('input',()=>{field.style.background=input.value!==(draft.values[attr.name]??'')?'#fff3cd':'';field.title=input.value!==(draft.values[attr.name]??'')?'Changed from model suggestion':'';});form.append(field);
        }
        form.append(node('p', 'Link attributes stay empty. Confirming writes a new annotation tag and leaves this suggestion unchanged.', { class: 'muted' }));
        form.append(button('Write annotation', this.forCurrentNote(view.key, () => {
            const values = {};
            for (const [name, input] of inputs)
                values[name] = input.value;
            this.perform(() => {
                const before={[record.id]:run.decisions[record.id]??null};
                const tagId = this.writeAnnotation(record, picker.value, values);
                run.decisions[record.id] = { status: 'accepted', tagId };
                const copy={...clone(record),documentId:run.project.current.documents[0].id};for(const [name,value] of Object.entries(values))if(run.project.current.schema.families[copy.family].fields[name])copy.fields[name]=value;
                run.project.review(run.nativeRunId,record.id,'modified',copy);this.rememberReviewUndo(run,before,[view.ann.tags.find(t=>t.id===tagId)]);
                this.apply = null;
                this.message = `Added ${tagId} to the open annotation. The machine suggestion remains in this panel.`;
            });
        }), { primary: true, id: 'assist-add' }));
        picker.addEventListener('change', () => { this.apply = { id: record.id, tag: picker.value }; this.render(); });
        return form;
    }
}
function labeled(text, input) {
    const label = node('label');
    label.append(node('span', text), input);
    return label;
}
