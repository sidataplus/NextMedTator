import {loadCore} from './core-loader.mjs';
import {SQLiteProjectStore} from './storage-engine.mjs';
import {invariant} from '../integrity.mjs';
let sqlite,store,core;
async function ready(){
    if(store)return;
    invariant(self.crossOriginIsolated&&navigator.storage?.getDirectory,'Local database requires a secure origin, cross-origin isolation and OPFS');
    const module=await import(new URL('../../../vendor/sqlite/index.mjs',import.meta.url));
    sqlite=await module.default({print:()=>{},printErr:()=>{},locateFile:name=>new URL('../../../vendor/sqlite/'+name,import.meta.url).href});
    invariant(sqlite.oo1.OpfsDb,'Persistent SQLite storage is unavailable; work remains in memory. Export to keep it.');
    core=await loadCore();const db=new sqlite.oo1.OpfsDb('/nextmedtator-v2.sqlite3','c');try{store=new SQLiteProjectStore(db,core);}catch(error){db.close();throw error;}
}
async function operation(name,args){await ready();switch(name){
    case 'health':return {backend:'sqlite-opfs',sqliteVersion:sqlite.version.libVersion,schemaVersion:2,persistent:true};
    case 'checkpoint':return store.checkpoint(args.project,args.expectedHash);
    case 'read':return store.read(args.id);
    case 'list':return store.list();
    case 'forget':return store.forget(args.id,args.expectedHash);
    case 'clear':return store.clear();
    case 'query':return store.query(args.id,args.query);
    case 'export':{const record=await store.read(args.id);invariant(record,'Recovery project not found');const db=new sqlite.oo1.DB(':memory:','c');try{const portable=new SQLiteProjectStore(db,core);await portable.checkpoint(record.data,null);return sqlite.capi.sqlite3_js_db_export(db.pointer);}finally{db.close();}}
    default:throw new Error('Unsupported storage operation');
}}
let serial=Promise.resolve();
self.onmessage=({data:{id,operation:name,args}})=>{const task=async()=>{try{const invoke=()=>operation(name,args);const value=await (navigator.locks&&['checkpoint','forget','clear'].includes(name)?navigator.locks.request('nextmedtator-sqlite-write-v2',invoke):invoke());self.postMessage({id,value},value instanceof Uint8Array?[value.buffer]:[]);}catch(error){self.postMessage({id,error:{code:error.code??(store?'STORAGE_FAILURE':'STORAGE_UNAVAILABLE'),message:error.code==='RECOVERY_CONFLICT'?error.message:store?'Local database operation failed; export unsaved work and retry.':'Persistent local database is unavailable. Keep working in memory and export to save.'}});}};serial=serial.then(task,task);};
