import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadWasmFallback} from '../../src/nextmedtator/model-fallback.mjs';

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
