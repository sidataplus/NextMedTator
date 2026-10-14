async () => {
    const {ModelStore,ModelIntegrityError,cacheModelForSession}=await import('./app/nextmedtator/model-store.mjs');
    const {sha256,fingerprint}=await import('./app/nextmedtator/integrity.mjs');
    const bytes=new Uint8Array(140*1024*1024+17);bytes[0]=31;bytes[bytes.length-1]=97;
    const fixture=new Uint8Array([1,2,3]);
    const manifest={format:'nextmedtator-model-v1',id:'synthetic-large-storage-test',version:'1',runtime:'onnxruntime-web',runtimeVersion:'1.23.2',
        lineage:{base:{model:'synthetic-only',revision:'a'.repeat(40)}},license:{id:'MIT',notice:'Empty test bytes, no inference'},
        files:[{path:'test.onnx',role:'graph',bytes:bytes.length,sha256:await sha256(bytes)},{path:'reference.json',role:'fixture',bytes:3,sha256:await sha256(fixture)}],
        variants:[{id:'wasm',backend:'wasm',precision:'fp32',codec:'tensor-conformance-v1',graph:'test.onnx',fixtures:['reference.json']}],capabilities:[]};
    const hash=await fingerprint(manifest),store=new ModelStore(),candidate={manifest,manifestHash:hash,files:new Map([['test.onnx',bytes],['reference.json',fixture]])};
    const check=(ok,message)=>{if(!ok)throw Error(message);};
    const request=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
    const original=IDBObjectStore.prototype.put;let maxBuffer=0,writeCount=0,fault=null,controller;
    IDBObjectStore.prototype.put=function(value,key){
        if(this.name==='artifacts'&&ArrayBuffer.isView(value)){
            maxBuffer=Math.max(maxBuffer,value.buffer.byteLength);writeCount++;
            if(fault==='quota'&&writeCount===3)throw new DOMException('Injected full storage','QuotaExceededError');
            if(fault==='cancel'&&writeCount===3)queueMicrotask(()=>controller.abort());
        }
        return original.call(this,value,key);
    };
    const keys=async()=>{const db=await request(indexedDB.open('nextmedtator-public-models-v1',2));try{return await request(db.transaction('artifacts').objectStore('artifacts').getAllKeys());}finally{db.close();}};
    try{
        check(await store.install(candidate)===candidate,'Install copied the package');
        check(maxBuffer<=16*1024*1024,'IDB serialized an entire model buffer');
        let restored=await store.read(hash);check(restored.files.get('test.onnx')[bytes.length-1]===97,'Restored bytes differ');restored=null;
        const baseline=(await keys()).length;
        if(navigator.locks){
            const abandonedDb=await request(indexedDB.open('nextmedtator-public-models-v1',2));
            await new Promise((ok,no)=>{const tx=abandonedDb.transaction('artifacts','readwrite');tx.objectStore('artifacts').put(fixture,hash+':install:'+crypto.randomUUID()+':abandoned.onnx');tx.oncomplete=ok;tx.onabort=()=>no(tx.error);});abandonedDb.close();
        }
        for(const mode of ['quota','cancel']){
            fault=mode;writeCount=0;controller=new AbortController();const owner={modelStore:store};
            if(mode==='quota'){
                check(await cacheModelForSession(owner,candidate)===candidate,'Quota discarded valid candidate');
                check(owner.modelStorageNotice.includes('this session'),'Missing session-only notice');
            }else{
                let error;try{await cacheModelForSession(owner,candidate,{signal:controller.signal});}catch(e){error=e;}
                check(error?.name==='AbortError','Cancellation was mistaken for a storage failure');
            }
            fault=null;
            check((await keys()).length===baseline,'Failed install leaked chunks');
            check((await store.read(hash)).files.get('test.onnx')[0]===31,'Failed replacement damaged original');
        }
        const connection=await request(indexedDB.open('nextmedtator-public-models-v1',2));
        const row=await request(connection.transaction('packages').objectStore('packages').get(hash));
        await new Promise((ok,no)=>{const tx=connection.transaction('artifacts','readwrite');tx.objectStore('artifacts').delete(row.artifactPrefix+':test.onnx:chunk:2');tx.oncomplete=ok;tx.onabort=()=>no(tx.error);});connection.close();
        let detected;try{await store.read(hash);}catch(e){detected=e;}
        check(detected instanceof ModelIntegrityError&&/missing or corrupt/.test(detected.cause?.message??detected.message),'Missing chunk was not typed as installed-model corruption');
        await store.remove(hash);check(!await store.read(hash),'Removal failed');check((await keys()).length===0,'Removal leaked chunks');
        // Existing v2 installations use the manifest hash directly as the prefix.
        const legacyManifest=structuredClone(manifest),small=bytes.slice(0,17);
        legacyManifest.files[0].bytes=small.length;legacyManifest.files[0].sha256=await sha256(small);
        const legacyHash=await fingerprint(legacyManifest),legacyDb=await request(indexedDB.open('nextmedtator-public-models-v1',2));
        await new Promise((ok,no)=>{const tx=legacyDb.transaction(['packages','artifacts'],'readwrite');
            tx.objectStore('packages').put({manifestHash:legacyHash,manifest:legacyManifest,installedAt:'2026-10-01'});
            tx.objectStore('artifacts').put(small,legacyHash+':test.onnx');tx.objectStore('artifacts').put(fixture,legacyHash+':reference.json');
            tx.oncomplete=ok;tx.onabort=()=>no(tx.error);
        });legacyDb.close();
        check((await store.read(legacyHash)).files.get('test.onnx')[0]===31,'Existing installation no longer readable');
        await store.remove(legacyHash);check((await keys()).length===0,'Existing installation removal failed');
        const malformedManifest=structuredClone(manifest);delete malformedManifest.files;
        const malformedDb=await request(indexedDB.open('nextmedtator-public-models-v1',2));
        await new Promise((ok,no)=>{const tx=malformedDb.transaction('packages','readwrite');tx.objectStore('packages').put({manifestHash:hash,manifest:malformedManifest,installedAt:'2026-10-14'});tx.oncomplete=ok;tx.onabort=()=>no(tx.error);});malformedDb.close();
        const listed=await store.listExisting(),malformedRow=listed.find(row=>row.manifestHash===hash);
        check(malformedRow&&malformedRow.bytes===null,'Malformed package metadata blocked listing or reported a fabricated size');
        let malformedRead;try{await store.read(hash);}catch(error){malformedRead=error;}
        check(malformedRead instanceof ModelIntegrityError,'Malformed installed metadata was not typed as corruption on read');
        const cleanupDb=await request(indexedDB.open('nextmedtator-public-models-v1',2));
        await new Promise((ok,no)=>{const tx=cleanupDb.transaction('packages','readwrite');tx.objectStore('packages').delete(hash);tx.oncomplete=ok;tx.onabort=()=>no(tx.error);});cleanupDb.close();
        return {largeValueBytes:bytes.length,maxSerializedBuffer:maxBuffer,installAndRestore:true,quotaKeepsSession:true,cancelStops:true,replacementPreserved:true,partialCleanup:true,abandonedInstallCleanup:!!navigator.locks,missingChunkRejected:true,typedIntegrityError:true,remove:true,existingInstallCompatible:true,malformedMetadataListed:true,typedMalformedMetadata:true};
    }finally{IDBObjectStore.prototype.put=original;}
}
