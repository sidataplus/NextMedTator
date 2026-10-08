import {invariant, sha256, clone, fingerprint} from './integrity.mjs';
import {validateModelManifest} from './model-package.mjs';
const request = r => new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const MODEL_DB='nextmedtator-public-models-v1';
async function database(){const r=indexedDB.open(MODEL_DB,2);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('packages'))db.createObjectStore('packages',{keyPath:'manifestHash'});if(!db.objectStoreNames.contains('artifacts'))db.createObjectStore('artifacts');const store=r.transaction.objectStore('packages'),cursor=store.openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;const row=c.value;if(row.files){for(const [path,bytes] of row.files)r.transaction.objectStore('artifacts').put(bytes,`${row.manifestHash}:${path}`);delete row.files;c.update(row);}c.continue();};};return request(r);}
async function verified(row){validateModelManifest(row.manifest);invariant(await fingerprint(row.manifest)===row.manifestHash,'Installed manifest hash mismatch');const files=new Map(row.files);for(const f of row.manifest.files){const b=files.get(f.path);invariant(b?.byteLength===f.bytes&&await sha256(b)===f.sha256,'Installed model is corrupt; reimport this package');}return {...row,files};}
export class ModelStore {
    async install(packageData, {signal}={}) {
        invariant(!signal?.aborted,'Installation cancelled');
        await verified({...packageData,files:[...packageData.files]});
        invariant(!signal?.aborted,'Installation cancelled');
        const db=await database();try {
            const row={manifestHash:packageData.manifestHash,manifest:clone(packageData.manifest),installedAt:new Date().toISOString()};
            await new Promise((resolve,reject)=>{const tx=db.transaction(['packages','artifacts'],'readwrite');const abort=()=>tx.abort();signal?.addEventListener('abort',abort,{once:true});tx.oncomplete=()=>{signal?.removeEventListener('abort',abort);resolve();};tx.onabort=()=>{signal?.removeEventListener('abort',abort);reject(new Error('Model installation cancelled or storage unavailable'));};tx.onerror=()=>reject(tx.error);try{for(const [path,bytes] of packageData.files)if(path!=='manifest.json')tx.objectStore('artifacts').put(bytes,`${row.manifestHash}:${path}`);tx.objectStore('packages').put(row);}catch(error){tx.abort();reject(error);}});
            return await this.read(row.manifestHash);
        } finally {db.close();}
    }
    async read(hash){const db=await database();try{const row=await request(db.transaction('packages').objectStore('packages').get(hash));if(!row)return null;const store=db.transaction('artifacts').objectStore('artifacts');row.files=await Promise.all(row.manifest.files.map(f=>request(store.get(`${hash}:${f.path}`)).then(bytes=>[f.path,bytes])));return verified(row);}finally{db.close();}}
    async list(){const db=await database();try{return (await request(db.transaction('packages').objectStore('packages').getAll())).map(({manifest,manifestHash,installedAt})=>({manifest,manifestHash,installedAt,bytes:manifest.files.reduce((n,f)=>n+f.bytes,0)}));}finally{db.close();}}
    async listExisting(){const databases=await globalThis.indexedDB?.databases?.();if(!databases?.some(item=>item.name===MODEL_DB))return [];return this.list();}
    async remove(hash){const db=await database();try{const meta=await request(db.transaction('packages').objectStore('packages').get(hash));await new Promise((resolve,reject)=>{const tx=db.transaction(['packages','artifacts'],'readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);for(const f of meta?.manifest.files??[])tx.objectStore('artifacts').delete(`${hash}:${f.path}`);tx.objectStore('packages').delete(hash);});}finally{db.close();}}
}
/** Only the application-owned catalog can supply public installation URLs. No project values enter requests. */
export async function downloadCatalogPackage(entry,{signal,onProgress}={}){
    validateModelManifest(entry.manifest);
    const files=new Map();let received=0;const total=entry.manifest.files.reduce((n,f)=>n+f.bytes,0);
    for(const file of entry.manifest.files){
        const url=new URL(entry.urls[file.path],location.href);
        invariant(url.origin===location.origin || (url.origin==='https://huggingface.co'&&url.pathname.startsWith(`/nicolasembleton/gliner2.5-small-v1-onnx/resolve/${entry.revision}/`)),'Unapproved artifact URL');
        const response=await fetch(url,{credentials:'omit',signal,cache:'no-store'});invariant(response.ok,'Public artifact download failed');
        const reader=response.body.getReader(),parts=[];let bytes=0;
        for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;received+=value.length;invariant(bytes<=file.bytes,'Artifact exceeds declared bytes');parts.push(value);onProgress?.({received,total,file:file.path});}
        invariant(bytes===file.bytes,'Incomplete artifact download');const data=new Uint8Array(bytes);let at=0;for(const part of parts){data.set(part,at);at+=part.length;}
        invariant(await sha256(data)===file.sha256,'Artifact hash mismatch');files.set(file.path,data);
    }
    const {fingerprint}=await import('./integrity.mjs');return {manifest:entry.manifest,manifestHash:await fingerprint(entry.manifest),files};
}
