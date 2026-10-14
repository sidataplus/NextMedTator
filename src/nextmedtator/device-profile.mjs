/** Capability hints only: no weights, device allocation, network or persistent fingerprint. */
export async function detectDevice(nav=globalThis.navigator,timeoutMs=2500){
    const cores=Number.isInteger(nav?.hardwareConcurrency)?nav.hardwareConcurrency:null;
    const memory=Number.isFinite(nav?.deviceMemory)?nav.deviceMemory:null;
    let gpu=false,fp16=false,timer;
    try{
        const adapter=await Promise.race([nav?.gpu?.requestAdapter({powerPreference:'high-performance'}),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);})]);
        gpu=!!adapter&&!adapter.isFallbackAdapter;fp16=gpu&&adapter.features.has('shader-f16');
    }catch{/* Browser policy or unavailable drivers: retain CPU recommendation. */}
    finally{clearTimeout(timer);}
    return {gpu,fp16,cores,memory};
}
export function deviceRecommendation(device,{execution='auto'}={}){
    if(!device)return {precision:null,title:'Checking device capabilities…',reason:'No model files are downloaded during this check.'};
    const precision=execution!=='wasm'&&device.fp16?'fp16':'fp32';
    const constrained=device.memory!==null&&device.memory<=4;
    return {precision,title:`Recommended: ${precision.toUpperCase()} ${precision==='fp16'?'for WebGPU':'for compatibility'}`,
        reason:precision==='fp16'?'Your browser exposes WebGPU with FP16 support. About half the FP32 download; actual speed depends on the device.':'Original precision supports WASM CPU inference'+(device.gpu&&execution!=='wasm'?' and WebGPU.':'.'),
        caution:constrained?'This browser reports limited memory. Try one short note first; smaller downloads do not guarantee lower runtime RAM.':null};
}
