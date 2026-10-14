import {invariant, sha256, clone, fingerprint} from './integrity.mjs';
import {validateModelManifest,parseEntityContracts} from './model-package.mjs';
import {catalogArtifactURL,downloadArtifact} from './model-download.mjs';
import {authorizeDownload,clearDownloadGrants} from './download-gate.mjs';
const request = r => new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const MODEL_DB='nextmedtator-public-models-v1';
// Chromium limits a single serialized IndexedDB value to about 127 MiB.
const CHUNK_BYTES=16*1024*1024;
export class ModelStorageError extends Error {
    constructor(cause){super(`Browser could not save the model (${cause?.name??'storage unavailable'}).`,{cause});this.name='ModelStorageError';}
}
function checkCancellation(signal){if(signal?.aborted)throw new DOMException('Model installation cancelled','AbortError');}
// Wait for each small transaction to commit before allocating the next chunk.
// Keep the request error: tx.error can still be null during the error event.
function write(db,stores,action,signal){
    checkCancellation(signal);
    return new Promise((resolve,reject)=>{
        let tx;try{tx=db.transaction(stores,'readwrite');}catch(error){reject(new ModelStorageError(error));return;}
        let failure;
        const abort=()=>{try{tx.abort();}catch{}};
        const done=()=>signal?.removeEventListener('abort',abort);
        signal?.addEventListener('abort',abort,{once:true});
        tx.oncomplete=()=>{done();resolve();};
        tx.onerror=event=>{failure=event.target.error??tx.error;};
        tx.onabort=()=>{done();reject(signal?.aborted?new DOMException('Model installation cancelled','AbortError'):new ModelStorageError(failure??tx.error));};
        try{action(tx);}catch(error){failure=error;abort();}
    });
}
function artifactKeys(row){
    return row.manifest.files.flatMap(f=>{const key=`${row.artifactPrefix??row.manifestHash}:${f.path}`;
        return [key,...(f.bytes>CHUNK_BYTES?Array.from({length:Math.ceil(f.bytes/CHUNK_BYTES)},(_,i)=>`${key}:chunk:${i}`):[])];});
}
async function removeArtifacts(db,row){await write(db,['artifacts'],tx=>{for(const key of artifactKeys(row))tx.objectStore('artifacts').delete(key);});}
async function removeAbandonedInstalls(db){
    const rows=await request(db.transaction('packages').objectStore('packages').getAll());
    const published=new Set(rows.map(row=>row.artifactPrefix).filter(Boolean));
    const keys=await request(db.transaction('artifacts').objectStore('artifacts').getAllKeys());
    const abandoned=keys.filter(key=>{const prefix=typeof key==='string'&&key.match(/^([a-f0-9]{64}:install:[a-f0-9-]{36}):/);return prefix&&!published.has(prefix[1]);});
    if(abandoned.length)await write(db,['artifacts'],tx=>{for(const key of abandoned)tx.objectStore('artifacts').delete(key);});
}
async function writeVerifiedChunk(db,key,bytes,signal){
    await write(db,['artifacts'],tx=>tx.objectStore('artifacts').put(bytes,key),signal);
    checkCancellation(signal);
    let saved;try{saved=await request(db.transaction('artifacts').objectStore('artifacts').get(key));}catch(error){throw new ModelStorageError(error);}
    invariant(saved?.byteLength===bytes.byteLength,'Installed model read-back verification failed');
    for(let i=0;i<bytes.length;i++)if(saved[i]!==bytes[i])throw new Error('Installed model read-back verification failed');
}
/** Cache is optional for analysis, but cancellation and integrity errors remain fatal. */
export async function cacheModelForSession(owner,candidate,{signal}={}){
    owner.modelStorageNotice=null;
    try{return await owner.modelStore.install(candidate,{signal});}
    catch(error){
        checkCancellation(signal);
        if(!(error instanceof ModelStorageError))throw error;
        owner.modelStorageNotice='Ready for this session. Browser storage could not save this model for offline use. Keep this tab open to reuse it; reloading will require loading it again.';
        return candidate;
    }
}
async function readArtifact(db,key){
    const value=await request(db.transaction('artifacts').objectStore('artifacts').get(key));
    if(!value?.nmtChunks)return value;
    invariant(Number.isSafeInteger(value.bytes)&&value.bytes>CHUNK_BYTES&&value.nmtChunks===Math.ceil(value.bytes/CHUNK_BYTES),'Invalid model chunk index');
    const bytes=new Uint8Array(value.bytes);
    for(let i=0;i<value.nmtChunks;i++){
        const chunk=await request(db.transaction('artifacts').objectStore('artifacts').get(`${key}:chunk:${i}`));
        invariant(chunk?.byteLength===Math.min(CHUNK_BYTES,value.bytes-i*CHUNK_BYTES),'Installed model chunk is missing or corrupt');
        bytes.set(chunk,i*CHUNK_BYTES);
    }
    return bytes;
}
async function database(){const r=indexedDB.open(MODEL_DB,2);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('packages'))db.createObjectStore('packages',{keyPath:'manifestHash'});if(!db.objectStoreNames.contains('artifacts'))db.createObjectStore('artifacts');const store=r.transaction.objectStore('packages'),cursor=store.openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;const row=c.value;if(row.files){for(const [path,bytes] of row.files)r.transaction.objectStore('artifacts').put(bytes,`${row.manifestHash}:${path}`);delete row.files;c.update(row);}c.continue();};};return request(r);}
async function verified(row){validateModelManifest(row.manifest);invariant(await fingerprint(row.manifest)===row.manifestHash,'Installed manifest hash mismatch');const files=new Map(row.files);for(const f of row.manifest.files){const b=files.get(f.path);invariant(b?.byteLength===f.bytes&&await sha256(b)===f.sha256,'Installed model is corrupt; reimport this package');}return {...row,files,entityContracts:parseEntityContracts(row.manifest,files)};}
export class ModelStore {
    async install(packageData, {signal}={}) {
        checkCancellation(signal);
        await verified({...packageData,files:[...packageData.files]});
        checkCancellation(signal);
        // A cross-tab lock lets the next install reclaim chunks left by a tab
        // crash without deleting another active installation's staging data.
        if(globalThis.navigator?.locks){
            try{return await navigator.locks.request(`${MODEL_DB}:install`,{signal},()=>this.#install(packageData,signal,true));}
            catch(error){if(error?.name==='SecurityError')throw new ModelStorageError(error);throw error;}
        }
        return this.#install(packageData,signal,false);
    }
    async #install(packageData,signal,cleanAbandoned){
        checkCancellation(signal);
        let db;try{db=await database();}catch(error){throw new ModelStorageError(error);}
        const row={manifestHash:packageData.manifestHash,artifactPrefix:`${packageData.manifestHash}:install:${crypto.randomUUID()}`,manifest:clone(packageData.manifest),installedAt:new Date().toISOString()};
        let published=false;
        try {
            if(cleanAbandoned)try{await removeAbandonedInstalls(db);}catch(error){throw error instanceof ModelStorageError?error:new ModelStorageError(error);}
            let previous;try{previous=await request(db.transaction('packages').objectStore('packages').get(row.manifestHash));}catch(error){throw new ModelStorageError(error);}
            for(const f of row.manifest.files){
                checkCancellation(signal);
                const bytes=packageData.files.get(f.path),key=`${row.artifactPrefix}:${f.path}`;
                if(bytes.byteLength<=CHUNK_BYTES)await writeVerifiedChunk(db,key,bytes,signal);
                else{
                    for(let i=0;i<Math.ceil(bytes.byteLength/CHUNK_BYTES);i++)await writeVerifiedChunk(db,`${key}:chunk:${i}`,bytes.slice(i*CHUNK_BYTES,(i+1)*CHUNK_BYTES),signal);
                    await write(db,['artifacts'],tx=>tx.objectStore('artifacts').put({nmtChunks:Math.ceil(bytes.byteLength/CHUNK_BYTES),bytes:bytes.byteLength},key),signal);
                }
            }
            // Publish only after all read-back checks pass. A cancelled replacement
            // cannot damage the previously installed package.
            await write(db,['packages'],tx=>tx.objectStore('packages').put(row),signal);published=true;
            if(previous)await removeArtifacts(db,previous).catch(()=>{});
            return packageData;
        } finally {if(!published)await removeArtifacts(db,row).catch(()=>{});db.close();}
    }
    async read(hash){const db=await database();try{const row=await request(db.transaction('packages').objectStore('packages').get(hash));if(!row)return null;row.files=[];for(const f of row.manifest.files)row.files.push([f.path,await readArtifact(db,`${row.artifactPrefix??hash}:${f.path}`)]);return verified(row);}finally{db.close();}}
    async list(){const db=await database();try{return (await request(db.transaction('packages').objectStore('packages').getAll())).map(({manifest,manifestHash,installedAt})=>({manifest,manifestHash,installedAt,bytes:manifest.files.reduce((n,f)=>n+f.bytes,0)}));}finally{db.close();}}
    async listExisting(){if(!globalThis.indexedDB)return [];if(indexedDB.databases){const databases=await indexedDB.databases();if(!databases.some(item=>item.name===MODEL_DB))return [];}return this.list();}
    async remove(hash){const db=await database();try{const meta=await request(db.transaction('packages').objectStore('packages').get(hash));await write(db,['packages','artifacts'],tx=>{if(meta)for(const key of artifactKeys(meta))tx.objectStore('artifacts').delete(key);tx.objectStore('packages').delete(hash);});}finally{db.close();}}
}
/** Only the application-owned catalog can supply public installation URLs. No project values enter requests. */
export async function downloadCatalogPackage(entry,{signal,onProgress,onStage}={}){
    validateModelManifest(entry.manifest);
    if(entry.delivery?.kind==='r2')invariant(await fingerprint(entry.manifest)===entry.revision,'R2 catalog manifest differs from its immutable revision');
    const headers=await authorizeDownload(entry,{signal,onStage});
    const files=new Map();let received=0;const total=entry.manifest.files.reduce((n,f)=>n+f.bytes,0);
    for(const file of entry.manifest.files){
        const url=catalogArtifactURL(entry,file.path);
        let data;
        try{data=await downloadArtifact(url,file,{ranged:entry.delivery?.kind==='r2',headers,signal,onBytes:count=>{received+=count;onProgress?.({received,total,file:file.path});}});}
        catch(error){clearDownloadGrants();throw error;}
        files.set(file.path,data);
    }
    return {manifest:entry.manifest,manifestHash:await fingerprint(entry.manifest),files,entityContracts:parseEntityContracts(entry.manifest,files)};
}
