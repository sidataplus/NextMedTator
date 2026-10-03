import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateModelManifest,qualifyForSchema} from '../../src/nextmedtator/model-package.mjs';
import {RECORDS_CODEC,SMALL_CODEC,analyzeSmall} from '../../src/nextmedtator/gliner-small.mjs';
import {GlinerBoundaryRuntime} from '../../src/nextmedtator/vendor/gliner25/gliner-boundary.mjs';
import {clone} from '../../src/nextmedtator/integrity.mjs';

const schema={id:'s',version:'1',families:{diagnosis:{label:'diagnosis',fields:{concept:{type:'text'}}}}};
function manifest(){
 const graphs={model:'model.onnx',attributes:'attributes.onnx',records:'records.onnx',relations:'relations.onnx'};
 return {format:'nextmedtator-model-v1',id:'arbitrary-adapter',version:'1',runtime:'onnxruntime-web',runtimeVersion:'1.23.2',
  lineage:{base:{model:'fastino/gliner2.5-base-v1',revision:'a'.repeat(40)},adapter:{sha256:'b'.repeat(64),baseRevision:'a'.repeat(40)},merge:'merged-export',trainedHeads:'unchanged'},
  license:{id:'LicenseRef-User-Provided',notice:'Synthetic test; no weights'},capabilities:['*'],
  files:[...Object.values(graphs).map(path=>({path,role:'graph'})),{path:'tokenizer.json',role:'tokenizer'},{path:'reference.json',role:'fixture'}].map(row=>({...row,bytes:1,sha256:'c'.repeat(64)})),
  variants:[{id:'wasm',backend:'wasm',precision:'fp32',codec:RECORDS_CODEC,graph:graphs.model,graphs,tokenizer:'tokenizer.json',fixtures:['reference.json'],pairTemperature:1,fixedWords:512,maxSequenceLength:512,abstentionThreshold:.5,automaticRelations:false}]};
}
test('generic record packages require immutable merged-adapter lineage and the source padding/abstention contract',()=>{
 const good=manifest();validateModelManifest(good);assert.equal(qualifyForSchema({manifest:good},schema).level,'occurrence-record');
 for(const edit of [m=>delete m.lineage.adapter,m=>m.lineage.merge='equivalent-graph',m=>m.variants[0].fixedWords=8,m=>delete m.variants[0].abstentionThreshold,m=>m.variants[0].automaticRelations=true]){
  const bad=clone(good);edit(bad);assert.throws(()=>validateModelManifest(bad));
 }
});
test('new GLiNER codec honors source abstention and records its own identity; existing small decoding stays compatible',async()=>{
 let nullLogit=10;
 const api={rt:{tokenizer:{encodeIds:()=>[1]},computeMarginals:async()=>({normalized:'diabetes',words:[{text:'diabetes',start:0,end:8}],
  pairIndices:BigInt64Array.from([0n,1n]),pairLogits:new Float32Array([10]),pairValid:new Uint8Array([1]),candidateCount:1,pairTemperature:1,
  nullLogits:new Float32Array([nullLogit]),queryStates:{dims:[1,1,4],data:new Float32Array(4)}})}};
 assert.equal((await analyzeSmall(api,'diabetes',schema,{codec:RECORDS_CODEC})).records.length,0);
 nullLogit=-10;const result=await analyzeSmall(api,'diabetes',schema,{codec:RECORDS_CODEC});
 assert.deepEqual(result.records[0].anchor,[{start:0,end:8,text:'diabetes'}]);assert.equal(result.records[0].origin.codec,RECORDS_CODEC);
 nullLogit=10;assert.equal((await analyzeSmall(api,'diabetes',schema,{codec:SMALL_CODEC})).records.length,1);
});
test('fixed word padding preserves actual note words and masks every added position',async()=>{
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}}
 let feeds;
 const runtime=new GlinerBoundaryRuntime({ort:{Tensor},fixedWords:512,tokenize:()=>[1],session:{inputNames:[],outputNames:[],run:async input=>{
  feeds=input;return {start_logits:{data:new Float32Array(513)},end_logits:{data:new Float32Array(513)},pair_logits:{dims:[1,1,1],data:new Float32Array(1)},
   pair_indices:{data:BigInt64Array.from([0n,1n])},pair_valid:{data:new Uint8Array([1])},null_logits:{data:new Float32Array([-1])}};
 }}});
 const marg=await runtime.computeMarginals('Diabetes.', ['diagnosis']);
 assert.equal(marg.words.length,2);assert.deepEqual(feeds.text_word_mask.dims,[1,512]);
 assert.deepEqual(Array.from(feeds.text_word_mask.data.slice(0,4)),[1,1,0,0]);
 assert.equal(feeds.text_word_mask.data.reduce((a,b)=>a+b),2);
 assert.ok(Array.from(feeds.text_word_indices.data.slice(2)).every(value=>value===0n));
 assert.deepEqual(Array.from(marg.nullLogits),[-1]);
});
