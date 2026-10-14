import {invariant,uuid,sha256,clone,LIMITS} from './integrity.mjs';

const DB='nextmedtator-collections-v1';
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
async function open(){const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{r.result.createObjectStore('collections',{keyPath:'id'});r.result.createObjectStore('notes',{keyPath:['collectionId','key']});r.result.createObjectStore('entries',{keyPath:['collectionId','key']});};return request(r);}
const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error??new Error('Collection storage failed'));});

/** Explicit disk-backed collections: metadata in RAM; text/history read one note at a time. */
export class CollectionStore{
    async create(dtd,name='Local collection'){
        const meta={id:uuid(),version:1,name,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),dtd:clone(dtd),notes:[],queue:null,revision:0};
        const db=await open();try{const tx=db.transaction('collections','readwrite');const pending=done(tx);tx.objectStore('collections').add(meta);await pending;return meta;}finally{db.close();}
    }
    constructor(){this.savedQueueRows=new Map();}
    async list(){if(!(await indexedDB.databases?.())?.some(d=>d.name===DB))return [];const db=await open();try{return (await request(db.transaction('collections').objectStore('collections').getAll())).map(({id,name,updatedAt,count=0})=>({id,name,updatedAt,count}));}finally{db.close();}}
    async read(id){this.savedQueueRows.clear();const db=await open();try{const meta=await request(db.transaction('collections').objectStore('collections').get(id));if(!meta)return null;const entries=await request(db.transaction('entries').objectStore('entries').getAll(IDBKeyRange.bound([id,''],[id,'\uffff'])));entries.sort((a,b)=>a.order-b.order);meta.notes=entries.map(e=>e.item);if(meta.queue){meta.queue.notes=entries.filter(e=>e.queueId===meta.queue.id&&e.queueRow).sort((a,b)=>a.queueOrder-b.queueOrder).map(e=>e.queueRow);for(const row of meta.queue.notes)this.savedQueueRows.set(id+'/'+row.key,JSON.stringify(row));}return meta;}finally{db.close();}}
    async note(id,key){const db=await open();try{const row=await request(db.transaction('notes').objectStore('notes').get([id,key]));invariant(row&&await sha256(row.ann.text)===row.sourceHash,'Collection note is missing or corrupt');return row;}finally{db.close();}}
    async commit(meta,row=null){
        const db=await open();try{
            const tx=db.transaction(['collections','notes','entries'],'readwrite'),pending=done(tx),store=tx.objectStore('collections');
            const current=await request(store.get(meta.id));
            if(current?.revision!==meta.revision){tx.abort();await pending.catch(()=>{});throw new Error('Collection changed in another tab. Reopen it before saving.');}
            const {notes,queue,...header}=meta;
            const next={...header,count:notes.length,queue:queue?{...queue,notes:[]}:null,revision:meta.revision+1,updatedAt:new Date().toISOString()};
            const entries=tx.objectStore('entries'),queueRows=new Map((queue?.notes??[]).map((n,index)=>[n.key,{row:n,index}])),changed=[];
            const changedNote=row&&current.queue?.id===queue?.id?notes.findIndex(n=>n._diskKey===row.key):-1;
            for(const [order,item]of changedNote>=0?[[changedNote,notes[changedNote]]]:notes.entries()){
                const queued=queueRows.get(item._diskKey),signature=JSON.stringify(queued?.row??null),cacheKey=meta.id+'/'+item._diskKey;
                if(item._diskKey===row?.key||current.queue?.id!==queue?.id||this.savedQueueRows.get(cacheKey)!==signature){entries.put({collectionId:meta.id,key:item._diskKey,item,order,queueId:queue?.id??null,queueRow:queued?.row??null,queueOrder:queued?.index??0});changed.push([cacheKey,signature]);}
            }
            if(row)tx.objectStore('notes').put({...row,collectionId:meta.id});store.put(next);await pending;for(const [key,value]of changed)this.savedQueueRows.set(key,value);Object.assign(meta,{revision:next.revision,updatedAt:next.updatedAt});
        }finally{db.close();}
    }
    async importFiles(meta,files,{keyFor,onProgress,signal}={}){
        invariant(files.length>0&&meta.notes.length+files.length<=10000,'Collections support up to 10,000 notes');
        const names=new Set(meta.notes.map(n=>n._filename));
        for(const [index,file]of [...files].entries()){
            invariant(!signal?.aborted,'Cancelled: collection import stopped');
            invariant(file.size<=LIMITS.text,'Note exceeds the 16 MiB source limit');
            const filename=file.webkitRelativePath||file.name;
            invariant(!names.has(filename),'Duplicate filename: '+filename);
            const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer()),sourceHash=await sha256(text),key=keyFor(filename,text);
            const item={_diskKey:key,_filename:filename,sourceHash,bytes:file.size};
            const next={...meta,notes:[...meta.notes,item]};
            await this.commit(next,{key,sourceHash,ann:{_filename:filename,text,tags:[],_diskKey:key},project:null,run:null});
            Object.assign(meta,next);names.add(filename);onProgress?.({completed:index+1,total:files.length});
        }
        return meta;
    }
    async remove(id){for(const key of this.savedQueueRows.keys())if(key.startsWith(id+'/'))this.savedQueueRows.delete(key);const db=await open();try{const tx=db.transaction(['collections','notes','entries'],'readwrite'),pending=done(tx);tx.objectStore('collections').delete(id);tx.objectStore('notes').delete(IDBKeyRange.bound([id,''],[id,'\uffff']));tx.objectStore('entries').delete(IDBKeyRange.bound([id,''],[id,'\uffff']));await pending;}finally{db.close();}}
}
