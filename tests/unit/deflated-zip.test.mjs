import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {zipStore,unzipBounded} from '../../src/nextmedtator/zip.mjs';

function compressedZip(data){
    const stored=zipStore(new Map([['data.bin',data]])),view=new DataView(stored.buffer);
    const body=30+view.getUint16(26,true),local=stored.slice(0,body);
    const central=stored.slice(body+data.length,-22),end=stored.slice(-22),compressed=deflateRawSync(data);
    const lv=new DataView(local.buffer),cv=new DataView(central.buffer),ev=new DataView(end.buffer);
    lv.setUint16(8,8,true);lv.setUint32(18,compressed.length,true);
    cv.setUint16(10,8,true);cv.setUint32(20,compressed.length,true);
    ev.setUint32(16,local.length+compressed.length,true);
    const result=new Uint8Array(local.length+compressed.length+central.length+end.length);
    let at=0;for(const bytes of [local,compressed,central,end]){result.set(bytes,at);at+=bytes.length;}
    return {bytes:result,centralAt:local.length+compressed.length};
}

test('deflated imports still work when browser Blob-backed streams fail',async t=>{
    const data=Uint8Array.from({length:200000},(_,i)=>(i*17+i%251)&255),fixture=compressedZip(data);
    t.mock.method(globalThis,'Blob',function(){return {stream:()=>new ReadableStream({start(controller){controller.error(new TypeError('network error'));}})};});
    assert.deepEqual((await unzipBounded(fixture.bytes)).get('data.bin'),data);
});

test('deflated imports retain declared expansion limits and CRC checks',async()=>{
    const data=new TextEncoder().encode('Synthetic bytes. '.repeat(1000)),fixture=compressedZip(data);
    await assert.rejects(unzipBounded(fixture.bytes,{archive:100000,files:2,total:data.length-1,file:data.length}),/expanded size/);
    const bad=fixture.bytes.slice(),view=new DataView(bad.buffer);
    view.setUint32(14,123,true);view.setUint32(fixture.centralAt+16,123,true);
    await assert.rejects(unzipBounded(bad),/integrity mismatch/);
});
