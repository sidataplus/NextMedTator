import {ENTITY_ATTRIBUTES_CODEC,validateEntityContract,packEntityContract,analyzeEntityContract,compareEntityContractRecords} from './entity-contract.mjs';
import {wasmThreadCount} from './inference-options.mjs';
import {supportsWebGPU,prepareGraph,graphTransforms,EXECUTION_POLICY,recordConformanceOptions} from './execution-policy.mjs';
import {CLINICAL_V3_CODEC,validateClinicalV3Registry} from './clinical-v3.mjs';
import {RECORDS_CODEC,isRecordsCodec,smallRuntime,analyzeSmall} from './gliner-small.mjs';
import { validateModelManifest, compareTensors, compareCandidateSpans, CODECS } from './model-package.mjs';
import { invariant, jsonParse, sha256 } from './integrity.mjs';
import { GLINER_CODEC, GLINER_STRUCTURED, GLINER_LIMITS, SPAN_NOTICE, STRUCTURED_NOTICE, GlinerTokenizer, readGlinerConfig, prepareWindow, planWindows, decodeBoundary, locateSpans, documentCoverage, resolveFlat, splitWords, attributeFields, compareSpanOccurrences } from './gliner.mjs';
// ORT and its WASM files are copied locally by the build. No fallback URL or API.
let loaded = null;
const initialization=(phase,detail)=>self.postMessage({progress:{kind:'initialization',phase,detail}});
self.onmessage = async ({ data }) => {
    try {
        let result;
        if (data.task === 'load') {
            invariant(!loaded, 'A model is already loaded in this worker');
            loaded = await loadModel(data);
            result = { ready: true, wasmThreads: loaded.ort.env.wasm.numThreads };
        }
        else {
            invariant(loaded, 'Load a model before requesting inference');
            const { ort, files, manifest, variant, sessions } = loaded;
            if(data.task==='fixtures')initialization('Checking model compatibility','Running the package’s reference checks on the selected device. This may take a minute.');
            const request = { ...data, manifestHash: loaded.manifestHash };
            result = loaded.small ? await runSmall(loaded,request) : loaded.tokenizer
                ? await runBoundary(loaded, request)
                : await runFixtures(ort, files, manifest, variant, request, sessions, loaded.session);
        }
        if(loaded&&supportsWebGPU(loaded.manifest,loaded.variant))result={...result,executionPolicy:EXECUTION_POLICY,graphTransforms:graphTransforms(loaded.manifest,loaded.variant,loaded.variant.backend)};
        self.postMessage({ result });
    }
    catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
};
async function loadModel(data) {
    initialization('Verifying runtime model files','Checking hashes before the model is initialized. No download is needed for installed files.');
    const manifest = validateModelManifest(data.manifest), files = new Map(data.files), declaredVariant = manifest.variants.find(v => v.id === data.variantId);
    invariant(declaredVariant, 'Unknown model variant');
    const backend = data.backend ?? declaredVariant.backend;
    invariant(backend === declaredVariant.backend || (backend === 'webgpu' && supportsWebGPU(manifest, declaredVariant)), 'Unqualified execution backend');
    const variant = {...declaredVariant, backend};
    for (const file of manifest.files) {
        const bytes = files.get(file.path);
        invariant(bytes?.length === file.bytes && await sha256(bytes) === file.sha256, 'Worker model-integrity failure');
    }
    for(const path of Object.values(variant.graphs??{}))files.set(path,await prepareGraph(manifest,variant,path,files.get(path)));
    if(variant.codec===CLINICAL_V3_CODEC)validateClinicalV3Registry(jsonParse(new TextDecoder('utf-8',{fatal:true}).decode(files.get(variant.clinicalSchema))));
    initialization('Starting inference runtime','Loading the local ONNX runtime.');
    const ort = await import('../../vendor/ort/ort.webgpu.min.mjs');
    if(data.diagnostics){ort.env.debug=true;ort.env.logLevel='verbose';}
    invariant(ort.env.versions.web === manifest.runtimeVersion, 'Package/runtime version mismatch');
    ort.env.wasm.numThreads = wasmThreadCount({crossOriginIsolated:self.crossOriginIsolated,hardwareConcurrency:navigator.hardwareConcurrency,maxThreads:data.maxThreads,userAgent:navigator.userAgent,codec:variant.codec,fixedWords:variant.fixedWords});
    const runtimeDetail=variant.backend==='wasm'?`Preparing the local runtime with ${ort.env.wasm.numThreads} WASM thread${ort.env.wasm.numThreads===1?'':'s'}. The first run can take longer.`:'Preparing the local runtime. The first run can take longer.';
    initialization('Starting inference runtime',runtimeDetail);
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = new URL('../../vendor/ort/', import.meta.url).href;
    if (variant.backend === 'webgpu') {
        invariant(!!navigator.gpu, 'WebGPU unavailable');
        const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
        invariant(!!adapter, 'No usable GPU adapter');
        if(variant.precision==='fp16')invariant(adapter.features.has('shader-f16'),'This GPU does not support FP16 shaders');
        // Use the adapter we checked, rather than letting ORT select a different
        // default adapter after the FP16 capability check.
        ort.env.webgpu.adapter=adapter;
    }
    let entityContract=null;
    if(variant.codec===ENTITY_ATTRIBUTES_CODEC){entityContract=validateEntityContract(jsonParse(new TextDecoder().decode(files.get(variant.entityContract))));invariant(entityContract.threshold===variant.threshold&&entityContract.maxEncodedTokens===variant.maxSequenceLength,'Native entity contract differs from manifest');}
    const context = { ort, files, manifest, variant, entityContract, manifestHash: data.manifestHash, sessions: [] };
    const codec = CODECS[variant.codec];
    if (isRecordsCodec(variant.codec)) {
        initialization('Preparing tokenizer','Building the local text tokenizer.');
        const tokenizer=GlinerTokenizer.fromJson(new TextDecoder().decode(files.get(variant.tokenizer)));
        const graphs={};for(const [name,path] of Object.entries(variant.graphs))graphs[name]=await openSession(ort,files,variant,path,context.sessions);
        if(variant.codec!=='gliner25-small-records-v5')invariant(graphs.model.outputNames.includes('null_logits'),'Generic GLiNER graph lacks source abstention output');
        context.small=smallRuntime(ort,graphs,tokenizer,variant);return releaseGraphBuffers(context);
    }
    if (codec.coverage === 'entity-span' || codec.coverage === 'structured-span') {
        context.tokenizer = GlinerTokenizer.fromJson(new TextDecoder('utf-8', { fatal: true }).decode(files.get(variant.tokenizer)));
        const special = readGlinerConfig(new TextDecoder('utf-8', { fatal: true }).decode(files.get(variant.modelConfig)));
        for (const name of ['[E]', '[P]', '[SEP_TEXT]', '[SEP_STRUCT]'])
            invariant(context.tokenizer.idFor(name) === special[name], 'Tokenizer and GLiNER config special-token ids disagree');
        context.encoder = await openSession(ort, files, variant, variant.graphs.encoder, context.sessions);
        context.boundary = await openSession(ort, files, variant, variant.graphs.boundary, context.sessions);
        context.explicit = variant.graphs.explicit ? await openSession(ort, files, variant, variant.graphs.explicit, context.sessions) : null;
    }
    else
        context.session = await openSession(ort, files, variant, variant.graph, context.sessions);
    return releaseGraphBuffers(context);
}
function releaseGraphBuffers(context){
    // Sessions own the compiled graph. Keep tokenizer/schema/fixtures, not another weight copy.
    for(const file of context.manifest.files)if(file.role==='graph'||file.role==='weights')context.files.delete(file.path);
    return context;
}

async function openSession(ort, files, variant, graph, sessions) {
    initialization(`Initializing ${variant.backend==='webgpu'?'WebGPU':'WASM'} · ${graph}`,'Compiling the model for this device. An accurate ETA is not available yet.');
    const session = await ort.InferenceSession.create(files.get(graph), { executionProviders: [variant.backend], externalData: (variant.externalData ?? []).map(f => ({ path: f.name, data: files.get(f.path) })), logSeverityLevel: 3 });
    sessions.push(session);
    return session;
}
async function runFixtures(ort, files, manifest, variant, data, sessions, session) {
    const results = [];
    for (const path of variant.fixtures) {
        const fixture = jsonParse(new TextDecoder().decode(files.get(path)));
        const feeds = {};
        for (const [name, t] of Object.entries(fixture.inputs)) {
            invariant(['float32', 'int32', 'int64', 'bool'].includes(t.type), 'Unsupported fixture tensor type');
            const values = t.type === 'int64' ? BigInt64Array.from(t.data, BigInt) : t.type === 'int32' ? Int32Array.from(t.data) : t.type === 'bool' ? Uint8Array.from(t.data) : Float32Array.from(t.data);
            feeds[name] = new ort.Tensor(t.type, values, t.dims);
        }
        const start = performance.now();
        const outputs = await session.run(feeds);
        const checks = {};
        for (const [name, expected] of Object.entries(fixture.outputs)) {
            const actual = outputs[name];
            invariant(actual, 'Missing expected graph output');
            invariant(JSON.stringify(actual.dims) === JSON.stringify(expected.dims), 'Output shape mismatch');
            checks[name] = compareTensors(actual.data, expected.data, expected.tolerance ?? {});
        }
        results.push({ fixture: path, durationMs: performance.now() - start, checks, pass: Object.values(checks).every(x => x.pass) });
    }
    return { kind: 'graph-conformance-not-clinical-validation', manifestHash: data.manifestHash, variantId: variant.id, backend: variant.backend, precision: variant.precision, runtime: ort.env.versions, results, pass: results.every(r => r.pass) };
}
async function runBoundary(context, data) {
    const { ort, files, manifest, variant, tokenizer, encoder, boundary, explicit } = context;
    invariant(variant.codec === GLINER_CODEC || variant.codec === GLINER_STRUCTURED, 'Unsupported span codec');
    const threshold = data.threshold ?? variant.threshold ?? GLINER_LIMITS.threshold;
    if (data.task === 'analyze')
        return analyzeText(ort, encoder, boundary, explicit, tokenizer, data.text, data.labels, { threshold, manifest, variant, manifestHash: data.manifestHash, contentCount: data.contentCount, groups: data.groups, onProgress: progress => self.postMessage({ progress }) });
    const results = [];
    for (const path of variant.fixtures) {
        const fixture = jsonParse(new TextDecoder().decode(files.get(path)));
        invariant(fixture.kind === GLINER_CODEC && typeof fixture.text === 'string' && Array.isArray(fixture.labels) && Array.isArray(fixture.expected), 'Span fixture must name text, labels and expected spans');
        const actual = await analyzeText(ort, encoder, boundary, explicit, tokenizer, fixture.text, fixture.labels, { threshold: fixture.threshold ?? threshold, manifest, variant, manifestHash: data.manifestHash });
        const checks = compareSpanOccurrences(actual.spans, fixture.expected, fixture.text);
        results.push({ fixture: path, ...checks, pass: checks.pass && actual.status === 'complete', spans: actual.spans.map(span => ({ label: span.label, start: span.start, end: span.end, text: span.text, score: span.score })) });
    }
    return { kind: variant.codec, manifestHash: data.manifestHash, variantId: variant.id, backend: variant.backend, precision: variant.precision, runtime: ort.env.versions, notice: variant.codec === GLINER_STRUCTURED ? STRUCTURED_NOTICE : SPAN_NOTICE, results, pass: results.every(r => r.pass) };
}
async function analyzeText(ort, encoder, boundary, explicit, tokenizer, text, labels, { threshold, manifest, variant, manifestHash, contentCount, groups, onProgress }) {
    invariant(typeof text === 'string' && Array.isArray(labels) && labels.length > 0 && labels.length <= GLINER_LIMITS.labels && labels.every(label => typeof label === 'string'), 'Analysis labels required');
    const words = splitWords(text);
    const plan = planWindows(tokenizer, labels, words);
    const spans = [];
    const content = Number.isInteger(contentCount) ? contentCount : labels.length;
    invariant(content > 0 && content <= labels.length, 'Content label count is outside the prompt');
    const attributeGroups = Array.isArray(groups) ? groups : [];
    const structured = variant.codec === GLINER_STRUCTURED;
    if (structured)
        invariant(explicit && attributeGroups.reduce((count, group) => count + group.choices.length, 0) === labels.length - content, 'Structured analysis needs the span-attribute graph and its label groups');
    for (const [windowIndex, [from, to]] of plan.windows.entries()) {
        const slice = words.slice(from, to);
        const prepared = prepareWindow(tokenizer, labels, slice);
        const ids = BigInt64Array.from(prepared.inputIds, BigInt);
        const hidden = await encoder.run({ input_ids: new ort.Tensor('int64', ids, [1, ids.length]), attention_mask: new ort.Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]) });
        const states = hidden.hidden_states ?? hidden[Object.keys(hidden)[0]];
        invariant(states?.dims?.[2] === 768, 'Encoder hidden size is not the GLiNER2.5-base width');
        const queries = gather(states, prepared.queryPositions);
        const tokens = gather(states, prepared.wordFirst);
        const outputs = await boundary.run({
            token_states: new ort.Tensor('float32', tokens, [1, slice.length, 768]),
            text_mask: new ort.Tensor('bool', new Uint8Array(slice.length).fill(1), [1, slice.length]),
            query_states: new ort.Tensor('float32', queries, [1, labels.length, 768]),
            query_mask: new ort.Tensor('bool', new Uint8Array(labels.length).fill(1), [1, labels.length])
        });
        const pair = outputs.pair_logits, indices = outputs.candidate_indices, valid = outputs.candidate_valid, absent = outputs.null_logits;
        invariant(pair && indices && valid && absent, 'Boundary graph outputs do not match the GLiNER2.5 contract');
        const contentDims = [pair.dims[0], content, pair.dims[2]];
        const decoded = decodeBoundary({ pairLogits: pair.data, pairDims: contentDims, candidateIndices: indices.data, indexDims: [indices.dims[0], content, indices.dims[2], indices.dims[3]], candidateValid: valid.data, nullLogits: absentRow(absent, labels.length).slice(0, content), labels: labels.slice(0, content), threshold });
        if (structured && decoded.length && attributeGroups.length)
            await attachAttributes(ort, explicit, tokens, slice.length, queries.slice(content * 768), attributeGroups, decoded);
        const located = locateSpans(text, words, decoded, from);
        spans.push(...located);
        // Progress also keeps a long note inside the worker's inactivity timeout.
        onProgress?.({ completed: windowIndex + 1, total: plan.windows.length, spans: located });
    }
    const merged = resolveFlat(spans);
    const coverage = documentCoverage(text, words, plan.uncovered);
    const notice = structured ? STRUCTURED_NOTICE : SPAN_NOTICE;
    return { kind: variant.codec, manifestHash, variantId: variant.id, backend: variant.backend, precision: variant.precision, runtime: { web: manifest.runtimeVersion }, notice, threshold, status: coverage.status, coverage: coverage.coverage, windows: plan.windows.length, spans: merged };
}
function absentRow(tensor, labels) {
    const row = [];
    const width = tensor.dims.at(-1);
    invariant(width === labels, 'Boundary abstention width does not match the label count');
    for (let q = 0; q < labels; q++)
        row.push(Number(tensor.data[q]));
    return row;
}
function gather(states, positions) {
    const width = states.dims[2], out = new Float32Array(positions.length * width), data = states.data;
    positions.forEach((position, row) => { invariant(position >= 0 && position < states.dims[1], 'Gather position is outside the encoder sequence'); out.set(data.subarray(position * width, (position + 1) * width), row * width); });
    return out;
}
async function attachAttributes(ort, explicit, tokens, wordCount, attributeStates, groups, decoded) {
    const width = 768, attributes = groups.reduce((count, group) => count + group.choices.length, 0);
    invariant(wordCount <= GLINER_LIMITS.explicitWords && attributeStates.length === attributes * width, 'Attribute states do not match the exported head');
    const padded = new Float32Array(GLINER_LIMITS.explicitWords * width);
    padded.set(tokens.subarray(0, wordCount * width));
    const mask = new Uint8Array(GLINER_LIMITS.explicitWords);
    mask.fill(1, 0, wordCount);
    const indices = new BigInt64Array(attributes * decoded.length * 2);
    decoded.forEach((span, column) => {
        for (let row = 0; row < attributes; row++) {
            const at = (row * decoded.length + column) * 2;
            indices[at] = BigInt(span.start);
            indices[at + 1] = BigInt(span.end);
        }
    });
    const outputs = await explicit.run({
        token_states: new ort.Tensor('float32', padded, [1, GLINER_LIMITS.explicitWords, width]),
        text_mask: new ort.Tensor('bool', mask, [1, GLINER_LIMITS.explicitWords]),
        query_states: new ort.Tensor('float32', attributeStates, [1, attributes, width]),
        query_mask: new ort.Tensor('bool', new Uint8Array(attributes).fill(1), [1, attributes]),
        indices: new ort.Tensor('int64', indices, [1, attributes, decoded.length, 2])
    });
    const logits = outputs.logits;
    invariant(logits?.dims?.[1] === attributes && logits.dims[2] === decoded.length, 'Span-attribute graph returned an unexpected shape');
    decoded.forEach((span, column) => { span.attributes = attributeFields(logits.data, logits.dims, column, groups); });
}

async function runSmall(context,request){
    // Only a requested note streams window records; conformance fixtures report counts alone.
    const post=request.task==='analyze'?progress=>self.postMessage({progress}):({records,...progress})=>self.postMessage({progress});
    const analyze=async(input)=>({...await (context.entityContract?analyzeEntityContract(context.small,input.text,input.schema,context.entityContract,context.variant,{longContext:input.longContext===true,onProgress:post}):analyzeSmall(context.small,input.text,input.schema,{threshold:context.variant.clinicalRelease?context.variant.threshold:input.threshold??context.variant.threshold??.5,automaticRelations:context.variant.automaticRelations===true,codec:context.variant.codec,abstentionThreshold:context.variant.abstentionThreshold??.5,onProgress:post})),kind:context.variant.codec,manifestHash:context.manifestHash,variantId:context.variant.id,backend:context.variant.backend,precision:context.variant.precision,wasmThreads:context.ort.env.wasm.numThreads});
    if(request.task==='analyze')return analyze(request);
    const results=[];
    for(const path of context.variant.fixtures){const fixture=jsonParse(new TextDecoder().decode(context.files.get(path)));if(fixture.feeds){const checks={};if(fixture.sourceText&&context.entityContract){const packed=packEntityContract(fixture.sourceText,context.entityContract,t=>context.small.rt._tokenize(t)),pad=context.variant.fixedWords;const expected={input_ids:packed.inputIds,attention_mask:packed.inputIds.map(()=>1),text_word_indices:[...packed.textWordFirstPositions,...Array(pad-packed.words.length).fill(0)],text_word_mask:[...packed.words.map(()=>1),...Array(pad-packed.words.length).fill(0)],query_marker_indices:packed.queryMarkerPositions,query_marker_mask:packed.queryMarkerPositions.map(()=>1)};for(const [name,values]of Object.entries(expected))invariant(JSON.stringify(values)===JSON.stringify(fixture.feeds[name].type==='bool'?fixture.feeds[name].data.map(Number):fixture.feeds[name].data),'Exact native input packing failed: '+name);}for(const row of fixture.tokenRows)invariant(JSON.stringify(context.small.rt._tokenize(row.text))===JSON.stringify(row.ids),'Exact tokenizer conformance failed');const feeds={};for(const [name,t] of Object.entries(fixture.feeds))feeds[name]=new context.ort.Tensor(t.type,t.type==='int64'?BigInt64Array.from(t.data,BigInt):t.type==='bool'?Uint8Array.from(t.data):Float32Array.from(t.data),t.dims);const session=fixture.graph==='attributes'?context.small.rt.attrsSession:fixture.graph==='records'?context.small.rt.recordsSession:fixture.graph==='relations'?context.small.rt.headsSession:context.small.rt.session;const outputs=await session.run(feeds);for(const [name,expected] of Object.entries(fixture.outputs)){invariant(JSON.stringify(outputs[name].dims)===JSON.stringify(expected.dims),'Native output shape mismatch');checks[name]=compareTensors(outputs[name].data,expected.data,expected.tolerance);}let rawCandidateChecks;
        if(fixture.candidateComparison==='span-keyed-v1'){
            rawCandidateChecks=Object.fromEntries(['pair_indices','pair_logits','pair_valid'].map(name=>[name,checks[name]]));
            checks.candidates=compareCandidateSpans(outputs,fixture.outputs);
            for(const name of ['pair_indices','pair_logits','pair_valid'])delete checks[name];
        }
        results.push({fixture:path,checks,...(rawCandidateChecks?{rawCandidateChecks}:{}),tokenIdsExact:fixture.tokenRows.length?true:null,pass:Object.values(checks).every(c=>c.pass)});continue;}const actual=await analyze(fixture);const {canonical}=await import('./integrity.mjs');const rows=records=>records.map(({id,origin,score,documentId,...r})=>r).sort((a,b)=>canonical(a).localeCompare(canonical(b)));const nativeChecks=context.entityContract?compareEntityContractRecords(fixture.records,actual.records,recordConformanceOptions(context.manifest,context.variant)):null;const pass=nativeChecks?nativeChecks.pass&&actual.encodedTokens===fixture.encodedTokens:canonical(rows(actual.records))===canonical(rows(fixture.records));results.push({fixture:path,pass,status:actual.status,encodedTokensMatch:actual.encodedTokens===fixture.encodedTokens,...(nativeChecks?{nativeChecks}:{}),records:actual.records});}
    return {kind:context.variant.codec,manifestHash:context.manifestHash,variantId:context.variant.id,backend:context.variant.backend,precision:context.variant.precision,wasmThreads:context.ort.env.wasm.numThreads,results,pass:results.every(r=>r.pass)};
}
