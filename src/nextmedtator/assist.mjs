import {LegacyRecoverySession} from './backend/legacy-session.mjs';
import {ModelStore} from './model-store.mjs';
import {ReviewProject,makeRun} from './project.mjs';
import {exportBundle,localDownload} from './bundle.mjs';
import {SMALL_CODEC,SMALL_NOTICE,validateSmallSchema} from './gliner-small.mjs';
import { DEMO_SCHEMA } from './contracts.mjs';
import { importModelPackage, ConformanceWorker, qualifyForSchema, modelRunProvenance, CODECS, MODEL_LIMITS } from './model-package.mjs';
import { schemaEntityLabels, schemaPrompt, spansToRecords, SPAN_NOTICE, STRUCTURED_NOTICE, GLINER_CODEC, GLINER_STRUCTURED } from './gliner.mjs';
import { clone, freeze, sourceDocument, uuid, OffsetMap, fingerprint, invariant, jsonParse, sha256 } from './integrity.mjs';

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

export function legacySchema(dtd) {
    const families={};
    for(const tag of dtd?.etags??[])families[tag.name]={label:tag.name,...(tag.is_non_consuming?{documentLevel:true}:{}),fields:{concept:{type:'text'},...Object.fromEntries(editableAttrs(tag).map(attr=>[attr.name,{type:attr.vtype==='list'?'enum':'text',...(attr.vtype==='list'?{values:attr.values}:{})}]))}};
    invariant(Object.keys(families).length,'Load a span annotation schema');
    const relations={};for(const tag of dtd?.rtags??[]){const refs=(tag.attrs??[]).filter(a=>a.vtype==='idref');if(refs.length===2)relations[tag.name]={head:Object.keys(families),tail:Object.keys(families),legacy:{head:refs[0].name,tail:refs[1].name}};}return {id:'medtator-schema',version:'1',families,...(Object.keys(relations).length?{relations}:{})};
}
export function legacyRecords(ann,doc,schema){
 const map=new OffsetMap(doc.text),records=(ann.tags??[]).filter(t=>t.spans&&schema.families[t.tag]).map(t=>({id:t.id,documentId:doc.id,family:t.tag,anchor:schema.families[t.tag].documentLevel?[]:t.spans.split(',').map(range=>{const [a,b]=range.split('~').map(Number);return map.selection(a,b);}),fields:Object.fromEntries(Object.entries(schema.families[t.tag].fields).map(([name])=>[name,name==='concept'?t.text:t[name]??null])),origin:{kind:'imported',source:'medtator-working-copy',reviewStatus:'unknown'}}));
 for(const tag of ann.tags??[]){const rel=schema.relations?.[tag.tag];if(!rel)continue;const head=records.find(r=>r.id===tag[rel.legacy.head]),tail=records.find(r=>r.id===tag[rel.legacy.tail]);invariant(head&&tail,'Legacy relation endpoint is missing');head.relations??=[];head.relations.push({type:tag.tag,targetId:tail.id});}return records;
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
        this.modelRunner = new ConformanceWorker();this.modelStore=new ModelStore();
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
        this.render();
        this.timer = setInterval(() => this.sync(), 500);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) this.sync(); });
        window.addEventListener('beforeunload',event=>{const session=this.recoverySession;if(session.enabled&&(session.pending||session.revision!==session.savedRevision)){event.preventDefault();event.returnValue='';}});
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
        if(!this.unwatch&&legacy()?.vpp?.$watch)this.unwatch=legacy().vpp.$watch(()=>({dtd:legacy().data.dtd,anns:legacy().data.anns}),()=>this.recoverySession.touch(),{deep:true});
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
            section: view?.data?.section,
            visible: !document.hidden && this.host.getClientRects().length > 0,
            mode: this.mode,
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
            selected: [...this.selected],
            exposed: [...this.exposed],
            frozen: this.blindSnapshots.has(view?.key),
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
            if(this.recoverySession.enabled)this.recoverySession.touch();
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
        return !!this.model?.manifest.variants.some(variant => variant.codec === GLINER_STRUCTURED || variant.codec===SMALL_CODEC);
    }
    async importPackage(file) {
        if (file.size > MODEL_LIMITS.archive)
            throw new Error('Model archive exceeds 1 GiB');
        const candidate = await importModelPackage(new Uint8Array(await file.arrayBuffer()));
        this.model = candidate;
        const structured = candidate.manifest.variants.some(variant => variant.codec === GLINER_STRUCTURED || variant.codec===SMALL_CODEC);
        const qualified = candidate.manifest.variants.some(variant => CODECS[variant.codec].clinicalInference);
        this.message = structured
            ? 'GLiNER2.5 structured package loaded in memory. Analyze fills spans and enum attributes on this device.'
            : qualified
                ? 'GLiNER2.5 span package loaded in memory. Analyze fills spans and scores on this device.'
                : 'Package hashes validated. This package can run tensor fixtures only.';
    }
    async ensureProject(ann,schema=legacySchema(legacy().data.dtd)) {
        const key=documentKey(ann._filename??'document',ann.text??''),hash=await fingerprint(schema);
        let project=this.projects.get(key);
        if(!project||project.current.schemaHash!==hash){const doc=await sourceDocument('legacy-note',new TextEncoder().encode(ann.text),{provenance:{kind:'medtator-working-copy',filename:ann._filename}});project=await ReviewProject.create([doc],schema,{mode:this.mode,actor:'legacy-annotator'});const data=clone(project.current);data.draft.records=legacyRecords(ann,doc,schema);if(this.exposed.has(key))data.exposure=clone(this.exposure.filter(e=>e.key===key));project=await ReviewProject.open(data);this.projects.set(key,project);}
        return project;
    }
    async syncProject(ann,schema=legacySchema(legacy().data.dtd)){
        const project=await this.ensureProject(ann,schema),records=legacyRecords(ann,project.current.documents[0],project.current.schema),key=documentKey(ann._filename??'document',ann.text),viewRun=this.runs.get(key);
        const mapping=new Map(Object.entries(viewRun?.decisions??{}).filter(([,d])=>d.tagId).map(([predictionId,d])=>[d.tagId,project.current.draft.decisions[`${viewRun.nativeRunId}/${predictionId}`]?.humanId]));
        for(const record of records)if(mapping.get(record.id)){const original=project.current.draft.records.find(r=>r.id===mapping.get(record.id));const legacyId=record.id;record.id=mapping.get(legacyId);record.origin={...original?.origin,legacyTagId:legacyId};}
        for(const record of records)for(const rel of record.relations??[])if(mapping.get(rel.targetId))rel.targetId=mapping.get(rel.targetId);
        if(project.current.phase!=='frozen'&&JSON.stringify(records)!==JSON.stringify(project.current.draft.records)){
            if(project.current.draft.records.length)project.transformRecords(project.current.draft.records.map(r=>r.id),records,'legacy-working-copy-sync','Explicit native export of the current legacy annotation');
            else for(const record of records)project.record(record);
        }
        return project;
    }
    async captureCorpus(id=uuid()){
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
        data.extensions.legacyWorkspace={version:1,dtd:workspace.dtd,anns:workspace.anns,annIndex:workspace.annIndex,mode:this.mode,children,runs:[...this.runs].map(([key,run])=>[key,{...run,project:undefined}]),exposed:[...this.exposed],exposure:clone(this.exposure),blinded:[...this.blinded],blindSnapshots:[...this.blindSnapshots]};
        // JSON transport excludes file handles/functions; public model bytes stay in ModelStore.
        return (await ReviewProject.open(jsonParse(JSON.stringify(data)))).current;
    }
    async restoreCorpus(project){
        const saved=project.extensions.legacyWorkspace;invariant(saved?.version===1,'Unsupported legacy corpus recovery');
        const children=new Map();for(const child of saved.children??[])children.set(child.key,await ReviewProject.open(child.project));
        const view=legacy();invariant(view,'Original annotation workspace unavailable');
        view.app.set_vpp_data_json({dtd:clone(saved.dtd),anns:clone(saved.anns),ann_idx:saved.annIndex,mn4anns:1});
        this.corpusIdentity=project.id;this.corpusCreatedAt=project.createdAt;this.projects=children;this.runHistory=[...children.values()].flatMap(child=>child.current.runs);this.runs=new Map((saved.runs??[]).map(([key,run])=>[key,{...run,project:children.get(key)}]));this.mode=saved.mode??'assisted';this.exposed=new Set(saved.exposed??[]);this.exposure=clone(saved.exposure??[]);this.blinded=new Set(saved.blinded??[]);this.blindSnapshots=new Map(saved.blindSnapshots??[]);this.selected.clear();this.apply=null;this.render();
    }
    async freezeNote(view){
        invariant(!this.exposed.has(view.key),'This note was already exposed');
        const project=await this.ensureProject(view.ann), data=clone(project.current);data.draft.records=legacyRecords(view.ann,data.documents[0],data.schema);this.projects.set(view.key,await ReviewProject.open(data));await this.projects.get(view.key).snapshot();
        this.blindSnapshots.set(view.key,freeze(clone({filename:view.ann._filename,text:view.ann.text,tags:view.ann.tags,frozenAt:new Date().toISOString()})));
        this.message='Independent annotation frozen in the portable evidence project. Analyze and reveal when ready.';
    }
    async analyzeDocuments(anns) {
        if (!this.model)
            throw new Error('Import a GLiNER2.5 boundary model package in this panel');
        if (!anns.length)
            throw new Error('Open a document first');
        const schema=legacySchema(legacy().data.dtd);
        if(this.mode==='blind')for(const ann of anns)invariant(this.blindSnapshots.has(documentKey(ann._filename??'document',ann.text)),'Freeze each independent annotation before analysis');
        const qualification = qualifyForSchema(this.model, schema);
        if (qualification.level !== 'entity-span' && qualification.level !== 'structured-span' && qualification.level !== 'occurrence-record')
            throw new Error('This package’s codec is not a local GLiNER2.5 decoder');
        const codec = qualification.level === 'occurrence-record' ? SMALL_CODEC : qualification.level === 'structured-span' ? GLINER_STRUCTURED : GLINER_CODEC;
        const notice = codec === SMALL_CODEC ? SMALL_NOTICE : codec === GLINER_STRUCTURED ? STRUCTURED_NOTICE : SPAN_NOTICE;
        const variants = this.model.manifest.variants.filter(variant => variant.codec === codec);
        const variant = variants.find(item => item.backend === 'wasm') ?? variants.find(item => item.backend === 'webgpu' && navigator.gpu);
        if (!variant)
            throw new Error('No browser GLiNER2.5 variant is available in the imported package');
        if(this.qualifiedManifest!==this.model.manifestHash||this.qualifiedVariant!==variant.id){const report=await this.modelRunner.run(this.model,variant.id);invariant(report.pass,'Selected model failed its public conformance fixtures');this.qualifiedManifest=this.model.manifestHash;this.qualifiedVariant=variant.id;}
        const prompt = (codec === GLINER_STRUCTURED || codec===SMALL_CODEC)
            ? schemaPrompt(schema)
            : { ...schemaEntityLabels(schema), contentCount: undefined, groups: undefined };
        const requests = anns.map((ann, index) => {
            const doc = { id: ann._filename ?? `document-${index + 1}`, text: ann.text };
            const key = documentKey(ann._filename ?? 'document', doc.text ?? '');
            if (this.mode === 'blind')
                this.blinded.add(key);
            return { text: doc.text, labels: prompt.labels, contentCount: prompt.contentCount, groups: prompt.groups, schema, threshold: variant.threshold };
        });
        const runSettings={codec,threshold:variant.threshold??.5,limitations:codec===SMALL_CODEC?['cross-window-relations','anchorless-records',...(Object.keys(schema.relations??{}).length?['automatic-relations-unqualified']:[])]:[]};
        const completed=new Set();let activeIndex=0;
        try{await this.modelRunner.analyzeBatch(this.model, variant.id, requests, { onProgress: index => {
            activeIndex=index;
            const ann = anns[index];
            this.progress = { index: index + 1, total: anns.length, filename: ann._filename ?? 'document' };
            this.message = `Analyzing ${index + 1} of ${anns.length} on this device.`;
            this.render();
        }, onResult: async (result, index) => {
            const ann = anns[index];
            const doc = { id: ann._filename ?? `document-${index + 1}`, text: requests[index].text };
            if (result.kind !== codec)
                throw new Error('Worker did not return GLiNER span output');
            const provenance = modelRunProvenance(this.model, variant.id, result);
            const records = result.records ?? spansToRecords(doc, schema, result.spans);
            const key = documentKey(ann._filename ?? 'document', doc.text ?? '');
            const project=await this.ensureProject(ann),nativeDoc=project.current.documents[0];
            const nativeRecords=records.map(r=>({...r,documentId:nativeDoc.id}));
            const nativeRun=await makeRun(project,nativeDoc,nativeRecords,{...provenance,status:result.status,coverage:result.coverage,windows:result.windows??[],settings:runSettings});await project.addRun(nativeRun);this.runHistory.push(nativeRun);
            completed.add(index);this.runs.set(key, { nativeRunId:nativeRun.id, project, key, filename: ann._filename, records, notice, ...provenance, status: result.status, backend: result.backend, precision: result.precision, decisions: {} });
        } });}catch(error){if(!completed.has(activeIndex)){const project=await this.ensureProject(anns[activeIndex]),doc=project.current.documents[0],identity=modelRunProvenance(this.model,variant.id,{manifestHash:this.model.manifestHash,variantId:variant.id,kind:codec,backend:variant.backend,precision:variant.precision});const failed=await makeRun(project,doc,[],{...identity,status:/Cancelled/.test(error.message)?'cancelled':'failed',coverage:[],settings:runSettings,failures:[{category:/Cancelled/.test(error.message)?'cancelled':'local-runtime-failure'}]});await project.addRun(failed);this.runHistory.push(failed);}throw error;}
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
        // Entering blind mode protects each source even after the selector changes.
        if (this.mode === 'blind')
            for (const ann of legacy()?.data?.anns ?? [])
                this.blinded.add(documentKey(ann._filename ?? 'document', ann.text ?? ''));
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
        if (view?.ann)
            head.append(node('p', view.ann._filename ?? 'document', { class: 'muted', 'data-testid': 'assist-document' }));
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
        const recovery=node('div',null,{class:'row'});recovery.append(node('p',this.recoverySession.status,{class:'muted',role:'status','data-testid':'assist-recovery-status'}));
        if(!this.recoverySession.enabled)recovery.append(button('Enable local corpus recovery',()=>this.perform(async()=>{if(!confirm('Store this corpus, annotations and prediction history in this browser profile? Export files for a portable backup.'))return;await this.recoverySession.enable();}),{disabled:!view?.ann,id:'assist-recovery-enable'}));
        else recovery.append(button('Save corpus checkpoint',()=>this.perform(()=>this.recoverySession.save()),{id:'assist-checkpoint'}),button('Disable recovery',()=>this.perform(()=>this.recoverySession.disable())),button('Delete corpus recovery',()=>this.perform(async()=>{if(confirm('Delete this corpus recovery copy? Current in-memory annotations remain.'))await this.recoverySession.forget();})),button('Export SQLite corpus backup',()=>this.perform(async()=>localDownload(await this.recoverySession.exportDatabase(),'corpus.nmt.sqlite3','application/vnd.sqlite3'))));
        recovery.append(button('List saved corpora',()=>this.perform(async()=>{this.savedCorpora=(await this.recoverySession.list()).filter(saved=>saved.corpus);})));for(const saved of this.savedCorpora??[])recovery.append(button('Restore corpus '+saved.id,()=>this.perform(async()=>{if(!confirm('Replace the current in-memory corpus with this recovery copy? Export unsaved files first.'))return;await this.recoverySession.recover(saved.id,saved.backend);})));body.append(recovery);
        body.append(node('p', this.structured()
            ? (this.model.manifest.variants.some(v=>v.codec===SMALL_CODEC)?SMALL_NOTICE:'Enum attributes come from the local span-attribute head. Value, unit, and relations stay empty.')
            : 'Import a local package to fill spans. Contextual fields stay empty until the package includes the span-attribute head.', { class: 'muted' }));
        const file = node('input', null, { type: 'file', accept: '.zip', 'aria-label': 'Import model package into the annotation assistance panel' });
        file.addEventListener('change', () => { const picked = file.files?.[0]; if (picked) this.perform(() => this.importPackage(picked)); });
        body.append(labeled('Local model package', file),button('List installed models',()=>this.perform(async()=>{this.installedModels=await this.modelStore.list();})));for(const item of this.installedModels??[])body.append(button('Use installed '+item.manifest.id,()=>this.perform(async()=>{const installed=await this.modelStore.read(item.manifestHash);invariant(installed,'Installed package missing');this.model=installed;this.message='Installed public package loaded and hashes verified';})));if(this.model)body.append(button('Install package for offline use',()=>this.perform(async()=>{this.model=await this.modelStore.install(this.model);this.message='Public model installed and read-back verified';})));
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
        body.append(button('Open evidence project', () => this.perform(async()=>this.openProject(await this.syncProject(view.ann))), { id: 'open-workspace', title: 'Open the portable evidence project for snapshots and comparison' }));
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
        body.append(node('h2', 'Suggestions'), node('p', `${unresolved} suggestions unresolved · ${run.status} · ${run.backend} / ${run.precision}`, { class: 'muted', 'data-testid': 'assist-summary' }), node('p', 'Suggestions use the loaded annotation schema. Machine runs and review decisions are retained in the portable evidence project.', { class: 'muted' }), node('p', run.notice, { class: 'muted' }));
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
        actions.append(button('Locate', this.forCurrentNote(view.key, () => { try { this.locate(record); this.error = false; } catch (error) { this.error = true; this.message = error.message; this.render(); } }), { id: 'assist-locate' }));
        if (!decision) {
            actions.append(button('Add to annotation', this.forCurrentNote(view.key, () => { this.apply = { id: record.id, tag: preferredTag(record.family, view?.data?.dtd?.etags) }; this.render(); }), { id: 'assist-accept' }), button('Reject', this.forCurrentNote(view.key, () => { run.decisions[record.id] = { status: 'rejected' }; run.project.review(run.nativeRunId,record.id,'rejected'); if (this.apply?.id === record.id) this.apply = null; this.message = 'Suggestion rejected. Original annotation tags stay as they were.'; this.render(); }), { id: 'assist-reject' }));
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
        form.append(button('Write annotation', this.forCurrentNote(view.key, () => {
            const values = {};
            for (const [name, input] of inputs)
                values[name] = input.value;
            this.perform(() => {
                const tagId = this.writeAnnotation(record, picker.value, values);
                run.decisions[record.id] = { status: 'accepted', tagId };
                const copy={...clone(record),documentId:run.project.current.documents[0].id};for(const [name,value] of Object.entries(values))if(run.project.current.schema.families[copy.family].fields[name])copy.fields[name]=value;
                run.project.review(run.nativeRunId,record.id,'modified',copy);
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
