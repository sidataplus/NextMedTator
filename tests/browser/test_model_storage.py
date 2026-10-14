"""Exercise Chromium's real IndexedDB value limit and chunk corruption checks."""
import os
from playwright.sync_api import sync_playwright
from browser_support import chromium_path

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=chromium_path())
    page=browser.new_page()
    page.goto(os.environ.get('NMT_DEPLOYED_URL','https://nmt.sidata.plus/'))
    result=page.evaluate('''async()=>{
        const {ModelStore}=await import('./app/nextmedtator/model-store.mjs');
        const {sha256,fingerprint}=await import('./app/nextmedtator/integrity.mjs');
        const bytes=new Uint8Array(140*1024*1024+17);bytes[0]=31;bytes[bytes.length-1]=97;
        const fixture=new Uint8Array([1,2,3]);
        const manifest={format:'nextmedtator-model-v1',id:'synthetic-large-storage-test',version:'1',runtime:'onnxruntime-web',runtimeVersion:'1.23.2',
            lineage:{base:{model:'synthetic-only',revision:'a'.repeat(40)}},license:{id:'MIT',notice:'Empty test bytes, no inference'},
            files:[{path:'test.onnx',role:'graph',bytes:bytes.length,sha256:await sha256(bytes)},{path:'reference.json',role:'fixture',bytes:3,sha256:await sha256(fixture)}],
            variants:[{id:'wasm',backend:'wasm',precision:'fp32',codec:'tensor-conformance-v1',graph:'test.onnx',fixtures:['reference.json']}],capabilities:[]};
        const hash=await fingerprint(manifest),store=new ModelStore();
        const installed=await store.install({manifest,manifestHash:hash,files:new Map([['test.onnx',bytes],['reference.json',fixture]])});
        if(installed.files.get('test.onnx')[bytes.length-1]!==97)throw Error('Readback differs');
        const restored=await store.read(hash);
        if(restored.files.get('test.onnx')[0]!==31)throw Error('Restored bytes differ');
        const db=await new Promise((ok,no)=>{const r=indexedDB.open('nextmedtator-public-models-v1',2);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
        const row=await new Promise((ok,no)=>{const r=db.transaction('packages').objectStore('packages').get(hash);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
        await new Promise((ok,no)=>{const tx=db.transaction('artifacts','readwrite');tx.objectStore('artifacts').delete((row.artifactPrefix??hash)+':test.onnx:chunk:2');tx.oncomplete=ok;tx.onabort=()=>no(tx.error);});db.close();
        let detected=false;try{await store.read(hash);}catch(e){detected=/missing or corrupt/.test(e.message);}
        if(!detected)throw Error('Missing chunk was accepted');
        await store.remove(hash);
        if(await store.read(hash))throw Error('Removal failed');
        return {largeValueBytes:bytes.length,installAndRestore:true,missingChunkRejected:true,remove:true};
    }''')
    print(result,flush=True)
    browser.close()
