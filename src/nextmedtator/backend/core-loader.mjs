import {invariant,fingerprint,clone,assertUnicode,canonical} from '../integrity.mjs';
/** Small explicit ABI: UTF-8 JSON in, UTF-8 JSON out, host-owned buffers. */
export async function loadCore(bytes){
    if(!bytes){const response=await fetch(new URL('./core.wasm',import.meta.url),{credentials:'omit'});invariant(response.ok,'Local core WASM asset unavailable');bytes=await response.arrayBuffer();}
    const {instance}=await WebAssembly.instantiate(bytes,{}),wasm=instance.exports,encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
    return request=>{
        // Check the original tree before JSON.stringify can drop undefined or rewrite numbers.
        // Preserve insertion order for report conformance; canonical JSON is a validation pass.
        canonical(request);const input=encoder.encode(JSON.stringify(request,(_key,value)=>{invariant(value!==undefined,'Undefined core value');return value;}));invariant(input.length<=64*1024*1024,'Core request exceeds resource limit');const ptr=wasm.allocate(input.length);let result;
        try{new Uint8Array(wasm.memory.buffer,ptr,input.length).set(input);const output=wasm.dispatch(ptr,input.length),length=wasm.result_length();invariant(length<=128*1024*1024,'Core response exceeds resource limit');result=JSON.parse(decoder.decode(new Uint8Array(wasm.memory.buffer,output,length)));}finally{wasm.release(ptr,input.length);}
        if(!result.ok){const error=new Error(result.error.message);error.code=result.error.code;throw error;}return result.value;
    };
}
export async function compareCore(core,reference,candidate,options={}){
    const order=snapshot=>snapshot.records.map(r=>r.id).sort((a,b)=>a.localeCompare(b,'en'));
    // Hash the original immutable inputs, not the ordered transport views.
    const a=clone(reference),b=clone(candidate);a.hash??=await fingerprint(reference);b.hash??=await fingerprint(candidate);
    const report=core({operation:'compare',reference:a,candidate:b,options:{...options,referenceOrder:order(a),candidateOrder:order(b)}});
    return {...report,hash:await fingerprint(report)};
}
export function validateCore(core,project){
    for(const doc of project.documents)assertUnicode(doc.text);
    for(const records of [project.draft.records,...project.snapshots.map(s=>s.records)])core({operation:'validate',schema:project.schema,documents:project.documents,records});
    for(const run of project.runs)core({operation:'validate',schema:project.schema,documents:project.documents.filter(doc=>doc.id===run.documentId),records:run.records});
    return {valid:true};
}
