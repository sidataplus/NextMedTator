import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportCollection,exportCollectionBlob,importCollectionBackup,collectionLines} from '../../src/nextmedtator/collection-backup.mjs';
import {sha256,fingerprint} from '../../src/nextmedtator/integrity.mjs';

const keyFor=(name,text)=>name+':'+text.length;
async function fixture(){
    const ann={_filename:'fictional.txt',text:'Fictional 😀 note',tags:[]};ann._diskKey=keyFor(ann._filename,ann.text);
    const sourceHash=await sha256(ann.text),row={key:ann._diskKey,sourceHash,ann,project:null,run:null};
    const meta={id:'original',name:'Synthetic',dtd:{},settings:{mode:'assisted',longContext:false},notes:[{_filename:ann._filename,_diskKey:row.key,sourceHash}],queue:null};
    let data='';await exportCollection({note:async()=>row},meta,{write:async s=>{data+=s;},close:async()=>{}});
    const saved=[],removed=[];const store={create:async(dtd,name)=>({id:'restored',name,dtd,notes:[]}),commit:async(meta,row)=>{if(row)saved.push(row);},remove:async id=>removed.push(id)};
    return {data,store,saved,removed,meta,row};
}

test('browser download preserves streaming format and enforces exact UTF-8 byte limit',async()=>{
    const f=await fixture(),source={note:async()=>f.row},bytes=new Blob([f.data]).size;
    const blob=await exportCollectionBlob(source,f.meta,{maxBytes:bytes});
    assert.equal(await blob.text(),f.data);assert.equal(blob.size,bytes);
    await importCollectionBackup(f.store,blob,{keyFor});assert.equal(f.saved[0].ann.text,'Fictional 😀 note');
    await assert.rejects(exportCollectionBlob(source,f.meta,{maxBytes:bytes-1}),/Browser backup exceeds/);
    assert.equal(f.meta.notes.length,1);assert.deepEqual(f.removed,[]);
});

test('cancelled browser backup produces no file and streamed writer aborts',async()=>{
    const f=await fixture(),controller=new AbortController();let aborted=false,closed=false;
    await assert.rejects(exportCollectionBlob({note:async()=>f.row},f.meta,{signal:controller.signal,onProgress:()=>controller.abort()}),/cancelled/);
    await assert.rejects(exportCollection({note:async()=>{throw Error('must not read');}},f.meta,{write:async()=>{},abort:async()=>{aborted=true;},close:async()=>{closed=true;}},{signal:controller.signal}),/cancelled/);
    assert.equal(aborted,true);assert.equal(closed,false);
});
test('streamed collection backup preserves note identity and settings',async()=>{
    const f=await fixture();const meta=await importCollectionBackup(f.store,new Blob([f.data]),{keyFor});
    assert.equal(f.saved.length,1);assert.equal(meta.settings.longContext,false);assert.equal(meta.notes.length,1);assert.deepEqual(f.removed,[]);
});
test('truncation and inconsistent metadata reject and clean only the partial import',async()=>{
    for(const corrupt of ['truncate','metadata']){
        const f=await fixture();let data=f.data;
        if(corrupt==='truncate')data=data.split('\n').slice(0,2).join('\n');
        else{const lines=data.trim().split('\n').map(JSON.parse);lines[0].meta.notes[0].sourceHash='bad';lines[0].hash=await fingerprint(lines[0].meta);data=lines.map(JSON.stringify).join('\n');}
        await assert.rejects(importCollectionBackup(f.store,new Blob([data]),{keyFor}));assert.deepEqual(f.removed,['restored']);
    }
});
test('stream parser preserves Unicode across byte boundaries and rejects invalid UTF-8',async()=>{
    const bytes=new TextEncoder().encode('one 😀\ntwo\n');const file={stream:()=>new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}})};
    const lines=[];for await(const line of collectionLines(file))lines.push(line);assert.deepEqual(lines,['one 😀','two']);
    await assert.rejects(async()=>{for await(const line of collectionLines(new Blob([Uint8Array.of(255)])))void line;});
});
