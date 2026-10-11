import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestionThreshold} from '../../src/nextmedtator/threshold.mjs';

test('user threshold takes precedence without changing frozen model or scope defaults',()=>{
    const model=Object.freeze({threshold:.6}),scope=Object.freeze({threshold:.7});
    assert.deepEqual(suggestionThreshold(null,null,model),{threshold:.6,thresholdSource:'model'});
    assert.deepEqual(suggestionThreshold(null,scope,model),{threshold:.7,thresholdSource:'scope'});
    const run=Object.freeze(suggestionThreshold('0.9',scope,model));
    assert.deepEqual(suggestionThreshold('0',scope,model),{threshold:0,thresholdSource:'user'});
    assert.equal(suggestionThreshold('1',scope,model).threshold,1);
    assert.equal(run.threshold,.9);
    assert.equal(scope.threshold,.7);
    assert.equal(model.threshold,.6);
});
test('invalid input cannot silently become zero or run with a default',()=>{
    for(const value of ['', ' ', 'abc', 'NaN', 'Infinity', -.01, 1.01, NaN, Infinity, false])
        assert.throws(()=>suggestionThreshold(value,null,{threshold:.6}),/between 0 and 1/);
    assert.equal(suggestionThreshold(null,null,{}).threshold,.5);
});


test('selected clinical releases retain their frozen model threshold across user and scope overrides',()=>{
 for(const threshold of [.6,.7]){
  const variant={threshold,clinicalRelease:{coreThreshold:threshold}};
  assert.deepEqual(suggestionThreshold(.2,{threshold:.9},variant),{threshold,thresholdSource:'model'});
 }
});


test('threshold display resolves the selected WASM variant regardless of package order', async()=>{
 const {selectInferenceVariant}=await import('../../src/nextmedtator/model-package.mjs');
 const release={id:'gpu-release',backend:'webgpu',codec:'gliner25-clinical-v3-spans-v1',threshold:.7,clinicalRelease:{coreThreshold:.7}};
 const regular={id:'cpu-records',backend:'wasm',codec:'gliner25-records-v1',threshold:.4};
 for(const variants of [[release,regular],[regular,release]]){
  const selected=selectInferenceVariant({manifest:{variants}},'occurrence-record',{webgpuAvailable:true});
  assert.equal(selected.id,'cpu-records');
  assert.deepEqual(suggestionThreshold(.2,{threshold:.8},selected),{threshold:.2,thresholdSource:'user'});
 }
 const cpuRelease={...release,id:'cpu-release',backend:'wasm'};
 const gpuRegular={...regular,id:'gpu-records',backend:'webgpu'};
 const selected=selectInferenceVariant({manifest:{variants:[gpuRegular,cpuRelease]}},'occurrence-record',{webgpuAvailable:true});
 assert.deepEqual(suggestionThreshold(.2,{threshold:.8},selected),{threshold:.7,thresholdSource:'model'});
});
