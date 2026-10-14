/** Browser-reported logical processors, leaving one available by default. */
export function defaultCpuThreads(hardwareConcurrency=globalThis.navigator?.hardwareConcurrency){
    return Number.isFinite(hardwareConcurrency)?Math.max(1,Math.floor(hardwareConcurrency)-1):1;
}

/** Shared-memory WASM workers need cross-origin isolation. Explicit limits remain available. */
export function wasmThreadCount({crossOriginIsolated=false,hardwareConcurrency=1,maxThreads=defaultCpuThreads(hardwareConcurrency)}={}){
    const cores=Number.isFinite(hardwareConcurrency)?Math.max(1,Math.floor(hardwareConcurrency)):1;
    const limit=Number.isSafeInteger(maxThreads)&&maxThreads>=1?maxThreads:1;
    return crossOriginIsolated?Math.min(limit,cores):1;
}
