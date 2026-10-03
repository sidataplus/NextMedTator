import {sha256,jsonParse,invariant} from '../integrity.mjs';
const NAME='nextmedtator-recovery-v1';
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Close other tabs before deleting legacy recovery'));});
async function open(){
    if(typeof indexedDB==='undefined')return null;
    if(indexedDB.databases&&!(await indexedDB.databases()).some(db=>db.name===NAME))return null;
    const r=indexedDB.open(NAME);let missing=false;r.onupgradeneeded=()=>{missing=true;r.transaction.abort();};try{return await request(r);}catch(error){if(missing)return null;throw error;}
}
export async function readLegacy(id){const db=await open();if(!db)return null;try{const row=await request(db.transaction('projects').objectStore('projects').get(id));if(!row)return null;invariant(await sha256(row.payload)===row.hash,'Legacy recovery integrity check failed');return {data:jsonParse(row.payload),hash:row.hash,backend:'indexeddb-legacy'};}finally{db.close();}}
export async function listLegacy(){const db=await open();if(!db)return [];try{return (await request(db.transaction('projects').objectStore('projects').getAll())).map(({id,updatedAt})=>({id,updatedAt,backend:'indexeddb-legacy'}));}finally{db.close();}}
export async function forgetLegacy(id,expectedHash){const db=await open();if(!db)return;try{await new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite'),store=tx.objectStore('projects'),r=store.get(id);tx.oncomplete=resolve;tx.onabort=()=>reject(new Error('Legacy checkpoint changed; deletion refused'));tx.onerror=()=>reject(tx.error);r.onsuccess=()=>{if((r.result?.hash??null)!==expectedHash){tx.abort();return;}store.delete(id);};});}finally{db.close();}}
export async function clearLegacy(){if(typeof indexedDB==='undefined')return;await request(indexedDB.deleteDatabase(NAME));}
