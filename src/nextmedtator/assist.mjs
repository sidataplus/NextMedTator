import {themeColors} from './theme-colors.mjs';
import {ASSIST_STYLES} from './assist-styles.mjs';
import {conformanceMessage} from './conformance-report.mjs';
import {detectDevice,deviceRecommendation} from './device-profile.mjs';
import {suggestionPage,validateUndoTags} from './review-queue.mjs';
import {exportCollection,exportCollectionBlob} from './collection-backup.mjs';
import {CollectionStore} from './collection-store.mjs';
import {LONG_CONTEXT_SETTINGS} from './long-context.mjs';
import {defaultCpuThreads} from './inference-options.mjs';
import {CorpusCommitGate,createBatchQueue,restoreBatchQueue,checkpointBatchQueue,queueCounts,queueWork} from './batch-queue.mjs';
import {loadWasmFallback} from './model-fallback.mjs';
import {renderLoadingProgress} from './loading-progress.mjs';
import {ENTITY_ATTRIBUTES_CODEC,entityContractSchema} from './entity-contract.mjs';
import {suggestionThreshold} from './threshold.mjs';
import {CLINICAL_V3_CODEC,clinicalV3Schema} from './clinical-v3.mjs';
import {LegacyRecoverySession} from './backend/legacy-session.mjs';
import {presetScope, compileScope, freezeScope, importScope, scopeIdentity, nativeScopeDTD, sameScope} from './scope.mjs';
import {ModelIntegrityError,ModelStore,downloadCatalogPackage,cacheModelForSession} from './model-store.mjs';
import {createModelSelectionState,saveModelSelectionState,setModelSelection,selectionThresholdOverride,setSelectionThresholdOverride,restoreSelectionThresholdOverride,modelSelectionKey,modelSelectionControlValue,modelSelectionMatchesManifest,matchingInstalledModels,selectionFromManifest} from './model-selection.mjs';
import {ReviewProject,makeRun} from './project.mjs';
import {localDownload} from './bundle.mjs';
import {isRecordsCodec,recordsNotice,validateSmallSchema,smallPromptCost} from './gliner-small.mjs';
import { DEMO_SCHEMA } from './contracts.mjs';
import { importModelPackage, ConformanceWorker, qualifyForSchema, selectInferenceVariant, modelRunProvenance, CODECS, MODEL_LIMITS } from './model-package.mjs';
import {EXECUTION_POLICY,graphTransforms} from './execution-policy.mjs';
import { schemaEntityLabels, schemaPrompt, spansToRecords, SPAN_NOTICE, STRUCTURED_NOTICE, GLINER_CODEC, GLINER_STRUCTURED, GlinerTokenizer, planWindows } from './gliner.mjs';
import { clone, freeze, sourceDocument, uuid, fingerprint, invariant, jsonParse, sha256 } from './integrity.mjs';
import { node, button, icon, labeled, disclosure } from './assist-dom.mjs';
import { documentKey, medtatorSpans, preferredTag, editableAttrs, legacySchema, legacyRecords } from './assist-legacy.mjs';
import { firstManifestPrecision, renderModelSource, renderModelPanel } from './assist-model-panel.mjs';
import { renderBatch } from './assist-batch.mjs';
import { renderRun } from './assist-review.mjs';
import { practiceActions, renderMoreTools } from './assist-more-tools.mjs';

export { utf16Offset, medtatorSpans, documentKey, spanTags, preferredTag, attributeDraft, legacySchema, legacyRecords } from './assist-legacy.mjs';

export const DEFAULT_REVIEW_MODE = 'auto';
export const REVIEW_MODES = [['auto', 'Auto Apply'], ['assisted', 'Assisted'], ['blind', 'Blind']];
const REVIEW_MODE_DESCRIPTIONS = {
    auto: 'Adds model predictions as unreviewed tags.',
    assisted: 'Review each suggestion before adding it as a tag.',
    blind: 'Freeze your own annotation before revealing suggestions.',
};
export function reviewModeDescription(mode) {
    return REVIEW_MODE_DESCRIPTIONS[mode];
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
        this.mode = DEFAULT_REVIEW_MODE;
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
        this.loadingProgress={phase:'Working on this device',started:performance.now()};
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
            this.message = cancelled&&this.batchQueue?.state==='paused'?'Batch paused. Finished results are kept; click Resume to continue.':error?.message ?? 'The annotation was left unchanged.';
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
            await this.useInstalledModel(installed.manifestHash);this.message='Model ready. Click Analyze File in step 4.';return;
        }
        if(!this.catalog){const response=await fetch(new URL('../../models/catalog.json',import.meta.url),{credentials:'omit'});invariant(response.ok,'Model list could not load. Check your connection and retry.');this.catalog=await response.json();}
        invariant(epoch===this.modelSelectionEpoch&&selectionKey===modelSelectionKey(this.modelSelection),'Model selection changed while loading. Select the model again and retry.');
        const entry=this.catalog.entries.find(item=>modelSelectionMatchesManifest(selection,item.manifest)&&firstManifestPrecision(item.manifest)===precision);
        invariant(entry,'No public download matches this source. Choose P10 or BPSD, or import a local package.');
        const total=entry.manifest.files.reduce((n,f)=>n+f.bytes,0);
                this.installController=new AbortController();
                try{
                    this.loadingProgress={phase:'Downloading model',received:0,total:total,started:performance.now()};renderLoadingProgress(this.root,this.loadingProgress);const candidate=await downloadCatalogPackage(entry,{signal:this.installController.signal,onStage:stage=>{this.loadingProgress={...stage,started:performance.now()};renderLoadingProgress(this.root,this.loadingProgress);},onProgress:({received,total,file})=>{if(this.loadingProgress.phase!=='Downloading model')this.loadingProgress.started=performance.now();Object.assign(this.loadingProgress,{received,total,file,phase:received===total?'Verifying model':'Downloading model'});renderLoadingProgress(this.root,this.loadingProgress);}});
                    invariant(epoch===this.modelSelectionEpoch&&selectionKey===modelSelectionKey(this.modelSelection)&&modelSelectionMatchesManifest(selection,candidate.manifest),'Model selection changed during download');
                    this.loadingProgress.phase='Installing model';renderLoadingProgress(this.root,this.loadingProgress);const installed=await cacheModelForSession(this,candidate,{signal:this.installController.signal});
                    invariant(epoch===this.modelSelectionEpoch,'Model selection changed during installation');
                    if(!this.modelStorageNotice)this.unavailableInstalledModels.delete(installed.manifestHash);
                    this.adoptModel(installed);await this.inspectStorage();this.message='Model ready. Click Analyze File in step 4.';
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
                if(handle){await exportCollection(this.collectionStore,this.collection,await handle.createWritable(),options);this.message='Collection backup saved with an integrity check for each file.';}
                else{const blob=await exportCollectionBlob(this.collectionStore,this.collection,options);localDownload(blob,'collection.nmt.jsonl','application/x-ndjson');this.message='Collection backup is downloading. Keep the file somewhere safe; browser downloads are limited to 64 MiB.';}
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
        if(view.data.anns.length&&!confirm('Replace the current files with a sample? Save your current work first.'))return;
        const schema=window.dtd_parser.parse(task.dtd,'dtd');
        if(this.collection){await this.saveCollectionCurrent();this.collection=null;}
        await this.recoverySession.disable();
        this.runs.clear();this.projects.clear();this.runHistory=[];this.batchQueue=null;
        this.corpusIdentity=null;this.corpusCreatedAt=null;
        this.exposed.clear();this.exposure=[];this.blinded.clear();this.blindSnapshots.clear();this.selected.clear();
        this.apply=null;this.detail=null;this.scope=null;this.scopeEditing=false;this.mode=DEFAULT_REVIEW_MODE;
        view.data.anns=[];view.data.ann_idx=0;
        view.app.set_dtd(schema);view.data.dtd=schema;
        const ann=view.vpp.add_sample_txt_as_ann(task.text);
        ann._filename=task.id+'-practice.txt.xml';
        view.data.mn4anns=1;view.vpp.set_ann_idx(0);
        this.setSelectedModel({id:task.model},{render:false});
        this.message='Sample loaded. Next, load the model in step 3.';
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
        this.message='Model unloaded. Installed models and annotations are kept.';this.render();
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
        this.message='Checking the loaded model on this GPU with public examples. Nothing is downloaded.';
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
        view.vpp.$forceUpdate();this.message='Clinical annotation schema loaded. Apply scope, then analyze your files.';
    }
    allDocuments(){return this.collection?.notes??legacy()?.data?.anns??[];}
    async openCollection(id,{replaceConfirmed=false}={}){
        if(this.collection)await this.saveCollectionCurrent();
        else if(!replaceConfirmed&&legacy().data.anns.length&&!confirm('Open this stored collection? Save your current work first.'))return;
        await this.recoverySession.disable();
        const meta=await this.collectionStore.read(id);invariant(meta,'Collection no longer exists');
        this.collection=meta;this.batchQueue=restoreBatchQueue(meta.queue);this.mode=meta.settings?.mode??meta.queue?.settings?.mode??DEFAULT_REVIEW_MODE;this.longContext=meta.settings?.longContext??true;this.selected.clear();this.batchPage=0;
        this.projects.clear();this.runs.clear();this.runHistory=[];this.blindSnapshots.clear();this.blinded.clear();this.exposed.clear();this.exposure=[];this.reviewUndo=[];
        const view=legacy();view.data.anns=[];view.app.set_dtd(meta.dtd);view.data.dtd=meta.dtd;view.vpp.refresh_v_anns();
        this.message=`${meta.notes.length} files in this collection. Open a file or select files to analyze.`;
    }
    async importCollection(files){
        invariant(legacy()?.data.dtd,'Load an annotation schema first');
        if(this.collection)await this.saveCollectionCurrent();
        if(legacy().data.anns.length&&!this.collection&&!confirm('Store these files as a new collection on this device? Save your current work first.'))return;
        const meta=await this.collectionStore.create(legacy().data.dtd,files[0]?.name?'Collection · '+files[0].name:'Local collection');
        this.installController=new AbortController();const started=performance.now();
        try{await this.collectionStore.importFiles(meta,files,{keyFor:documentKey,signal:this.installController.signal,onProgress:progress=>{this.loadingProgress={phase:'Storing collection',...progress,started};renderLoadingProgress(this.root,this.loadingProgress);}});}
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
        const item=this.collection.notes.find(n=>n._diskKey===ann._diskKey);invariant(item&&documentKey(ann._filename,ann.text)===item._diskKey,'Collection source or file name changed. Export this file before reopening the collection.');
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
        invariant(!legacy().data.anns.some(a=>!a._diskKey),'Close the collection before opening other files; save those files first.');
        const item=this.collection.notes.find(n=>n._diskKey===key);invariant(item,'Collection file missing');
        const ann=await this.hydrateCollectionNote(item),view=legacy();
        view.data.anns=[];const active=view.vpp.add_sample_txt_as_ann(ann.text);Object.assign(active,ann);view.vpp.set_ann_idx(0);view.vpp.refresh_v_anns();
        this.apply=null;this.detail=null;this.evictCollectionNotes();this.refreshNativeHints();this.message='File loaded from the collection. Other files stay on disk.';
    }
    async closeCollection(){
        await this.saveCollectionCurrent();this.collection=null;this.batchQueue=null;this.selected.clear();this.projects.clear();this.runs.clear();this.runHistory=[];this.reviewUndo=[];legacy().data.anns=legacy().data.anns.filter(a=>!a._diskKey);legacy().vpp.refresh_v_anns();this.message='Collection closed. Its files stay available under List Collections.';
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
            invariant(!children.some(child=>child.key===documentKey(ann._filename??'document',ann.text)),'Duplicate files; rename them before enabling recovery');documents.push(doc);children.push({documentId:doc.id,key:documentKey(ann._filename??'document',ann.text),project:clone(project.current)});
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
        this.corpusIdentity=project.id;this.corpusCreatedAt=project.createdAt;this.projects=children;this.runHistory=[...children.values()].flatMap(child=>child.current.runs);this.runs=new Map((saved.runs??[]).map(([key,run])=>[key,{...run,project:children.get(key)}]));this.mode=saved.mode??DEFAULT_REVIEW_MODE;this.thresholdOverride=restoreSelectionThresholdOverride(this.modelSelectionState,saved.thresholdSelectionKey,saved.thresholdOverride);if(saved.thresholdSelectionKey===modelSelectionKey(this.modelSelection))saveModelSelectionState(this.modelSelectionState);this.scope=scope;this.scopeDraft=scope?clone(scope):presetScope();this.scopeEditing=false;this.exposed=new Set(saved.exposed??[]);this.exposure=clone(saved.exposure??[]);this.blinded=new Set(saved.blinded??[]);this.blindSnapshots=new Map(saved.blindSnapshots??[]);this.batchQueue=restoreBatchQueue(checkpointBatchQueue(saved.batchQueue,(key,id)=>children.get(key)?.current.runs.some(r=>r.id===id)));this.selected.clear();this.apply=null;this.render();
    }
    async freezeNote(view){
        invariant(!this.exposed.has(view.key),'Suggestions were already shown for this file');
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
            for(const note of eligible)if(!available.has(note.key)){note.status='failed';note.error='Source file was removed or changed; start a new batch for its current version.';}
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
            throw new Error(resume?'No matching unfinished files remain. Changed or removed files need a new batch.':'Open a file first');
        const nativeSchema=legacySchema(legacy().data.dtd),scope=this.scope?clone(this.scope):null;
        const activeVariant=selectInferenceVariant(model,qualifyForSchema(model,nativeSchema).level),activeCodec=activeVariant.codec;
        invariant(activeCodec!==ENTITY_ATTRIBUTES_CODEC||!scope,'Clear the clinical suggestion scope before using a fixed entity-contract model. Its complete native prompt must be retained.');
        const schema=activeCodec===ENTITY_ATTRIBUTES_CODEC?entityContractSchema(nativeSchema,model.entityContracts.get(activeVariant.id)):scope?compileScope(scope,nativeSchema,activeCodec):activeCodec===CLINICAL_V3_CODEC?clinicalV3Schema(nativeSchema):nativeSchema;
        if(managed)invariant(this.mode!=='blind','For blind review, open and freeze each collection file and analyze it individually.');
        if(this.mode==='blind')for(const ann of anns)invariant(this.blindSnapshots.has(documentKey(ann._filename??'document',ann.text)),'Freeze each independent annotation before analysis');
        const autoApply = this.mode === 'auto';
        if (autoApply) for (const ann of anns) {
            const key = annKey(ann);
            invariant(!this.blinded.has(key) || this.exposed.has(key), 'Reveal each blind file before Auto Apply');
        }
        const qualification = qualifyForSchema(model, schema);
        if (qualification.level !== 'entity-span' && qualification.level !== 'structured-span' && qualification.level !== 'occurrence-record')
            throw new Error('This package’s codec is not a local GLiNER2.5 decoder');
        const variant = selectInferenceVariant(model,qualification.level);
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
            this.loadingProgress={phase:'Analyzing files',completed:counts.completed+counts.failed,failed:counts.failed,total:counts.total,started:analysisStarted-(batch?this.batchQueue.elapsedMs:0)};
        };
        try{await this.modelRunner.analyzeBatch(model, variant.id, requests, { ...executionOptions, collectResults:false, qualify:true, onWindowProgress: progress=>{this.windowProgress=progress;this.message=`${this.progress?.filename??'File'} · window ${Math.min(progress.completed+1,progress.total)} / ${progress.total}`;this.render();}, onProgress: index => {
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
        }) });}catch(error){if(batch&&!completed.has(activeIndex)){const row=queueRows[activeIndex];row.status=/Cancelled|AbortError/.test(error.message+' '+error.name)?'cancelled':'failed';row.error=row.status==='cancelled'?'Stopped by user':'Local analysis failed; retry this file';row.finishedAt=new Date().toISOString();}if(!completed.has(activeIndex)&&typeof anns[activeIndex]?.text==='string'){const project=await this.ensureProject(anns[activeIndex],nativeSchema),doc=project.current.documents[0],identity=modelRunProvenance(model,variant.id,{manifestHash:model.manifestHash,variantId:variant.id,kind:codec,backend:variant.backend,precision:variant.precision,...(variant.backend==='webgpu'?{executionPolicy:EXECUTION_POLICY,graphTransforms:graphTransforms(model.manifest,variant,'webgpu')}:{})});const failed=await makeRun(project,doc,[],{...identity,status:/Cancelled/.test(error.message)?'cancelled':'failed',coverage:[],settings:runSettings,failures:[{category:/Cancelled/.test(error.message)?'cancelled':'local-runtime-failure'}]});await project.addRun(failed);this.runHistory.push(failed);}throw error;}
        finally{if(batch){if(analysisStarted!==null)this.batchQueue.elapsedMs+=performance.now()-analysisStarted;const counts=queueCounts(this.batchQueue);this.batchQueue.state=counts.pending+counts.cancelled?'paused':counts.failed?'needs-attention':'completed';if(managed){this.collection.queue=this.batchQueue;await this.collectionStore.commit(this.collection);this.evictCollectionNotes();}if(this.recoverySession.enabled)this.recoverySession.touch();}}
        const hidden = this.mode === 'blind';
        this.message = hidden
            ? 'Local analysis finished. Suggestions stay hidden in blind mode until you reveal them.'
            : autoApply ? `Auto Apply finished for ${anns.length} files. Added tags are unreviewed; original predictions stay in the evidence project.` : `${batch?`Batch: ${queueCounts(this.batchQueue).completed} completed, ${queueCounts(this.batchQueue).failed} failed. Open each file to review its results. `:''}${notice}`;
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
            throw new Error('Open a file first');
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
        invariant(ann && (view.data.anns.includes(ann)||this.collection&&ann._diskKey), 'Open a file first');
        const key = documentKey(ann._filename ?? 'document', ann.text), run = this.runs.get(key);
        invariant(this.mode !== 'blind' && (!this.blinded.has(key) || this.exposed.has(key)), 'Reveal this blind file before Auto Apply');
        invariant(run?.status === 'complete', 'Auto apply requires a complete run');
        const pending = run.records.filter(record => !run.decisions[record.id]);
        if (!pending.length) { this.message = 'No remaining suggestions to apply. Existing and rejected tags were preserved.'; return; }
        const project = await this.syncProject(ann);
        invariant(project === run.project && legacy().data.dtd === dtd && project.current.documents[0].text === ann.text, 'Source or schema changed; analyze this file again');
        invariant(this.mode !== 'blind' && (!this.blinded.has(key) || this.exposed.has(key)), 'Reveal this blind file before Auto Apply');
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
        this.message = `Auto-applied ${additions.length} suggestions as tags. They are unreviewed; existing tags and original predictions are kept.`;
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
        invariant(entry&&entry.key===view.key&&entry.runId===run?.nativeRunId,'Open the file for the last review action');
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
            throw new Error('Open the file in the editor first');
        const spans = medtatorSpans(ann.text, record.anchor);
        const range = view.app.cm_spans2range(spans.split(',')[0], ann);
        editor.focus();
        editor.setSelection(range.anchor, range.head);
        editor.scrollIntoView({ from: range.anchor, to: range.head }, 80);
    }
    render() {
        const scrollTop = this.root.querySelector('.body')?.scrollTop ?? 0;
        // Entering blind mode protects each source even after the selector changes.
        if (this.mode === 'blind')
            for (const ann of legacy()?.data?.anns ?? [])
                this.blinded.add(documentKey(ann._filename ?? 'document', ann.text ?? ''));
        this.signature = this.viewSignature();
        this.host.dataset.open = String(this.open);
        this.root.replaceChildren(node('style', themeColors(ASSIST_STYLES)));
        if (!this.open) {
            this.root.append(button('Assistance', () => this.setOpen(true), { id: 'assist-expand', title: 'Show the Assistance panel' }));
            this.root.lastChild.className = 'rail';
            return;
        }
        const view = this.current();
        const dock = node('div', null, { class: 'dock' });
        this.root.append(dock);
        const head = renderHead(this, view);
        dock.append(head);
        if (this.message)
            dock.append(node('div', this.message, { class: `message${this.error ? ' error' : ''}`, role: this.error ? 'alert' : 'status', 'data-testid': 'assist-message' }));
        renderLoadingProgress(this.root, this.busy ? this.loadingProgress : null);
        if (this.busy && this.windowProgress?.total > 1) {
            const progress = node('progress', null, { max: this.windowProgress.total, value: this.windowProgress.completed, 'aria-label': 'Window progress' });
            progress.className = 'full';
            dock.append(progress);
        }
        const body = node('div', null, { class: 'body' });
        dock.append(body);
        // Steps 1-4, then More Tools; the browser tests pin this order. renderRun
        // goes last because displaying suggestions records their exposure.
        const modelSource = renderModelSource(this);
        const analysis = renderAnalysisStep(this, view);
        const more = renderMoreTools(this, view);
        const packages = renderModelPanel(this);
        const anns = this.allDocuments();
        if (anns.length)
            analysis.step.append(renderBatch(this, anns, analysis.analyzeSelected));
        renderRun(this, analysis.step, view);
        body.append(renderNoteStep(this, view), modelSource, packages, analysis.step, more);
        // While working, Pause stays visible in the header instead of inside a scrolled step.
        if (this.busy)
            head.append(analysis.pause);
        body.scrollTop = scrollTop;
    }
}

function renderHead(assist, view) {
    const head = node('div', null, { class: 'head' });
    const title = node('div', null, { class: 'row' });
    title.append(icon('assist'), node('strong', 'Assistance'), node('span', null, { class: 'grow' }),
        button('Hide', () => assist.setOpen(false), { id: 'assist-collapse', title: 'Hide the Assistance panel' }));
    head.append(title);
    if (view?.run && assist.mode !== 'blind' && (!assist.blinded.has(view.key) || assist.exposed.has(view.key)))
        head.append(node('p', `${view.run.records.length} suggestions · ${view.ann.tags?.length ?? 0} tags`, { 'data-testid': 'assist-counts' }));
    if (assist.model && assist.modelStorageNotice)
        head.append(node('p', assist.modelStorageNotice, { class: 'muted', role: 'status', 'data-testid': 'assist-storage-notice' }));
    if (assist.executionStatus?.fallbackDetail) {
        const details = disclosure(assist, 'execution-details', 'Why was CPU used?');
        details.append(node('p', assist.executionStatus.fallbackDetail, { class: 'muted wrap' }));
        head.append(details);
    }
    return head;
}

function renderNoteStep(assist, view) {
    const step = node('section', null, { class: 'section', 'data-testid': 'assist-step-note' });
    const heading = node('h3', '1. Open a File');
    heading.prepend(icon('practice'));
    step.append(heading);
    if (view?.ann) {
        step.append(node('p', view.ann._filename ?? 'document', { 'data-testid': 'assist-document' }));
    }
    else {
        step.append(node('p', 'Load a schema and annotation files with the toolbar above, or try a sample:', { class: 'muted' }));
        step.append(practiceActions(assist, view));
    }
    return step;
}

/** Step 4 shell. Analyze Selected and Pause are returned for placement by render(). */
function renderAnalysisStep(assist, view) {
    const mode = node('select', null, { 'aria-label': 'Review mode', 'aria-describedby': 'assist-mode-description', 'data-testid': 'assist-mode', disabled: assist.busy });
    for (const [value, label] of REVIEW_MODES)
        mode.append(node('option', label, { value }));
    mode.value = assist.mode;
    mode.addEventListener('change', () => { assist.mode = mode.value; assist.apply = null; assist.render(); });
    const sourcePending = !!assist.selectionDraft || assist.selectionDraftMode !== modelSelectionControlValue(assist.modelSelection);
    const analyzeFile = button('Analyze File', () => assist.perform(() => assist.analyzeDocuments(assist.chosenDocuments(false))), {
        primary: true,
        disabled: assist.busy || !assist.model || !view?.ann || sourcePending,
        id: 'assist-analyze',
        title: 'Analyze the current file on this device',
    });
    const analyzeSelected = button('Analyze Selected', () => assist.perform(() => assist.analyzeDocuments(assist.chosenDocuments(true), { batch: true })), {
        disabled: assist.busy || !assist.model || assist.selected.size === 0 || sourcePending,
        id: 'assist-analyze-selected',
        title: 'Analyze the files checked below',
    });
    const pause = button('Pause', () => { assist.installController?.abort(); assist.modelRunner.cancel(); }, {
        disabled: !assist.busy,
        id: 'assist-pause',
        title: 'Stop the current download or analysis',
    });
    const actions = node('div', null, { class: 'row' });
    actions.append(analyzeFile);
    const actionBar = node('div', null, { class: 'action-bar' });
    actionBar.append(actions);
    const schema = view?.data?.dtd?.name;
    const prerequisite = !schema ? 'Load a schema, then open a file.' : !view?.ann ? 'Open a file to begin.' : !assist.model ? 'Load the model in step 3 to continue.' : null;
    if (prerequisite)
        actionBar.append(node('p', prerequisite));
    const step = node('section', null, { class: 'section', 'data-testid': 'assist-step-analyze' });
    const heading = node('h3', '4. Analyze and Review');
    heading.prepend(icon('play'));
    step.append(heading, labeled('Review Mode', mode),
        node('p', reviewModeDescription(assist.mode), { class: 'muted mode-description', id: 'assist-mode-description', 'data-testid': 'assist-mode-description' }),
        actionBar);
    return { step, analyzeSelected, pause };
}
