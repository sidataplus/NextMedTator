import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectDevice,deviceRecommendation} from '../../src/nextmedtator/device-profile.mjs';
test('recommendations use capabilities, respect CPU choice and avoid recommending experimental INT8',async()=>{
    const device=await detectDevice({hardwareConcurrency:20,deviceMemory:8,gpu:{requestAdapter:async()=>({features:new Set(['shader-f16'])})}});
    assert.equal(deviceRecommendation(device).precision,'fp16');
    assert.equal(deviceRecommendation(device,{execution:'wasm'}).precision,'fp32');
    assert.equal(deviceRecommendation({...device,fp16:false}).precision,'fp32');
    assert.match(deviceRecommendation({...device,memory:2}).caution,/limited memory/);
});
test('missing, rejected and stalled GPU detection safely resolves to CPU',async()=>{
    for(const nav of [{},{gpu:{requestAdapter:async()=>{throw Error('blocked');}}},{gpu:{requestAdapter:()=>new Promise(()=>{})}}]){
        const device=await detectDevice(nav,5);assert.equal(device.gpu,false);assert.equal(deviceRecommendation(device).precision,'fp32');
    }
});
