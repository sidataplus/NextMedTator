// Application qualification of immutable graphs, independent of package naming.
// Existing offline packages retain their original manifest and content hashes.
import {AXIS_PATCH} from './webgpu-axis-patch.mjs';
import {invariant,sha256} from './integrity.mjs';
export const EXECUTION_POLICY = 'entity-webgpu-precision-v3';
const graphs = [
    ['f58db136bc7a07d61c0d925e172ceb137800cf2c153b9654459ed31e28e57aa7','1045cde3fa3ec93a142f677f77114c43485d99eea65d33b42b59f949ba3f8d8a','dc0f0ea7c64094aae9fe7bd1245d49470635674d1e1b00be93fc76616aa3ed7b'],
    ['2ee92ad268cf7afb1d54c45d2d726b01f3419c6488061755d872fc2766f85774','ac37764700eabbb6ccd1fd95cdc8041836439a86dbf98ecf1c913cc67281909c','37889e4338ebc5c00a6f9e563599894a9ee3e611f4fb90348d052e69d4fb4533']
];
const fp16Graphs = [
    ['cd8d399806283728e1d1ad4f786f14b77defe160e24544c8ccbb9bafc2869227','ac37764700eabbb6ccd1fd95cdc8041836439a86dbf98ecf1c913cc67281909c','37889e4338ebc5c00a6f9e563599894a9ee3e611f4fb90348d052e69d4fb4533'],
    ['bdf43a9185bf5562335b8d54b54bd81256e09a4b444080312e27afc3f0c97333','1045cde3fa3ec93a142f677f77114c43485d99eea65d33b42b59f949ba3f8d8a','dc0f0ea7c64094aae9fe7bd1245d49470635674d1e1b00be93fc76616aa3ed7b']
];
export function supportsWebGPU(manifest, variant) {
    const hash = path => manifest.files.find(f => f.path === path)?.sha256;
    const qualified = variant.precision === 'fp32' ? graphs : variant.precision === 'fp16' ? fp16Graphs : [];
    return manifest.runtimeVersion === '1.23.2' &&
        variant.codec === 'gliner25-entity-attributes-v1' &&
        Object.keys(variant.graphs??{}).sort().join(',') === 'attributes,model' &&
        hash(variant.tokenizer) === '59e858fa7dc08cfadc58ffd3ca685a1868a007a0aac05c4803828f58095f45cc' &&
        qualified.some(([model, attributes, contract]) => hash(variant.graphs?.model) === model &&
            hash(variant.graphs?.attributes) === attributes && hash(variant.entityContract) === contract);
}
/** Backend rounding allowance for the exact FP16 releases only. Semantics stay exact. */
export function recordConformanceOptions(manifest,variant){
    return variant.backend==='webgpu'&&variant.precision==='fp16'&&supportsWebGPU(manifest,variant)
        ? {tolerance:.05,threshold:variant.threshold} : {};
}
/** Only the exact original FP32 releases may recover these FP16 graphs. */
export function wasmFallbackIdentity(manifest,variant){
    if(variant.precision!=='fp16'||!supportsWebGPU(manifest,variant))return null;
    const index=fp16Graphs.findIndex(([model])=>manifest.files.some(f=>f.path===variant.graph&&f.sha256===model));
    return {manifestHash:[
        '2d7574bf8e467a7c39760981d3729ca5c43b2a6d58937365bbb6a6d69fb0f8a7',
        '0374df44608eef43724d93e0e7f26067fb006e3850a373e0456a0a6b10001223'
    ][index],variantId:'wasm-fp32'};
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
