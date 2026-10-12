import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogArtifactURL,downloadArtifact} from '../../src/nextmedtator/model-download.mjs';
import {sha256,fingerprint} from '../../src/nextmedtator/integrity.mjs';
import {downloadCatalogPackage} from '../../src/nextmedtator/model-store.mjs';

const revision='a'.repeat(64),origin='https://models.example.org',prefix=`/nextmedtator-models/${revision}/`;
const entry={revision,delivery:{kind:'r2',origin,prefix},urls:{'model.onnx':origin+prefix+'model.onnx'}};
test('R2 catalog requires the reviewed immutable origin and exact path',()=>{
    assert.equal(catalogArtifactURL(entry,'model.onnx','https://app.example.org/').href,entry.urls['model.onnx']);
    for(const bad of ['https://evil.example/model.onnx',origin+prefix+'model.onnx?secret=x',origin+prefix+'../model.onnx','https://user:password@models.example.org'+prefix+'model.onnx']){
        assert.throws(()=>catalogArtifactURL({...entry,urls:{'model.onnx':bad}},'model.onnx','https://app.example.org/'));
    }
    assert.throws(()=>catalogArtifactURL({...entry,delivery:{...entry.delivery,origin:'http://models.example.org'}},'model.onnx','https://app.example.org/'));
    assert.throws(()=>catalogArtifactURL(entry,'missing','https://app.example.org/'));
});
test('the existing pinned HF and same-origin catalog routes remain available',()=>{
    const row={revision:'b'.repeat(40),urls:{a:'https://huggingface.co/nicolasembleton/gliner2.5-small-v1-onnx/resolve/'+'b'.repeat(40)+'/onnx/a'}};
    assert.equal(catalogArtifactURL(row,'a','http://127.0.0.1:4173/').origin,'https://huggingface.co');
    assert.equal(catalogArtifactURL({urls:{a:'./models/a'}},'a','http://127.0.0.1:4173/').pathname,'/models/a');
});
const data=Uint8Array.from([1,2,3,4,5,6,7,8,9]);
async function file(){return {bytes:data.length,sha256:await sha256(data)};}
function ranges({changeEtag=false,wrongRange=false,missingEtag=false,short=false,corrupt=false}={}){
    const calls=[];
    return {calls,fetcher:async (url,options)=>{
        calls.push(options);
        const [,a,b]=options.headers.Range.match(/bytes=(\d+)-(\d+)/),start=Number(a),end=Number(b);
        const value=data.slice(start,end+1);if(corrupt)value[0]^=1;
        return new Response(short?value.slice(1):value,{status:206,headers:{'Content-Range':`bytes ${wrongRange?start+1:start}-${end}/${data.length}`,...(missingEtag?{}:{ETag:changeEtag&&start>0?'changed':'fixed'})}});
    }};
}
test('bounded ranges cover the exact artifact, verify SHA, omit credentials and report exact bytes',async()=>{
    const mock=ranges();let bytes=0;
    assert.deepEqual(await downloadArtifact(entry.urls['model.onnx'],await file(),{...mock,ranged:true,chunkBytes:4,onBytes:n=>bytes+=n}),data);
    assert.equal(bytes,9);assert.equal(mock.calls.length,3);
    assert.deepEqual(mock.calls.map(c=>c.headers.Range),['bytes=0-3','bytes=4-7','bytes=8-8']);
    for(const c of mock.calls){assert.equal(c.credentials,'omit');assert.equal(c.referrerPolicy,'no-referrer');assert.equal(c.redirect,'error');}
});
test('an ignored range accepts only one complete bounded response',async()=>{
    let calls=0;
    assert.deepEqual(await downloadArtifact('https://models.example.org/a',await file(),{ranged:true,chunkBytes:4,fetcher:async()=>{calls++;return new Response(data);}}),data);
    assert.equal(calls,1);
});
test('range metadata, changed objects, truncation and full digest failures fail closed',async()=>{
    for(const options of [{wrongRange:true},{changeEtag:true},{missingEtag:true},{short:true},{corrupt:true}]){
        await assert.rejects(downloadArtifact('https://models.example.org/a',await file(),{...ranges(options),ranged:true,chunkBytes:4}));
    }
    await assert.rejects(downloadArtifact('https://models.example.org/a',await file(),{ranged:true,chunkBytes:4,fetcher:async()=>new Response(data,{status:416})}));
});
test('oversized responses and cancellation stop the download',async()=>{
    await assert.rejects(downloadArtifact('https://models.example.org/a',await file(),{fetcher:async()=>new Response(new Uint8Array(10))}),/exceeds/);
    const controller=new AbortController();controller.abort();let calls=0;
    await assert.rejects(downloadArtifact('https://models.example.org/a',await file(),{signal:controller.signal,fetcher:async()=>{calls++;return new Response(data);}}),/cancelled/);
    assert.equal(calls,0);
});
test('catalog downloads bind the immutable revision to the canonical manifest before requesting files',async t=>{
    const hash=await sha256(data);
    const manifest={format:'nextmedtator-model-v1',id:'synthetic-tensor-fixture',version:'1',runtime:'onnxruntime-web',runtimeVersion:'1.23.2',lineage:{base:{model:'synthetic-only',revision:'a'.repeat(40)}},license:{id:'MIT',notice:'Test bytes; no model inference'},files:[{path:'test.onnx',bytes:9,sha256:hash,role:'graph'},{path:'reference.json',bytes:9,sha256:hash,role:'fixture'}],variants:[{id:'wasm',backend:'wasm',precision:'fp32',codec:'tensor-conformance-v1',graph:'test.onnx',fixtures:['reference.json']}],capabilities:[]};
    const revision=await fingerprint(manifest),prefix=`/nextmedtator-models/${revision}/`;
    const row={revision,manifest,delivery:{kind:'r2',origin,prefix},urls:Object.fromEntries(manifest.files.map(f=>[f.path,origin+prefix+f.path]))};
    const previous=globalThis.location;globalThis.location={href:'https://app.example.org/'};t.after(()=>{if(previous===undefined)delete globalThis.location;else globalThis.location=previous;});
    let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(data);});
    await assert.rejects(downloadCatalogPackage({...row,revision:'b'.repeat(64)}),/immutable revision/);assert.equal(calls,0);
    const loaded=await downloadCatalogPackage(row);assert.equal(loaded.manifestHash,revision);assert.equal(loaded.files.size,2);assert.equal(calls,2);
});
