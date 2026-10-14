import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadWasmFallback} from '../../src/nextmedtator/model-fallback.mjs';
import {cacheModelForSession,ModelStorageError} from '../../src/nextmedtator/model-store.mjs';

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
