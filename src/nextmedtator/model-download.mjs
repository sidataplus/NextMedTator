import {invariant,sha256} from './integrity.mjs';

/** URLs come exclusively from the shipped, application-owned catalog. */
export function catalogArtifactURL(entry,path,pageURL=globalThis.location.href){
    invariant(typeof entry.urls?.[path]==='string','Artifact URL missing from the application catalog');
    const page=new URL(pageURL),url=new URL(entry.urls?.[path],page);
    invariant(!url.username&&!url.password&&!url.hash,'Unapproved artifact URL');
    if(entry.delivery?.kind==='r2'){
        const {origin,prefix}=entry.delivery;
        const approved=new URL(origin);
        invariant(approved.protocol==='https:'&&approved.origin===origin,'R2 requires an explicit HTTPS origin');
        invariant(/^[a-f0-9]{64}$/.test(entry.revision)&&prefix===`/nextmedtator-models/${entry.revision}/`,'R2 requires an immutable model prefix');
        invariant(url.origin===origin&&!url.search&&url.pathname===prefix+path,'Unapproved R2 artifact URL');
    }else{
        invariant(url.origin===page.origin||(url.origin==='https://huggingface.co'&&/^[a-f0-9]{40}$/.test(entry.revision)&&url.pathname.startsWith(`/nicolasembleton/gliner2.5-small-v1-onnx/resolve/${entry.revision}/`)),'Unapproved artifact URL');
    }
    return url;
}

async function copyResponse(response,target,start,expected,progress,signal){
    invariant(response.body,'Artifact response has no readable body');
    const reader=response.body.getReader();let read=0;
    try{
        for(;;){
            invariant(!signal?.aborted,'Download cancelled');
            const {done,value}=await reader.read();if(done)break;
            invariant(read+value.length<=expected,'Artifact exceeds declared bytes');
            target.set(value,start+read);read+=value.length;progress?.(value.length);
        }
        invariant(read===expected,'Incomplete artifact download');
    }catch(error){await reader.cancel().catch(()=>{});throw error;}
    finally{reader.releaseLock();}
}

/** Bounded HTTP ranges reduce transient copies; full SHA-256 remains authoritative. */
export async function downloadArtifact(url,file,{ranged=false,headers={},signal,onBytes,fetcher=globalThis.fetch,chunkBytes=8*1024*1024}={}){
    invariant(Number.isSafeInteger(chunkBytes)&&chunkBytes>0,'Invalid download chunk size');
    invariant(!signal?.aborted,'Download cancelled');
    const data=new Uint8Array(file.bytes),range=ranged&&file.bytes>chunkBytes;
    let etag=null;
    for(let start=0;start<file.bytes;){
        invariant(!signal?.aborted,'Download cancelled');
        const end=range?Math.min(file.bytes-1,start+chunkBytes-1):file.bytes-1;
        const response=await fetcher(url,{credentials:'omit',referrerPolicy:'no-referrer',signal,cache:'no-store',redirect:ranged?'error':'follow',headers:{...headers,...(range?{Range:`bytes=${start}-${end}`}:{})}});
        invariant(response.ok,response.status===403?'Download authorization expired. Request the download again.':response.status===429?'Download rate limit reached. Wait a minute and retry.':'Public artifact download failed');
        invariant(!response.headers.get('content-encoding')||response.headers.get('content-encoding')==='identity','Encoded model response is unsupported');
        if(range&&response.status===206){
            invariant(response.headers.get('content-range')===`bytes ${start}-${end}/${file.bytes}`,'Invalid or unexposed artifact Content-Range');
            const current=response.headers.get('etag');
            invariant(current&&(!etag||etag===current),'Missing, unexposed or changed artifact ETag');etag=current;
            await copyResponse(response,data,start,end-start+1,onBytes,signal);start=end+1;
        }else{
            invariant(response.status===200&&start===0,'Unexpected artifact range response');
            // Servers may ignore Range. Accept one full bounded response, never concatenate it.
            await copyResponse(response,data,0,file.bytes,onBytes,signal);start=file.bytes;
        }
    }
    invariant(await sha256(data)===file.sha256,'Artifact hash mismatch');
    return data;
}
