import {invariant,sha256,LIMITS,fingerprint,jsonParse} from './integrity.mjs';
import {ReviewProject} from './project.mjs';
import {restoreBatchQueue} from './batch-queue.mjs';

export async function exportCollection(store,meta,writable,{onProgress}={}){
    let chain=await fingerprint(meta),count=0;
    try{
        await writable.write(JSON.stringify({format:'nextmedtator-collection-jsonl-v1',meta,hash:chain})+'\n');
        for(const item of meta.notes){const row=await store.note(meta.id,item._diskKey),hash=await fingerprint(row);chain=await sha256(chain+hash);await writable.write(JSON.stringify({row,hash})+'\n');count++;onProgress?.({completed:count,total:meta.notes.length});}
        await writable.write(JSON.stringify({end:true,count,chain})+'\n');await writable.close();
    }catch(error){await writable.abort?.();throw error;}
}

export async function importCollectionBackup(store,file,{keyFor,onProgress}={}){
    let meta=null,header=null,chain=null,count=0;const keys=new Set();
    try{
        for await(const line of collectionLines(file)){
            const data=jsonParse(line);
            if(!header){invariant(data.format==='nextmedtator-collection-jsonl-v1'&&data.hash===await fingerprint(data.meta),'Invalid collection backup header');header=data;chain=data.hash;invariant(Array.isArray(data.meta.notes)&&data.meta.notes.length<=10000,'Invalid collection size');meta=await store.create(data.meta.dtd,data.meta.name+' (restored)');continue;}
            invariant(!header.finished,'Unexpected data after backup footer');
            if(data.end){invariant(count===data.count&&count===header.meta.notes.length&&data.chain===chain,'Incomplete or corrupt collection backup');header.finished=true;continue;}
            const row=data.row,item=header.meta.notes[count];invariant(item&&data.hash===await fingerprint(row)&&typeof row?.ann?.text==='string'&&row.ann.text.length<=LIMITS.text&&row.sourceHash===await sha256(row.ann.text)&&row.key===item._diskKey&&row.ann._diskKey===row.key&&item.sourceHash===row.sourceHash&&item._filename===row.ann._filename&&row.key===keyFor(row.ann._filename,row.ann.text)&&!keys.has(row.key),'Invalid collection note');
            if(row.project){const project=await ReviewProject.open(row.project);invariant(project.current.documents.length===1&&project.current.documents[0].text===row.ann.text,'Collection history belongs to another source');}
            keys.add(row.key);meta.notes.push(item);await store.commit(meta,row);chain=await sha256(chain+data.hash);count++;onProgress?.({completed:count,total:header.meta.notes.length});
        }
        invariant(header?.finished,'Collection backup is incomplete');meta.queue=restoreBatchQueue(header.meta.queue);meta.settings=header.meta.settings;const index=new Map(meta.notes.map(n=>[n._diskKey,n]));for(const note of meta.queue?.notes??[])invariant(index.get(note.key)?.sourceHash===note.sourceHash&&index.get(note.key)?._filename===note.filename,'Backup queue does not match its notes');await store.commit(meta);return meta;
    }catch(error){if(meta)await store.remove(meta.id);throw error;}
}

/** A streaming backup never materializes the full collection as one string/blob. */
export async function* collectionLines(file){
    const reader=file.stream().getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let buffer='';
    try{for(;;){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let at;while((at=buffer.indexOf('\n'))>=0){invariant(at<=LIMITS.json,'Collection note history exceeds the backup line limit');const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(line.trim())yield line;}invariant(buffer.length<=LIMITS.json,'Collection note history exceeds the backup line limit');if(done)break;}if(buffer.trim())yield buffer;}finally{reader.releaseLock();}
}
