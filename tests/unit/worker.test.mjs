import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConformanceWorker,modelRunProvenance,selectInferenceVariant,validateModelManifest } from '../../src/nextmedtator/model-package.mjs';
import {readFileSync} from 'node:fs';
import {supportsWebGPU,EXECUTION_POLICY,graphTransforms,prepareGraph,wasmFallbackIdentity} from '../../src/nextmedtator/execution-policy.mjs';

const packageData = { manifest: { variants: [{ id: 'wasm' }] }, manifestHash: 'fixture', files: new Map([['graph', new Uint8Array([1])]]) };
const requests = [{ text: 'first' }, { text: 'second' }];

function fakeWorker(t, respond = message => message.task === 'load' ? { ready: true } : { text: message.text }) {
    const workers = [];
    class Worker {
        constructor() { this.messages = []; this.terminations = 0; workers.push(this); }
        postMessage(message) {
            this.messages.push(message);
            queueMicrotask(() => {
                const response = respond(message, this);
                if (response) this.onmessage?.({ data: response.error ? response : { result: response } });
            });
        }
        terminate() { this.terminations++; }
    }
    const original = globalThis.Worker;
    globalThis.Worker = Worker;
    t.after(() => { if (original === undefined) delete globalThis.Worker; else globalThis.Worker = original; });
    return workers;
}

// Node does not expose a browser Worker; restore the original after each case.
test('batch loads package once, reuses the worker, and publishes completed notes in order', async t => {
    const workers = fakeWorker(t);
    const runner = new ConformanceWorker();
    const seen = [];
    const results = await runner.analyzeBatch(packageData, 'wasm', requests, {
        onProgress: index => seen.push(`start ${index}`), onResult: (result, index) => seen.push(`${index}: ${result.text}`)
    });
    assert.deepEqual(results, [{ text: 'first' }, { text: 'second' }]);
    assert.deepEqual(seen, ['start 0', '0: first', 'start 1', '1: second']);
    assert.equal(workers.length, 1);
    assert.deepEqual(workers[0].messages.map(m => m.task), ['load', 'analyze', 'analyze']);
    assert.equal(workers[0].messages.filter(m => m.files).length, 1);
    assert.equal(workers[0].terminations, 1);
    assert.equal(runner.worker, null);
});
test('cancellation preserves finished notes, stops the batch, and allows retry', async t => {
    const workers = fakeWorker(t);
    const runner = new ConformanceWorker(), seen = [];
    await assert.rejects(runner.analyzeBatch(packageData, 'wasm', requests, {
        onResult: result => { seen.push(result.text); runner.cancel(); }
    }), /Cancelled/);
    assert.deepEqual(seen, ['first']);
    assert.equal(workers[0].messages.filter(m => m.task === 'analyze').length, 1);
    assert.equal(workers[0].terminations, 1);
    assert.deepEqual(await runner.analyze(packageData, 'wasm', requests[1]), { text: 'second' });
    assert.equal(workers.length, 2);
    assert.equal(workers[1].terminations, 1);
});
test('load errors, inference errors, timeout, and in-flight cancellation release the worker', async t => {
    for (const failure of ['load', 'analyze', 'timeout', 'cancel']) {
        await t.test(failure, async t => {
            let runner;
            const workers = fakeWorker(t, message => {
                if (message.task === failure) return { error: 'Fixture failure' };
                if (message.task === 'analyze' && failure === 'timeout') return null;
                if (message.task === 'analyze' && failure === 'cancel') { runner.cancel(); return null; }
                return { ready: true };
            });
            runner = new ConformanceWorker();
            await assert.rejects(runner.analyzeBatch(packageData, 'wasm', requests, { timeoutMs: 20 }), /failure|timed out|Cancelled/);
            assert.equal(workers[0].terminations, 1);
            assert.equal(runner.worker, null);
        });
    }
});

const entry=JSON.parse(readFileSync(new URL('../../deployment/production-model-catalog.json',import.meta.url))).entries[0];
const gpuPackage={manifest:entry.manifest,manifestHash:entry.revision,files:new Map()};
const variantId=entry.manifest.variants[0].id;
function gpuNavigator(t){const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu:{}}});t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;});}
function reply(message,worker){if(message.task==='load'){worker.backend=message.backend;return {ready:true};}return message.task==='fixtures'?{pass:true,backend:worker.backend}:{text:message.text,backend:worker.backend};}
test('qualification pins both graphs, tokenizer, contract and runtime',()=>{
    assert.equal(supportsWebGPU(entry.manifest,entry.manifest.variants[0]),true);
    for(const role of ['graph','tokenizer','schema']){const manifest=structuredClone(entry.manifest);manifest.files.find(f=>f.role===role).sha256='0'.repeat(64);assert.equal(supportsWebGPU(manifest,manifest.variants[0]),false);}
    const manifest=structuredClone(entry.manifest);manifest.runtimeVersion='other';assert.equal(supportsWebGPU(manifest,manifest.variants[0]),false);
});
test('automatic GPU initialization failure retries WASM and remembers the failure',async t=>{
    gpuNavigator(t);const workers=fakeWorker(t,(m,w)=>m.task==='load'&&m.backend==='webgpu'?{error:'GPU unavailable'}:reply(m,w));
    const runner=new ConformanceWorker(),events=[];
    const result=await runner.analyze(gpuPackage,variantId,requests[0],{onBackend:e=>events.push(e.backend)});
    assert.equal(result.backend,'wasm');assert.equal(result.fallbackReason,'webgpu-initialization-failed');assert.equal(result.executionPolicy,EXECUTION_POLICY);
    assert.deepEqual(events,['webgpu','wasm']);assert.equal(workers.length,2);assert.ok(workers.every(w=>w.terminations===1));
    await runner.analyze(gpuPackage,variantId,requests[1]);assert.equal(workers[2].messages[0].backend,'wasm');
});
test('GPU inference failure retries only unfinished notes and records actual backends',async t=>{
    gpuNavigator(t);const workers=fakeWorker(t,(m,w)=>m.task==='analyze'&&m.text==='second'&&w.backend==='webgpu'?{error:'Device lost'}:reply(m,w));
    const seen=[],runner=new ConformanceWorker();const results=await runner.analyzeBatch(gpuPackage,variantId,requests,{onResult:r=>seen.push(r.text)});
    assert.deepEqual(seen,['first','second']);assert.deepEqual(results.map(r=>r.backend),['webgpu','wasm']);
    assert.equal(results[1].fallbackReason,'webgpu-inference-failed');
    assert.deepEqual(workers[1].messages.filter(m=>m.task==='analyze').map(m=>m.text),['second']);
});
test('GPU fixture mismatch falls back; forced GPU surfaces errors without fallback',async t=>{
    gpuNavigator(t);const workers=fakeWorker(t,(m,w)=>m.task==='fixtures'&&w.backend==='webgpu'?{pass:false}:reply(m,w));
    const runner=new ConformanceWorker();const report=await runner.run(gpuPackage,variantId);assert.equal(report.backend,'wasm');assert.equal(report.fallbackReason,'webgpu-conformance-failed');
    await assert.rejects(runner.run(gpuPackage,variantId,{backend:'webgpu'}),/conformance/);assert.equal(workers.length,3);
});
test('cancellation and consumer errors never trigger backend retries',async t=>{
    gpuNavigator(t);const workers=fakeWorker(t,reply);const runner=new ConformanceWorker();
    await assert.rejects(runner.analyzeBatch(gpuPackage,variantId,requests,{onResult:()=>runner.cancel()}),/Cancelled/);assert.equal(workers.length,1);
    await assert.rejects(runner.analyzeBatch(gpuPackage,variantId,requests,{onResult:()=>{throw Error('Export failed');}}),/Export failed/);assert.equal(workers.length,2);
});
test('absence of the GPU API starts directly on WASM',async t=>{
    gpuNavigator(t);delete globalThis.navigator.gpu;const workers=fakeWorker(t,reply);
    const result=await new ConformanceWorker().analyze(gpuPackage,variantId,requests[0]);
    assert.equal(workers.length,1);assert.equal(result.backend,'wasm');assert.equal(result.fallbackReason,'webgpu-unavailable');
});
test('GPU provenance requires the qualified policy and exact transformed graph identity',async()=>{
    const bpsd=JSON.parse(readFileSync(new URL('../../deployment/production-model-catalog.json',import.meta.url))).entries[1];
    const p={manifest:bpsd.manifest,manifestHash:bpsd.revision},v=p.manifest.variants[0];
    const result={manifestHash:p.manifestHash,variantId:v.id,kind:v.codec,precision:v.precision,backend:'webgpu'};
    assert.throws(()=>modelRunProvenance(p,v.id,result),/runtime/);
    result.executionPolicy=EXECUTION_POLICY;
    assert.throws(()=>modelRunProvenance(p,v.id,result),/transformation/);
    result.graphTransforms=graphTransforms(p.manifest,v,'webgpu');
    assert.equal(modelRunProvenance(p,v.id,result).runtime.backend,'webgpu');
    assert.deepEqual(graphTransforms(p.manifest,v,'wasm'),[]);
    result.graphTransforms[0].targetSha256='0'.repeat(64);
    assert.throws(()=>modelRunProvenance(p,v.id,result),/transformation/);
    await assert.rejects(prepareGraph(p.manifest,{...v,backend:'webgpu'},v.graphs.attributes,new Uint8Array([1,2,3])),/source hash mismatch/);
});

function fp16Package(){
    const manifest=structuredClone(entry.manifest),v=manifest.variants[0];
    Object.assign(v,{id:'webgpu-fp16',precision:'fp16',backend:'webgpu'});
    Object.assign(manifest.files.find(f=>f.path===v.graph),{sha256:'bdf43a9185bf5562335b8d54b54bd81256e09a4b444080312e27afc3f0c97333',bytes:371444227});
    return {manifest,manifestHash:'f'.repeat(64),files:new Map()};
}
test('FP16 selects a qualified package without a GPU and pins the original WASM fallback',()=>{
    const pkg=fp16Package(),v=pkg.manifest.variants[0];validateModelManifest(pkg.manifest);
    assert.equal(selectInferenceVariant(pkg,'occurrence-record',{webgpuAvailable:false}).id,v.id);
    assert.deepEqual(wasmFallbackIdentity(pkg.manifest,v),{manifestHash:entry.revision,variantId});
    pkg.manifest.files.find(f=>f.path===v.graph).sha256='0'.repeat(64);
    assert.equal(wasmFallbackIdentity(pkg.manifest,v),null);
    assert.throws(()=>validateModelManifest(pkg.manifest),/not qualified/);
});
test('FP16 failure resolves the original FP32 package and reports its actual precision',async t=>{
    gpuNavigator(t);const pkg=fp16Package(),events=[];let resolved=0;
    const workers=fakeWorker(t,(m,w)=>m.task==='load'&&m.backend==='webgpu'?{error:'No shader-f16'}:reply(m,w));
    const runner=new ConformanceWorker();
    const result=await runner.analyze(pkg,'webgpu-fp16',requests[0],{resolveFallback:async target=>{resolved++;assert.equal(target.manifestHash,entry.revision);return gpuPackage;},onBackend:e=>events.push(e)});
    assert.equal(resolved,1);assert.equal(workers[1].messages[0].manifestHash,entry.revision);
    assert.equal(workers[1].messages[0].variantId,variantId);
    assert.equal(events.at(-1).precision,'fp32');assert.equal(events.at(-1).packageData,gpuPackage);
    assert.deepEqual(result.fallbackFrom,{manifestHash:pkg.manifestHash,variantId:'webgpu-fp16',precision:'fp16'});
    assert.equal(result.fallbackReason,'webgpu-initialization-failed');
});
test('FP16 starts directly on the original FP32 for CPU choice or no GPU; forged fallback is rejected',async t=>{
    gpuNavigator(t);delete globalThis.navigator.gpu;const workers=fakeWorker(t,reply),pkg=fp16Package();
    for(const backend of ['auto','wasm']){
        const result=await new ConformanceWorker().analyze(pkg,'webgpu-fp16',requests[0],{backend,resolveFallback:async()=>gpuPackage});
        assert.equal(result.backend,'wasm');
    }
    assert.equal(workers.length,2);assert.ok(workers.every(w=>w.messages[0].manifestHash===entry.revision));
    await assert.rejects(new ConformanceWorker().analyze(pkg,'webgpu-fp16',requests[0],{resolveFallback:async()=>({...gpuPackage,manifestHash:'0'.repeat(64)})}),/identity mismatch/);
    assert.equal(workers.length,2);
});
test('cancelling FP16 fallback loading never starts the downloaded model',async t=>{
    gpuNavigator(t);delete globalThis.navigator.gpu;const workers=fakeWorker(t,reply),runner=new ConformanceWorker();
    await assert.rejects(runner.analyze(fp16Package(),'webgpu-fp16',requests[0],{resolveFallback:async()=>{runner.cancel();return gpuPackage;}}),/Cancelled/);
    assert.equal(workers.length,0);
});
test('fallback resolution holds the runner lock until its pending request finishes',async t=>{
    gpuNavigator(t);delete globalThis.navigator.gpu;fakeWorker(t,reply);
    const runner=new ConformanceWorker();let resolve;
    const pending=runner.analyze(fp16Package(),'webgpu-fp16',requests[0],{resolveFallback:()=>new Promise(done=>{resolve=done;})});
    await assert.rejects(runner.analyze(gpuPackage,variantId,requests[1]),/One model worker/);
    resolve(gpuPackage);await pending;
    assert.equal((await runner.analyze(gpuPackage,variantId,requests[1])).backend,'wasm');
});
