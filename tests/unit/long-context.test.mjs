import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planLongContext,scanLongContext,mergeWindowRecords} from '../../src/nextmedtator/long-context.mjs';
import {splitContractWords} from '../../src/nextmedtator/entity-contract.mjs';
import {OffsetMap} from '../../src/nextmedtator/integrity.mjs';
const pack=text=>({supported:splitContractWords(text).length<=12,encodedTokens:splitContractWords(text).length+5});
test('window planning retains all Unicode source, prompt budget and progress',async()=>{
    const text='  😀 alpha fever.\n\n'+Array(12).fill('one two three four.').join(' ')+' final fever.  ';
    const windows=planLongContext(text,{split:splitContractWords,pack,maxWords:12,chunkWords:12,wordOverlap:3});
    assert.ok(windows.length>1);assert.equal(windows[0].start,0);assert.equal(windows.at(-1).end,text.length);
    windows.forEach((w,i)=>{assert.ok(pack(text.slice(w.start,w.end)).supported);if(i)assert.ok(w.start<windows[i-1].end&&w.end>windows[i-1].end);});
    let active=0,maximum=0;const progress=[];
    const result=await scanLongContext(text,windows,async chunk=>{active++;maximum=Math.max(maximum,active);await Promise.resolve();const map=new OffsetMap(chunk);active--;return {status:'complete',records:[...chunk.matchAll(/fever/g)].map(m=>({id:'x',family:'finding',anchor:[map.selection(m.index,m.index+5)],fields:{assertion:'present'},score:.9}))};},{overlapPolicy:'allow',onProgress:p=>progress.push(p)});
    assert.equal(maximum,1);assert.equal(result.records.length,2);const source=new OffsetMap(text);for(const r of result.records)assert.equal(source.slice(r.anchor[0].start,r.anchor[0].end),'fever');
    assert.deepEqual(result.coverage,[[0,source.length]]);assert.equal(progress.at(-1).completed,windows.length);
});
test('unencodable tokens fail explicitly; short notes preserve one complete window',()=>{
    assert.throws(()=>planLongContext('word',{split:splitContractWords,pack:()=>({supported:false})}),/exceeds/);
    assert.deepEqual(planLongContext('fever.',{split:splitContractWords,pack}),[{start:0,end:6,wordStart:0,wordEnd:2,encodedTokens:7}]);
});
test('overlap merge preserves distinct positions and keeps winning attributes intact',()=>{
    const row=(start,end,score,value)=>({family:'finding',anchor:[{start,end,text:'x'}],score,fields:{assertion:value}});
    const rows=[row(0,2,.8,'present'),row(0,2,.9,'negated'),row(1,3,.7,'present'),row(5,7,.6,'present')];
    assert.equal(mergeWindowRecords(rows,'allow').length,3);
    const flat=mergeWindowRecords(rows,'flat');assert.equal(flat.length,2);assert.equal(flat[0].fields.assertion,'negated');
});
