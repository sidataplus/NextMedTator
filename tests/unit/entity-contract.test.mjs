import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateEntityContract,entityContractPrompt,packEntityContract,splitContractWords,decodeContractEntities,selectContractAttribute,analyzeEntityContract,compareEntityContractRecords,entityContractSchema,schemaFromEntityContract} from '../../src/nextmedtator/entity-contract.mjs';
const contract=()=>JSON.parse(readFileSync(new URL('../fixtures/entity-contract.json',import.meta.url)));
test('fixed contract retains ordered native prompts and rejects unsupported semantics',()=>{
 const c=contract();assert.equal(validateEntityContract(c),c);
 assert.deepEqual(entityContractPrompt(c).labels,['action','report','owner: other','owner: subject','phase: earlier','phase: later']);
 assert.deepEqual(entityContractPrompt(c).groups[0].choices.map(c=>c.value),['later','earlier']);
 for(const mutate of [c=>c.contextPolicy='window',c=>c.attributes[0].selection='multiple',c=>c.attributes[0].appliesTo=['owner: subject'],c=>c.attributes[0].labels[1].label=c.attributes[0].labels[0].label,c=>c.maxEncodedTokens=2048]){const bad=contract();mutate(bad);assert.throws(()=>validateEntityContract(bad));}
});
test('word offsets preserve original Unicode, repeated text, URLs and case expansion',()=>{
 const text='İ Café 👩‍⚕️ repeat repeat https://example.test/a_b?q=1 @owner a-b';
 const words=splitContractWords(text);assert.equal(words.filter(w=>w.text==='repeat').length,2);assert.equal(words.find(w=>w.text.startsWith('https')).text,'https://example.test/a_b?q=1');assert.equal(words[0].text,'i\u0307');for(const w of words)assert.equal(text.slice(w.start,w.end).toLowerCase(),w.text);
});
test('complete schema consumes the budget and oversized input never reaches the graph',async()=>{
 const c=contract(),tokenize=()=>[1],prefix=packEntityContract('word.',c,tokenize).encodedTokens-2;
 const at=packEntityContract(Array(1024-prefix-1).fill('word').join(' ') + '.',c,tokenize);assert.equal(at.encodedTokens,1024);assert.equal(at.supported,true);
 const over=Array(1024-prefix).fill('word').join(' ')+'.';let called=false;const api={rt:{_tokenize:tokenize,computeMarginals:async()=>{called=true;throw Error('must not infer');}}};
 const result=await analyzeEntityContract(api,over,schemaFromEntityContract(c),c,{});assert.equal(called,false);assert.equal(result.status,'unsupported');assert.equal(result.encodedTokens,1025);assert.deepEqual(result.records,[]);assert.deepEqual(result.coverage,[]);
});
test('allow retains nested and crossing spans, highest exact duplicates and threshold equality',()=>{
 const c=contract(),text='one two three',words=splitContractWords(text),marg={candidateCount:5,words,pairTemperature:1,abstentionThreshold:.5,nullLogits:[-10,-10],pairIndices:BigInt64Array.from([0,2,0,1,1,3,0,2,0,3, 0,2,0,0,0,0,0,0,0,0].map(BigInt)),pairLogits:Float32Array.from([1,0,2,3,-1, 0,0,0,0,0]),pairValid:Uint8Array.from([1,1,1,1,1,1,0,0,0,0])};
 const rows=decodeContractEntities(marg,c,text);assert.equal(rows.length,4);assert.deepEqual(rows.map(r=>[r.family,r.wordStart,r.wordEnd]),[['action',0,2],['action',1,3],['action',0,1],['report',0,2]]);
 c.overlapPolicy='flat';assert.ok(decodeContractEntities(marg,c,text).length<4);
});
test('single attributes force softmax without defaults and keep source choice tie order',()=>{
 const choices=entityContractPrompt(contract()).groups[0].choices;
 assert.deepEqual(selectContractAttribute([-1000,-1000],choices),{value:'later',score:.5});
 assert.equal(selectContractAttribute([-5,5],choices).value,'earlier');
 const schema=schemaFromEntityContract(contract());schema.families.report.fields.phase={type:'enum',values:['later','earlier'],default:'later'};
 const projection=entityContractSchema(schema,contract());assert.equal(Object.hasOwn(projection.families.report.fields,'phase'),false);assert.equal(schema.families.report.fields.phase.default,'later');
});
test('native/browser record comparison checks missing fields, applicability and score tolerance',()=>{
 const row={family:'report',anchor:[{start:0,end:6,text:'report'}],fields:{owner:'subject'},score:.9,attributeScores:{owner:.7}};
 const actual=structuredClone(row);actual.score+=1e-5;assert.equal(compareEntityContractRecords([row],[actual]).pass,true);
 actual.fields.phase='later';assert.equal(compareEntityContractRecords([row],[actual]).pass,false);delete actual.fields.phase;actual.attributeScores.owner=.8;assert.equal(compareEntityContractRecords([row],[actual]).pass,false);
});
