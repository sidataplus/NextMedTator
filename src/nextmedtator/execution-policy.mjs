// Application qualification of immutable graphs, independent of package naming.
// Existing offline packages retain their original manifest and content hashes.
import {AXIS_PATCH} from './webgpu-axis-patch.mjs';
import {invariant,sha256} from './integrity.mjs';
export const EXECUTION_POLICY = 'entity-webgpu-fp32-v1';
const graphs = [
    ['f58db136bc7a07d61c0d925e172ceb137800cf2c153b9654459ed31e28e57aa7','1045cde3fa3ec93a142f677f77114c43485d99eea65d33b42b59f949ba3f8d8a','dc0f0ea7c64094aae9fe7bd1245d49470635674d1e1b00be93fc76616aa3ed7b'],
    ['2ee92ad268cf7afb1d54c45d2d726b01f3419c6488061755d872fc2766f85774','ac37764700eabbb6ccd1fd95cdc8041836439a86dbf98ecf1c913cc67281909c','37889e4338ebc5c00a6f9e563599894a9ee3e611f4fb90348d052e69d4fb4533']
];
export function supportsWebGPU(manifest, variant) {
    const hash = path => manifest.files.find(f => f.path === path)?.sha256;
    return manifest.runtimeVersion === '1.23.2' && variant.precision === 'fp32' &&
        variant.codec === 'gliner25-entity-attributes-v1' &&
        Object.keys(variant.graphs??{}).sort().join(',') === 'attributes,model' &&
        hash(variant.tokenizer) === '59e858fa7dc08cfadc58ffd3ca685a1868a007a0aac05c4803828f58095f45cc' &&
        graphs.some(([model, attributes, contract]) => hash(variant.graphs?.model) === model &&
            hash(variant.graphs?.attributes) === attributes && hash(variant.entityContract) === contract);
}
export function graphTransforms(manifest,variant,backend){
    return backend==='webgpu' && supportsWebGPU(manifest,variant) && manifest.files.some(f=>f.path===variant.graphs.attributes&&f.sha256===AXIS_PATCH.sourceSha256)
        ? [{path:variant.graphs.attributes,id:AXIS_PATCH.id,sourceSha256:AXIS_PATCH.sourceSha256,targetSha256:AXIS_PATCH.targetSha256}] : [];
}
export async function prepareGraph(manifest,variant,path,bytes){
    if(!graphTransforms(manifest,variant,variant.backend).some(t=>t.path===path))return bytes;
    invariant(await sha256(bytes)===AXIS_PATCH.sourceSha256,'Axis conversion source hash mismatch');
    const decode=hex=>Uint8Array.from(hex.match(/../g)??[],b=>parseInt(b,16));
    let output=bytes;
    for(const patch of [...AXIS_PATCH.patches].reverse()){
        const before=decode(patch.before),after=decode(patch.after),at=patch.offset;
        invariant(before.every((b,i)=>output[at+i]===b),'Axis conversion byte mismatch');
        const next=new Uint8Array(output.length-before.length+after.length);
        next.set(output.subarray(0,at));next.set(after,at);next.set(output.subarray(at+before.length),at+after.length);output=next;
    }
    invariant(await sha256(output)===AXIS_PATCH.targetSha256,'Axis conversion output hash mismatch');
    return output;
}
