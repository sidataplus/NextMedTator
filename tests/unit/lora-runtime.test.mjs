import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateModelManifest,qualifyForSchema,selectInferenceVariant} from '../../src/nextmedtator/model-package.mjs';
import {RECORDS_CODEC,SMALL_CODEC,analyzeSmall} from '../../src/nextmedtator/gliner-small.mjs';
import {GlinerBoundaryRuntime,cropWordStates} from '../../src/nextmedtator/vendor/gliner25/gliner-boundary.mjs';
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
test('original GLiNER exports declare unchanged heads and cannot masquerade as adapters',()=>{
 const original=manifest();delete original.lineage.adapter;original.lineage.merge='unadapted-export';
 validateModelManifest(original);
 assert.equal(qualifyForSchema({manifest:original},schema).level,'occurrence-record');
 const trained=clone(original);trained.lineage.trainedHeads='d'.repeat(64);
 assert.throws(()=>validateModelManifest(trained),/Unadapted export/);
 const adapted=clone(original);adapted.lineage.adapter=manifest().lineage.adapter;
 assert.throws(()=>validateModelManifest(adapted),/LoRA package/);
 const clinical=clone(original);clinical.variants[0].codec='gliner25-clinical-v3-spans-v1';
 assert.throws(()=>validateModelManifest(clinical),/explicit merged adapter/);
});
test('mixed record codecs choose an available variant before selecting its decoder',()=>{
 const m=manifest(), generic={...m.variants[0],id:'generic-gpu',backend:'webgpu'};
 const small={...m.variants[0],id:'small-wasm',codec:SMALL_CODEC};
 m.variants=[generic,small];validateModelManifest(m);
 const level=qualifyForSchema({manifest:m},schema).level;
 assert.equal(selectInferenceVariant({manifest:m},level,{webgpuAvailable:false}),small);
 assert.equal(selectInferenceVariant({manifest:m},level,{webgpuAvailable:true}),small);
 m.variants=[generic];
 assert.throws(()=>selectInferenceVariant({manifest:m},level,{webgpuAvailable:false}),/No browser/);
 assert.equal(selectInferenceVariant({manifest:m},level,{webgpuAvailable:true}),generic);
 m.variants=[{...small,backend:'webgpu'}, {...generic,id:'generic-wasm',backend:'wasm'}];
 assert.equal(selectInferenceVariant({manifest:m},level,{webgpuAvailable:false}).codec,RECORDS_CODEC);
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
 assert.deepEqual(marg.textWordMask,feeds.text_word_mask.data);
});

test('attribute scoring retains the real word mask for padded and unpadded codecs',async()=>{
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}}
 for(const fixedWords of [0,512]){
  let attributeFeeds;
  const runtime=new GlinerBoundaryRuntime({ort:{Tensor},fixedWords,tokenize:()=>[1],
   session:{inputNames:[],outputNames:[],run:async input=>{
    const length=input.text_word_mask.dims[1];
    return {start_logits:{data:new Float32Array(length+1)},end_logits:{data:new Float32Array(length+1)},
     text_states:{dims:[1,length,2],data:Float32Array.from({length:length*2},(_,i)=>i<4?i+1:99)},
     query_states:{dims:[1,2,2],data:new Float32Array(4)}};
   }},attrsSession:{run:async feeds=>{
    attributeFeeds=feeds;
    // Make decoding depend on the mask so this verifies the downstream path.
    const logits=new Float32Array(8*16);
    logits[16]=feeds.text_word_mask.data.reduce((a,b)=>a+b)===2?5:-5;
    return {attr_logits:{data:logits}};
   }}});
  const marg=await runtime.computeMarginals('Diabetes.', ['present','absent']);
  const [entity]=await runtime.scoreExplicitAttributes('Diabetes.',[{wordStart:0,wordEnd:1}],['present','absent'],{marg});
  assert.deepEqual(Array.from(attributeFeeds.text_word_mask.data.slice(0,4)),[1,1,0,0]);
  assert.equal(attributeFeeds.text_word_mask.data.reduce((a,b)=>a+b),2);
  assert.deepEqual(Array.from(attributeFeeds.text_states.data.slice(0,6)),[1,2,3,4,0,0]);
  assert.equal(entity.attribute,'absent');
 }
});

test('attribute crops preserve masked gaps and use the real end for long padded states',()=>{
 const states={dims:[1,1024,1],data:Float32Array.from({length:1024},(_,i)=>i)};
 const mask=new Float32Array(1024);mask.fill(1,0,600);mask[350]=0;
 const crop=cropWordStates(states,[{wordStart:590,wordEnd:600}],512,mask);
 assert.equal(crop.origin,88);
 assert.deepEqual(crop.mask,mask.slice(88,600));
 assert.equal(crop.ts.at(-1),599);
 assert.throws(()=>cropWordStates(states,[],512,new Float32Array(2)),/mask does not match/);
});
