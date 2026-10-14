import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {loadWasmFallback} from '../../src/nextmedtator/model-fallback.mjs';
import {cacheModelForSession,ModelIntegrityError,ModelStorageError} from '../../src/nextmedtator/model-store.mjs';
import {fingerprint,sha256} from '../../src/nextmedtator/integrity.mjs';

async function fallbackCatalog(t,downloadBytes){
    const bytes=new TextEncoder().encode('verified model artifact');
    const manifest={format:'nextmedtator-model-v1',id:'synthetic-tensor-fixture',version:'1',runtime:'onnxruntime-web',runtimeVersion:'1.23.2',lineage:{base:{model:'synthetic-only',revision:'a'.repeat(40)}},license:{id:'MIT',notice:'Test bytes; no model inference'},files:[{path:'test.onnx',bytes:bytes.length,sha256:await sha256(bytes),role:'graph'},{path:'reference.json',bytes:bytes.length,sha256:await sha256(bytes),role:'fixture'}],variants:[{id:'wasm',backend:'wasm',precision:'fp32',codec:'tensor-conformance-v1',graph:'test.onnx',fixtures:['reference.json']}],capabilities:[]};
    const revision=await fingerprint(manifest),entry={revision,manifest,urls:Object.fromEntries(manifest.files.map(file=>[file.path,`./models/${file.path}`]))};
    const previousLocation=globalThis.location,previousDocument=globalThis.document;
    globalThis.location={href:'https://app.example.org/'};globalThis.document=parseHTML('<html><body></body></html>').document;
    t.after(()=>{if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
    let requests=0;
    t.mock.method(globalThis,'fetch',async()=>{requests++;return new Response(downloadBytes??bytes);});
    return {bytes,entry,revision,requests:()=>requests};
}

test('storage failure keeps the verified candidate for this session; cancellation and corruption do not',async()=>{
    const candidate={manifestHash:'verified'},owner={modelStore:{install:async()=>{throw new ModelStorageError(new DOMException('Full','QuotaExceededError'));}}};
    assert.equal(await cacheModelForSession(owner,candidate),candidate);
    assert.match(owner.modelStorageNotice,/this session/);
    owner.modelStore.install=async()=>{throw new Error('Installed model read-back verification failed');};
    await assert.rejects(cacheModelForSession(owner,candidate),/verification failed/);
    const controller=new AbortController();
    owner.modelStore.install=async()=>{controller.abort();throw new ModelStorageError(new Error('Interrupted'));};
    await assert.rejects(cacheModelForSession(owner,candidate,{signal:controller.signal}),{name:'AbortError'});
});

test('session-only fallback is reused without storage or downloads; offline verification still requires storage',async()=>{
    const model={manifestHash:'session'},owner={model,modelStore:{listExisting:async()=>{throw new DOMException('Disabled','SecurityError');}}};
    assert.equal(await loadWasmFallback(owner,{manifestHash:'session'}),model);
    await assert.rejects(loadWasmFallback(owner,{manifestHash:'session'},{offline:true}),/Install the original FP32/);
});

test('installed FP32 fallback is reused without catalog or network access',async()=>{
    const candidate={manifestHash:'known'},owner={modelStore:{listExisting:async()=>[{manifestHash:'known'}],read:async hash=>{assert.equal(hash,'known');return candidate;}}};
    assert.equal(await loadWasmFallback(owner,{manifestHash:'known'}),candidate);
    assert.equal(owner.catalog,undefined);assert.equal(owner.installController,undefined);
});
test('offline readiness never starts a missing fallback download',async()=>{
    const owner={modelStore:{listExisting:async()=>[]}};
    await assert.rejects(loadWasmFallback(owner,{manifestHash:'missing'},{offline:true}),/Install the original FP32/);
    assert.equal(owner.installController,undefined);
});
test('missing approved fallback fails before artifact requests',async()=>{
    const owner={modelStore:{listExisting:async()=>[]},catalog:{entries:[]}};
    await assert.rejects(loadWasmFallback(owner,{manifestHash:'missing'}),/approved FP32 fallback/);
    assert.equal(owner.installController,undefined);
});

test('online fallback replaces a missing or corrupt installed package from its exact catalog entry',async t=>{
    const fixture=await fallbackCatalog(t);
    const corrupt=new ModelIntegrityError();
    let readCount=0,installed=[];
    const owner={catalog:{entries:[fixture.entry]},root:parseHTML('<div></div>').document.body,render(){},modelStore:{
        listExisting:async()=>[{manifestHash:fixture.revision}],
        read:async()=>++readCount===1?Promise.reject(corrupt):null,
        install:async candidate=>{installed.push(candidate);return candidate;}
    }};
    // Both a typed integrity failure and a stale row whose artifact vanished need
    // a new copy of the same immutable catalog revision.
    const restored=await loadWasmFallback(owner,{manifestHash:fixture.revision});
    assert.equal(restored.manifestHash,fixture.revision);
    assert.deepEqual([...restored.files.get('test.onnx')], [...fixture.bytes]);
    assert.equal(fixture.requests(),2);
    assert.equal(installed.length,1);
    assert.equal(readCount,1);
    owner.modelStore.read=async()=>null;
    const restoredMissing=await loadWasmFallback(owner,{manifestHash:fixture.revision});
    assert.equal(restoredMissing.manifestHash,fixture.revision);
    assert.equal(fixture.requests(),4);
    assert.equal(installed.length,2);
});

test('corrupt installed fallback is not downloaded while offline',async t=>{
    const fixture=await fallbackCatalog(t);
    const corrupt=new ModelIntegrityError();
    let installs=0;
    const owner={catalog:{entries:[fixture.entry]},modelStore:{listExisting:async()=>[{manifestHash:fixture.revision}],read:async()=>{throw corrupt;},install:async()=>{installs++;}}};
    await assert.rejects(loadWasmFallback(owner,{manifestHash:fixture.revision},{offline:true}),error=>error instanceof ModelIntegrityError&&/Offline FP32 fallback is corrupt/.test(error.message)&&error.cause===corrupt);
    assert.equal(fixture.requests(),0);
    assert.equal(installs,0);
});

test('online fallback does not turn unrelated storage errors into a download',async t=>{
    const fixture=await fallbackCatalog(t);
    const failure=new DOMException('IndexedDB connection failed','UnknownError');
    const owner={catalog:{entries:[fixture.entry]},modelStore:{listExisting:async()=>[{manifestHash:fixture.revision}],read:async()=>{throw failure;},install:async()=>{assert.fail('must not replace after an operational read error');}}};
    await assert.rejects(loadWasmFallback(owner,{manifestHash:fixture.revision}),error=>error===failure);
    assert.equal(fixture.requests(),0);
});

test('online fallback propagates unrelated installed-list errors',async t=>{
    const fixture=await fallbackCatalog(t);
    const failure=new DOMException('IndexedDB query failed','UnknownError');
    const owner={catalog:{entries:[fixture.entry]},modelStore:{listExisting:async()=>{throw failure;},read:async()=>{assert.fail('must not read after list failure');}}};
    await assert.rejects(loadWasmFallback(owner,{manifestHash:fixture.revision}),error=>error===failure);
    assert.equal(fixture.requests(),0);
});

test('storage security denial still permits session-only online fallback',async t=>{
    const fixture=await fallbackCatalog(t);
    let installed;
    const owner={catalog:{entries:[fixture.entry]},root:parseHTML('<div></div>').document.body,render(){},modelStore:{
        listExisting:async()=>{throw new DOMException('Storage is blocked','SecurityError');},
        install:async candidate=>{installed=candidate;return candidate;}
    }};
    const result=await loadWasmFallback(owner,{manifestHash:fixture.revision});
    assert.equal(result.manifestHash,fixture.revision);
    assert.equal(installed,result);
    assert.equal(fixture.requests(),2);
});

test('non-R2 catalog revision mismatch is rejected before storage',async t=>{
    const fixture=await fallbackCatalog(t);
    fixture.entry.manifest={...fixture.entry.manifest,version:'2'};
    let installs=0;
    const owner={catalog:{entries:[fixture.entry]},root:parseHTML('<div></div>').document.body,render(){},modelStore:{listExisting:async()=>[],install:async()=>{installs++;}}};
    await assert.rejects(loadWasmFallback(owner,{manifestHash:fixture.revision}),/does not match the requested catalog revision/);
    assert.equal(fixture.requests(),2);
    assert.equal(installs,0);
});

test('online fallback rejects corrupt downloaded bytes before installing them',async t=>{
    const corruptBytes=new TextEncoder().encode('x'.repeat(new TextEncoder().encode('verified model artifact').length));
    const fixture=await fallbackCatalog(t,corruptBytes);
    let installs=0;
    const owner={catalog:{entries:[fixture.entry]},root:parseHTML('<div></div>').document.body,render(){},modelStore:{listExisting:async()=>[],install:async()=>{installs++;}}};
    await assert.rejects(loadWasmFallback(owner,{manifestHash:fixture.revision}),/Artifact hash mismatch/);
    assert.equal(fixture.requests(),1);
    assert.equal(installs,0);
});
