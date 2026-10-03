import {loadCore} from './core-loader.mjs';
import {SQLiteProjectStore,STORAGE_VERSION} from './storage-engine.mjs';
import {SQLiteCorpusIndex} from './search-engine.mjs';
import {invariant} from '../integrity.mjs';
let sqlite,store,core;
const memory=self.location.pathname.endsWith('/search-worker.mjs');
const writeLock='nextmedtator-sqlite-write-v2';
const withWriteLock=task=>!memory&&navigator.locks?navigator.locks.request(writeLock,task):task();
async function ready(){
    if(store)return;
    // Even read-only first requests can create or migrate the shared database.
    // Finish initialization under the write lock before locking an operation.
    await withWriteLock(initialize);
}
async function initialize(){
    if(store)return;
    if(!memory)invariant(self.crossOriginIsolated&&navigator.storage?.getDirectory,'Local database requires a secure origin, cross-origin isolation and OPFS');
    if(memory)globalThis.sqlite3ApiConfig={disable:{vfs:{opfs:true,'opfs-vfs':true,'opfs-sahpool':true,'opfs-wl':true}}};
    const module=await import(new URL('../../../vendor/sqlite/index.mjs',import.meta.url));
    sqlite=await module.default({print:()=>{},printErr:()=>{},locateFile:name=>new URL('../../../vendor/sqlite/'+name,import.meta.url).href});
    if(memory){const db=new sqlite.oo1.DB(':memory:','c');try{store=new SQLiteCorpusIndex(db);}catch(error){db.close();throw error;}return;}
    invariant(sqlite.oo1.OpfsDb,'Persistent SQLite storage is unavailable; work remains in memory. Export to keep it.');
    core=await loadCore();const db=new sqlite.oo1.OpfsDb('/nextmedtator-v2.sqlite3','c');try{store=new SQLiteProjectStore(db,core);}catch(error){db.close();throw error;}
}
async function operation(name,args){switch(name){
    case 'health':return {backend:memory?'sqlite-memory':'sqlite-opfs',sqliteVersion:sqlite.version.libVersion,schemaVersion:STORAGE_VERSION,persistent:!memory,fts5:true};
    case 'indexCorpus':invariant(memory,'Live corpus indexing requires the volatile search worker');return store.index(args);
    case 'search':return store.search(args);
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
self.onmessage=({data:{id,operation:name,args}})=>{const task=async()=>{try{await ready();const invoke=()=>operation(name,args);const value=await (['checkpoint','forget','clear'].includes(name)?withWriteLock(invoke):invoke());self.postMessage({id,value},value instanceof Uint8Array?[value.buffer]:[]);}catch(error){self.postMessage({id,error:{code:store?(error.code??'STORAGE_FAILURE'):'STORAGE_UNAVAILABLE',message:['RECOVERY_CONFLICT','SEARCH_QUERY_INVALID','SEARCH_STALE'].includes(error.code)?error.message:memory?'Corpus search is unavailable. Your annotations are unchanged.':store?'Local database operation failed; export unsaved work and retry.':'Persistent local database is unavailable. Keep working in memory and export to save.'}});}};serial=serial.then(task,task);};
