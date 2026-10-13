/** Shared-memory WASM workers need cross-origin isolation. Cap CPU use per tab. */
export function wasmThreadCount({crossOriginIsolated=false,hardwareConcurrency=1,maxThreads=4}={}){
    const limit=Number.isInteger(maxThreads)&&maxThreads>=1?Math.min(4,maxThreads):1;
    return crossOriginIsolated?Math.max(1,Math.min(limit,Math.floor(hardwareConcurrency)||1)):1;
}
