import {ENTITY_ATTRIBUTES_CODEC,validateEntityContract,entityContractSchema} from './entity-contract.mjs';
import {EXECUTION_POLICY,supportsWebGPU,graphTransforms,wasmFallbackIdentity} from './execution-policy.mjs';
import {CLINICAL_V3_CODEC,CLINICAL_V3,validateClinicalV3Registry} from './clinical-v3.mjs';
import { invariant, validId, validHash, uniqueIds, fingerprint, sha256, freeze, clone, jsonParse } from './integrity.mjs';
import { safePath, unzipBounded } from './zip.mjs';
export const PACKAGE_FORMAT = 'nextmedtator-model-v1';
// The published fp32 GLiNER2.5-base encoder is about 702 MiB, above the earlier 512 MiB member cap and under 1 GiB.
export const MODEL_LIMITS = Object.freeze({ files: 128, file: 768 * 1024 * 1024, total: 1024 * 1024 * 1024, archive: 1024 * 1024 * 1024 });
// Every executable preprocessor/decoder is shipped with the application, not with a model.
export const CODECS = Object.freeze({
    'gliner25-small-records-v5': { purpose:'anchored-records', clinicalInference:true, coverage:'occurrence-record' },
    [ENTITY_ATTRIBUTES_CODEC]: {purpose:'declared-entity-attributes',clinicalInference:true,coverage:'occurrence-record'},
    [CLINICAL_V3_CODEC]: {purpose:'v3-anchors-and-shared-axes',clinicalInference:true,coverage:'occurrence-record'},
    'gliner25-records-v1': { purpose:'anchored-records', clinicalInference:true, coverage:'occurrence-record' },
    'tensor-conformance-v1': { purpose: 'graph-conformance-only', clinicalInference: false, coverage: 'tensor-fixture' },
    'gliner25-boundary-span-v1': { purpose: 'gliner25-boundary-span-extraction', clinicalInference: true, coverage: 'entity-span' },
    'gliner25-boundary-structured-v1': { purpose: 'gliner25-boundary-span-and-attributes', clinicalInference: true, coverage: 'structured-span' }
});
export function validateModelManifest(m) {
    invariant(m.format === PACKAGE_FORMAT, 'Unsupported model-package format');
    validId(m.id);
    invariant(typeof m.version === 'string' && m.version.length < 100, 'Model version required');
    invariant(m.runtime === 'onnxruntime-web', 'Unsupported runtime');
    invariant(typeof m.runtimeVersion === 'string', 'Pinned runtime version required');
    invariant(m.lineage && m.lineage.base && typeof m.lineage.base.model === 'string', 'Base model lineage required');
    invariant(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(m.lineage.base.revision), 'Base revision must be an immutable commit/content hash');
    if (m.lineage.adapter) {
        validHash(m.lineage.adapter.sha256);
        invariant(m.lineage.adapter.baseRevision === m.lineage.base.revision, 'LoRA adapter base mismatch');
        invariant(m.lineage.merge === 'merged-export' || m.lineage.merge === 'equivalent-graph', 'LoRA package must specify exported adapter application');
        invariant(m.lineage.trainedHeads === 'unchanged' || /^[a-f0-9]{64}$/.test(m.lineage.trainedHeads), 'Declare separately trained heads');
    }
    if (m.lineage.merge === 'unadapted-export') {
        invariant(!m.lineage.adapter && m.lineage.trainedHeads === 'unchanged', 'Unadapted export cannot declare adapter weights or trained heads');
    }
    invariant(m.license && typeof m.license.id === 'string' && typeof m.license.notice === 'string', 'Package license/notice required');
    invariant(Array.isArray(m.files) && m.files.length > 0 && m.files.length <= 128, 'Model file count limit');
    const paths = new Set();
    let total = 0;
    for (const f of m.files) {
        safePath(f.path);
        invariant(!paths.has(f.path), 'Duplicate model file');
        paths.add(f.path);
        validHash(f.sha256);
        invariant(Number.isSafeInteger(f.bytes) && f.bytes > 0 && f.bytes <= MODEL_LIMITS.file, 'Model file-size limit');
        total += f.bytes;
        invariant(total <= MODEL_LIMITS.total, 'Model package size limit');
        invariant(['graph', 'weights', 'tokenizer', 'schema', 'fixture', 'notice'].includes(f.role), 'Executable model plugins are forbidden');
        if(f.role==='notice')invariant(/\.(?:txt|json|md)$/i.test(f.path),'Model notices must be inert text or JSON');
        invariant(!/\.(?:[cm]?js|wasm|html)$/i.test(f.path), 'Executable artifact is not a model package');
    }
    invariant(Array.isArray(m.variants) && m.variants.length > 0, 'Model variants required');
    uniqueIds(m.variants);
    for (const v of m.variants) {
        invariant(['wasm', 'webgpu'].includes(v.backend), 'Unsupported execution provider');
        invariant(typeof v.precision === 'string', 'Precision required');
        invariant(CODECS[v.codec], 'Unsupported tokenizer/decoder contract; needs an application release');
        invariant(m.files.some(f => f.path === v.graph && f.role === 'graph'), 'Variant graph missing');
        if (v.threshold != null)
            invariant(typeof v.threshold === 'number' && v.threshold >= 0 && v.threshold <= 1, 'Invalid span threshold');
        if (CODECS[v.codec].coverage === 'occurrence-record') {
            invariant(v.automaticRelations!==true,'Automatic model relations are not source-score qualified in this app release');
            for (const name of ((v.codec===CLINICAL_V3_CODEC||v.codec===ENTITY_ATTRIBUTES_CODEC)?['model','attributes']:['model','attributes','records','relations'])) invariant(m.files.some(f=>f.path===v.graphs?.[name]&&f.role==='graph'),'Record graph missing: '+name);
            invariant(m.files.some(f=>f.path===v.tokenizer&&f.role==='tokenizer'),'Record tokenizer missing');
            invariant(Number.isFinite(v.pairTemperature)&&v.pairTemperature>0,'Pair temperature required');
            if(v.codec==='gliner25-records-v1'||v.codec===CLINICAL_V3_CODEC){
                invariant(v.fixedWords===512&&v.maxSequenceLength===512,'Unsupported GLiNER fixed-axis/window contract');
                invariant(Number.isFinite(v.abstentionThreshold)&&v.abstentionThreshold>=0&&v.abstentionThreshold<=1,'Source abstention threshold required');
                invariant((m.lineage.adapter && m.lineage.merge === 'merged-export') ||
                    (v.codec === 'gliner25-records-v1' && !m.lineage.adapter && m.lineage.merge === 'unadapted-export' && m.lineage.trainedHeads === 'unchanged'),
                    'Generic GLiNER package requires explicit merged adapter or unadapted export lineage');
            }
        }
        if(v.codec===ENTITY_ATTRIBUTES_CODEC){
            invariant(v.backend==='wasm'||supportsWebGPU(m,v),'Entity contract backend is not qualified');
            invariant(v.mainMaskType==='bool','Entity contract graphs require native Boolean masks');
            invariant(v.recordBinding===false&&v.fixedThreshold===true&&v.automaticRelations===false,'Fixed entity contract does not infer bindings/relations');
            invariant([512,1024].includes(v.fixedWords)&&v.maxSequenceLength===v.fixedWords,'Invalid entity token/word budget');
            validHash(v.entityContractSha256);
            invariant(m.files.some(f=>f.path===v.entityContract&&f.role==='schema'&&f.sha256===v.entityContractSha256),'Entity contract artifact identity required');
            invariant(Number.isFinite(v.abstentionThreshold)&&v.abstentionThreshold>=0&&v.abstentionThreshold<=1,'Source abstention required');
            invariant(m.lineage.adapter&&m.lineage.merge==='merged-export','Entity contract requires merged adapter lineage');
        }
        if(v.codec===CLINICAL_V3_CODEC){
            invariant(v.clinicalRegistryHash===CLINICAL_V3.registryHash&&v.sharedAxes==='one_value_softmax_no_attribute_threshold'&&v.recordBinding===false,'V3 inference contract required');
            invariant(m.files.some(f=>f.path===v.clinicalSchema&&f.role==='schema'),'V3 registry artifact required');
            if(v.clinicalRelease){
                invariant(Number.isFinite(v.threshold)&&v.threshold>=0&&v.threshold<=1,'Clinical release requires a finite span threshold in [0, 1]');
                validHash(v.clinicalRelease.runtimeFingerprint);validHash(v.clinicalRelease.adapterFingerprint);
                invariant(v.clinicalRelease.registryHash===CLINICAL_V3.registryHash&&v.clinicalRelease.coreThreshold===v.threshold,'Clinical release threshold/registry mismatch');
                invariant(['small','base'].includes(v.clinicalRelease.modelSize),'Clinical release model size required');
            }
        }
        if (CODECS[v.codec].coverage === 'entity-span' || CODECS[v.codec].coverage === 'structured-span') {
            invariant(v.graphs?.encoder === v.graph && typeof v.graphs.boundary === 'string', 'Boundary package needs encoder and boundary graphs');
            invariant(m.files.some(f => f.path === v.graphs.boundary && f.role === 'graph'), 'Boundary graph missing');
            invariant(typeof v.tokenizer === 'string' && m.files.some(f => f.path === v.tokenizer && f.role === 'tokenizer'), 'GLiNER tokenizer missing');
            invariant(typeof v.modelConfig === 'string' && m.files.some(f => f.path === v.modelConfig && f.role === 'schema'), 'GLiNER config missing');
            if (CODECS[v.codec].coverage === 'structured-span') {
                invariant(typeof v.graphs.explicit === 'string' && m.files.some(f => f.path === v.graphs.explicit && f.role === 'graph'), 'Span-attribute graph missing');
            }
        }
        invariant(Array.isArray(v.fixtures) && v.fixtures.length > 0 && v.fixtures.every(p => m.files.some(f => f.path === p && f.role === 'fixture')), 'Reference fixtures required');
        for (const f of v.externalData ?? [])
            invariant(m.files.some(x => x.path === f.path && x.role === 'weights') && typeof f.name === 'string', 'External weight reference invalid');
    }
    invariant(Array.isArray(m.capabilities) && m.capabilities.every(c => typeof c === 'string'), 'Capabilities required');
    return m;
}
export async function importModelPackage(bytes) {
    const entries = await unzipBounded(bytes, MODEL_LIMITS), raw = entries.get('manifest.json');
    invariant(raw, 'Model manifest missing');
    const manifest = validateModelManifest(jsonParse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
    invariant(entries.size === manifest.files.length + 1, 'Unlisted model artifacts');
    for (const file of manifest.files) {
        const content = entries.get(file.path);
        invariant(content && content.length === file.bytes && await sha256(content) === file.sha256, 'Model artifact integrity mismatch');
    }
    for(const variant of manifest.variants)if(variant.codec===CLINICAL_V3_CODEC)validateClinicalV3Registry(jsonParse(new TextDecoder('utf-8',{fatal:true}).decode(entries.get(variant.clinicalSchema))));
    const entityContracts=parseEntityContracts(manifest,entries);
    return { manifest: freeze(clone(manifest)), manifestHash: await fingerprint(manifest), files: entries, entityContracts };
}
export function parseEntityContracts(manifest,files){
    const entityContracts=new Map();
    for(const variant of manifest.variants)if(variant.codec===ENTITY_ATTRIBUTES_CODEC){const contract=validateEntityContract(jsonParse(new TextDecoder('utf-8',{fatal:true}).decode(files.get(variant.entityContract))));invariant(contract.threshold===variant.threshold&&contract.maxEncodedTokens===variant.maxSequenceLength,'Manifest/native contract differs');entityContracts.set(variant.id,freeze(clone(contract)));}
    return entityContracts;
}
/** Reproducible model identity retained in run fingerprints, comparisons and exports. */
export function modelRunProvenance(packageData, variantId, result) {
    const manifest = packageData.manifest, variant = manifest.variants.find(v => v.id === variantId);
    invariant(variant, 'Run variant not found in the model package');
    validHash(packageData.manifestHash);
    invariant(result.manifestHash === packageData.manifestHash && result.variantId === variantId,
        'Worker returned a different model package or variant');
    const qualifiedGPU = result.backend === 'webgpu' && result.executionPolicy === EXECUTION_POLICY && supportsWebGPU(manifest, variant);
    invariant(result.backend!=='webgpu'||!supportsWebGPU(manifest,variant)||qualifiedGPU,'Worker runtime qualification is missing');
    if(qualifiedGPU)invariant(JSON.stringify(result.graphTransforms??[])===JSON.stringify(graphTransforms(manifest,variant,'webgpu')),'GPU graph transformation provenance mismatch');
    invariant(result.kind === variant.codec && (result.backend === variant.backend || qualifiedGPU) && result.precision === variant.precision,
        'Worker runtime does not match the selected variant');
    return {
        producer: { kind: 'model', name: variant.codec===ENTITY_ATTRIBUTES_CODEC?(manifest.lineage.adapter?.repository??manifest.lineage.base.model):manifest.lineage.base.model, version: manifest.version,
            packageId: manifest.id, manifestHash: packageData.manifestHash,
            lineage: clone(manifest.lineage), artifacts: clone(manifest.files) },
        runtime: { backend: result.backend, precision: result.precision, version: manifest.runtimeVersion,
            variantId, variant: clone(variant), ...(result.executionPolicy ? {executionPolicy:result.executionPolicy} : {}),
            ...(result.graphTransforms?.length ? {graphTransforms:clone(result.graphTransforms)} : {}),
            ...(result.fallbackFrom ? {fallbackFrom:clone(result.fallbackFrom)} : {}),
            ...(result.fallbackReason ? {fallbackReason:result.fallbackReason} : {}) }
    };
}
export function qualifyForSchema(packageData, schema) {
    validateModelManifest(packageData.manifest);
    const codecs = packageData.manifest.variants.map(v => CODECS[v.codec]).filter(c => c.clinicalInference);
    invariant(codecs.length, 'Package is graph-conformance only. A qualified Clinical-Evidence tokenizer, schema encoder, heads and decoder are not installed.', 'CLINICAL_RUNTIME_UNQUALIFIED');
    const open = packageData.manifest.capabilities.includes('*');
    if (!open)
        for (const family of Object.keys(schema.families))
            invariant(packageData.manifest.capabilities.includes(family), 'Unsupported schema family');
    const entityVariant=packageData.manifest.variants.find(v=>CODECS[v.codec]?.coverage==='occurrence-record');
    if(entityVariant?.codec===ENTITY_ATTRIBUTES_CODEC){const contract=packageData.entityContracts?.get(entityVariant.id);invariant(contract,'Import and validate the entity contract artifact first');entityContractSchema(schema,contract);}
    if (codecs.some(c=>c.coverage==='occurrence-record')) return {level:'occurrence-record',unpredicted:['anchorless-records','cross-window-relations',...(packageData.manifest.variants.every(v=>v.codec===CLINICAL_V3_CODEC)?['family-choice-spans','literal-spans','record-binding','relations']:[])]};
    const structured = codecs.some(c => c.coverage === 'structured-span');
    if (structured)
        return { level: 'structured-span', unpredicted: ['value', 'unit', 'relations'] };
    return { level: 'entity-span', unpredicted: ['assertion', 'temporality', 'experiencer', 'value', 'unit', 'relations'] };
}
/** Choose an available backend across every codec at the qualified task level. */
export function selectInferenceVariant(packageData, level, {webgpuAvailable=!!globalThis.navigator?.gpu} = {}) {
    const variants = packageData.manifest.variants.filter(v => CODECS[v.codec]?.clinicalInference && CODECS[v.codec].coverage === level);
    const variant = variants.find(v=>v.backend==='wasm') ?? variants.find(v=>v.backend==='webgpu' && (webgpuAvailable||wasmFallbackIdentity(packageData.manifest,v)));
    invariant(variant, 'No browser GLiNER2.5 variant is available in the imported package');
    return variant;
}
/** Match the threshold display to the same backend/codec used by analysis. */
export function activeVariantForSchema(packageData, schema) {
    if (!packageData || !schema) return null;
    try { return selectInferenceVariant(packageData, qualifyForSchema(packageData, schema).level); }
    catch { return null; }
}
export function compareTensors(actual, expected, { atol = 0, rtol = 0 } = {}) {
    invariant(Number.isFinite(atol) && Number.isFinite(rtol) && atol >= 0 && rtol >= 0, 'Invalid numerical tolerance');
    invariant(actual.length === expected.length, 'Tensor length mismatch');
    let mismatches = 0, maxAbsoluteError = 0;
    for (let i = 0; i < expected.length; i++) {
        const a = Number(actual[i]), b = Number(expected[i]);
        invariant(Number.isFinite(a) && Number.isFinite(b), 'Non-finite conformance tensor');
        const error = Math.abs(a - b);
        maxAbsoluteError = Math.max(error, maxAbsoluteError);
        if (error > atol + rtol * Math.abs(b))
            mismatches++;
    }
    return { pass: mismatches === 0, mismatches, elements: expected.length, maxAbsoluteError, atol, rtol };
}
/** Dedicated worker owns ORT sessions. Force stop disposes the worker, never human state. */
export class ConformanceWorker {
    constructor(url = new URL('./onnx-worker.mjs', import.meta.url)) { this.url = url; this.worker = null; this.reject = null; this.cancelled = false; this.gpuFailures = new Map(); }
    async run(packageData, variantId, options = {}) {
        return this.#withModel(packageData, variantId, context => this.#execute(context, {task:'fixtures'}), {timeoutMs:120000,...options});
    }
    async analyze(packageData, variantId, request, options) {
        const [result] = await this.analyzeBatch(packageData, variantId, [request], options);
        return result;
    }
    async analyzeBatch(packageData, variantId, requests, { onProgress, onResult, ...options } = {}) {
        invariant(requests.length > 0, 'Analysis batch is empty');
        return this.#withModel(packageData, variantId, async context => {
            // Qualify the actual session/device, including after a backend switch.
            if (context.qualified) await this.#execute(context, {task:'fixtures'});
            const results = [];
            for (const [index, request] of requests.entries()) {
                await onProgress?.(index);
                const result = await this.#execute(context, { ...request, task: 'analyze' });
                await onResult?.(result, index);
                results.push(result);
            }
            invariant(!this.cancelled, 'Cancelled: local model worker stopped');
            return results;
        }, {timeoutMs:600000,...options});
    }
    async #withModel(packageData, variantId, action, {timeoutMs, backend = 'auto', onBackend, resolveFallback} = {}) {
        invariant(!this.worker&&!this.active, 'One model worker at a time');
        const variant = packageData.manifest.variants.find(v => v.id === variantId);
        invariant(variant, 'Variant not found');
        invariant(['auto','wasm','webgpu'].includes(backend), 'Unknown execution preference');
        const qualified = supportsWebGPU(packageData.manifest, variant);
        invariant(backend !== 'webgpu' || qualified || variant.backend === 'webgpu', 'WebGPU is not qualified for this package');
        const failure = this.gpuFailures.get(packageData.manifestHash);
        const actual = backend === 'auto' ? (qualified ? (globalThis.navigator?.gpu && !failure ? 'webgpu' : 'wasm') : variant.backend) : backend;
        invariant(actual === variant.backend || qualified, 'Execution preference is not supported by this package');
        const context = {packageData,variantId,timeoutMs,qualified,backend:actual,automatic:backend==='auto',onBackend,resolveFallback,
            fallbackReason: backend==='auto' && qualified ? (failure ?? (!globalThis.navigator?.gpu ? 'webgpu-unavailable' : null)) : null};
        this.cancelled = false;this.active=true;
        try {
            if(actual==='wasm')await this.#resolveWasm(context);
            this.#notifyBackend(context);
            try { await this.#load(context); }
            catch(error) { await this.#fallback(context,error,'webgpu-initialization-failed'); }
            return await action(context);
        }
        finally {
            this.worker?.terminate();
            this.worker = null;
            this.reject = null;
            this.active=false;
        }
    }
    #notifyBackend(context){
        const variant=context.packageData.manifest.variants.find(v=>v.id===context.variantId);
        context.onBackend?.({backend:context.backend,precision:variant.precision,packageData:context.packageData,variantId:context.variantId,fallbackReason:context.fallbackReason});
    }
    async #resolveWasm(context){
        const source=context.packageData,variant=source.manifest.variants.find(v=>v.id===context.variantId);
        if(variant.backend!=='webgpu')return;
        const target=wasmFallbackIdentity(source.manifest,variant);
        invariant(target&&context.resolveFallback,'FP16 needs the original FP32 package for WASM fallback');
        const candidate=await context.resolveFallback(target);
        invariant(!this.cancelled,'Cancelled: local model worker stopped');
        invariant(candidate?.manifestHash===target.manifestHash&&await fingerprint(candidate.manifest)===target.manifestHash,'WASM fallback package identity mismatch');
        const fallback=candidate.manifest.variants.find(v=>v.id===target.variantId);
        invariant(fallback?.backend==='wasm'&&fallback.precision==='fp32','WASM fallback variant mismatch');
        context.fallbackFrom={manifestHash:source.manifestHash,variantId:variant.id,precision:variant.precision};
        context.packageData=candidate;context.variantId=fallback.id;
    }
    async #load(context) {
        invariant(!this.cancelled, 'Cancelled: local model worker stopped');
        const {packageData,variantId,backend,timeoutMs}=context;
        this.worker = new Worker(this.url, {type:'module'});
        await this.#request({task:'load',manifest:packageData.manifest,manifestHash:packageData.manifestHash,variantId,backend,files:[...packageData.files]},backend==='webgpu'?Math.min(timeoutMs,120000):timeoutMs);
    }
    async #fallback(context,error,reason) {
        if(this.cancelled || !context.automatic || context.backend!=='webgpu' || !context.qualified) throw error;
        // Terminate the failed GPU context before creating fresh CPU sessions.
        // Completed notes have already been published and are never replayed.
        this.worker?.terminate();this.worker=null;
        context.backend='wasm';context.fallbackReason=reason;
        this.gpuFailures.set(context.packageData.manifestHash,reason);
        await this.#resolveWasm(context);
        this.#notifyBackend(context);
        await this.#load(context);
        const report=await this.#request({task:'fixtures'},context.timeoutMs);
        invariant(report.pass,'WASM fallback failed its public conformance fixtures');
    }
    async #execute(context,message) {
        let result;
        try {
            result=await this.#request(message,context.backend==='webgpu'?Math.min(context.timeoutMs,60000):context.timeoutMs);
            if(message.task==='fixtures')invariant(result.pass!==false,'Selected backend failed its public conformance fixtures');
        } catch(error) {
            await this.#fallback(context,error,message.task==='fixtures'?'webgpu-conformance-failed':'webgpu-inference-failed');
            result=await this.#request(message,context.timeoutMs);
            if(message.task==='fixtures')invariant(result.pass,'WASM fallback failed its public conformance fixtures');
        }
        return context.qualified ? {...result,executionPolicy:EXECUTION_POLICY,...(context.fallbackFrom?{fallbackFrom:context.fallbackFrom}:{}),...(context.fallbackReason?{fallbackReason:context.fallbackReason}:{})} : result;
    }
    #request(message, timeoutMs) {
        invariant(!this.cancelled, 'Cancelled: local model worker stopped');
        const worker = this.worker;
        return new Promise((resolve, reject) => {
            let finished = false;
            const finish = (error, result) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                this.reject = null;
                worker.onmessage = worker.onerror = null;
                error ? reject(error) : resolve(result);
            };
            const timer = setTimeout(() => finish(new Error('Local model worker timed out and was stopped')), timeoutMs);
            this.reject = error => finish(error);
            worker.onerror = () => finish(new Error('Local ONNX worker failed. Check installed runtime assets.'));
            worker.onmessage = ({ data }) => data.progress ? undefined : data.error ? finish(new Error(data.error)) : finish(null, data.result);
            try { worker.postMessage(message); }
            catch (error) { finish(error); }
        });
    }
    cancel() {
        this.cancelled = true;
        this.reject?.(new Error('Cancelled: local model worker stopped'));
    }
}

/** Candidate position is not an identity. Match legal intervals within each query. */
export function compareCandidateSpans(actual,expected){
    const names=['pair_indices','pair_logits','pair_valid'];
    if(names.some(name=>JSON.stringify(actual[name]?.dims)!==JSON.stringify(expected[name]?.dims)))return {pass:false,reason:'candidate-shape-mismatch'};
    const [batch,queries,count]=expected.pair_logits.dims;
    let intervals=0,mismatches=0,maxAbsoluteError=0,setsExact=true;
    const make=(values,b,q)=>{
        const result=new Map(),indices=values.pair_indices.data,logits=values.pair_logits.data,valid=values.pair_valid.data;
        for(let c=0;c<count;c++){
            const i=(b*queries+q)*count+c;if(!valid[i])continue;
            const key=String(indices[i*2])+':'+String(indices[i*2+1]);
            if(result.has(key))return null;result.set(key,Number(logits[i]));
        }
        return result;
    };
    for(let b=0;b<batch;b++)for(let q=0;q<queries;q++){
        const a=make(actual,b,q),e=make(expected,b,q);
        if(!a||!e||a.size!==e.size||[...e.keys()].some(key=>!a.has(key))){setsExact=false;mismatches++;continue;}
        for(const [key,value]of e){const got=a.get(key),check=compareTensors([got],[value],expected.pair_logits.tolerance??{});intervals++;mismatches+=check.mismatches;maxAbsoluteError=Math.max(maxAbsoluteError,check.maxAbsoluteError);}
    }
    return {pass:setsExact&&mismatches===0,setsExact,intervals,mismatches,maxAbsoluteError};
}
