import {invariant, sha256, clone, fingerprint} from './integrity.mjs';
import {validateModelManifest,parseEntityContracts} from './model-package.mjs';
import {catalogArtifactURL,downloadArtifact} from './model-download.mjs';
const request = r => new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const MODEL_DB='nextmedtator-public-models-v1';
// Chromium limits a single serialized IndexedDB value to about 127 MiB.
const CHUNK_BYTES=16*1024*1024;
function storeArtifact(store,key,bytes){
    if(bytes.byteLength<=CHUNK_BYTES){store.put(bytes,key);return;}
    const chunks=Math.ceil(bytes.byteLength/CHUNK_BYTES);
    store.put({nmtChunks:chunks,bytes:bytes.byteLength},key);
    for(let i=0;i<chunks;i++)store.put(bytes.slice(i*CHUNK_BYTES,(i+1)*CHUNK_BYTES),`${key}:chunk:${i}`);
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
        invariant(!signal?.aborted,'Installation cancelled');
        await verified({...packageData,files:[...packageData.files]});
        invariant(!signal?.aborted,'Installation cancelled');
        const db=await database();try {
            const row={manifestHash:packageData.manifestHash,manifest:clone(packageData.manifest),installedAt:new Date().toISOString()};
            await new Promise((resolve,reject)=>{const tx=db.transaction(['packages','artifacts'],'readwrite');const abort=()=>tx.abort();signal?.addEventListener('abort',abort,{once:true});tx.oncomplete=()=>{signal?.removeEventListener('abort',abort);resolve();};tx.onabort=()=>{signal?.removeEventListener('abort',abort);reject(new Error('Model installation cancelled or storage unavailable'));};tx.onerror=()=>reject(tx.error??new Error('Model storage write failed'));try{for(const [path,bytes] of packageData.files)if(path!=='manifest.json')storeArtifact(tx.objectStore('artifacts'),`${row.manifestHash}:${path}`,bytes);tx.objectStore('packages').put(row);}catch(error){tx.abort();reject(error);}});
            // Read back and verify one artifact at a time; reuse the caller's verified package.
            for(const f of row.manifest.files){const bytes=await readArtifact(db,`${row.manifestHash}:${f.path}`);invariant(bytes?.byteLength===f.bytes&&await sha256(bytes)===f.sha256,'Installed model read-back verification failed');}
            return packageData;
        } finally {db.close();}
    }
    async read(hash){const db=await database();try{const row=await request(db.transaction('packages').objectStore('packages').get(hash));if(!row)return null;row.files=[];for(const f of row.manifest.files)row.files.push([f.path,await readArtifact(db,`${hash}:${f.path}`)]);return verified(row);}finally{db.close();}}
    async list(){const db=await database();try{return (await request(db.transaction('packages').objectStore('packages').getAll())).map(({manifest,manifestHash,installedAt})=>({manifest,manifestHash,installedAt,bytes:manifest.files.reduce((n,f)=>n+f.bytes,0)}));}finally{db.close();}}
    async listExisting(){const databases=await globalThis.indexedDB?.databases?.();if(!databases?.some(item=>item.name===MODEL_DB))return [];return this.list();}
    async remove(hash){const db=await database();try{const meta=await request(db.transaction('packages').objectStore('packages').get(hash));await new Promise((resolve,reject)=>{const tx=db.transaction(['packages','artifacts'],'readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);for(const f of meta?.manifest.files??[]){tx.objectStore('artifacts').delete(`${hash}:${f.path}`);for(let i=0;i<Math.ceil(f.bytes/CHUNK_BYTES);i++)tx.objectStore('artifacts').delete(`${hash}:${f.path}:chunk:${i}`);}tx.objectStore('packages').delete(hash);});}finally{db.close();}}
}
/** Only the application-owned catalog can supply public installation URLs. No project values enter requests. */
export async function downloadCatalogPackage(entry,{signal,onProgress}={}){
    validateModelManifest(entry.manifest);
    if(entry.delivery?.kind==='r2')invariant(await fingerprint(entry.manifest)===entry.revision,'R2 catalog manifest differs from its immutable revision');
    const files=new Map();let received=0;const total=entry.manifest.files.reduce((n,f)=>n+f.bytes,0);
    for(const file of entry.manifest.files){
        const url=catalogArtifactURL(entry,file.path);
        const data=await downloadArtifact(url,file,{ranged:entry.delivery?.kind==='r2',signal,onBytes:count=>{received+=count;onProgress?.({received,total,file:file.path});}});
        files.set(file.path,data);
    }
    return {manifest:entry.manifest,manifestHash:await fingerprint(entry.manifest),files,entityContracts:parseEntityContracts(entry.manifest,files)};
}
