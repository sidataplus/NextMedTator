/** Browser-reported logical processors, leaving one available by default. */
export function defaultCpuThreads(hardwareConcurrency=globalThis.navigator?.hardwareConcurrency){
    return Number.isFinite(hardwareConcurrency)?Math.max(1,Math.floor(hardwareConcurrency)-1):1;
}

/** Shared-memory WASM workers need cross-origin isolation. Explicit limits remain available. */
export function wasmThreadCount({crossOriginIsolated=false,hardwareConcurrency=1,maxThreads=defaultCpuThreads(hardwareConcurrency),userAgent=globalThis.navigator?.userAgent,codec,fixedWords}={}){
    const cores=Number.isFinite(hardwareConcurrency)?Math.max(1,Math.floor(hardwareConcurrency)):1;
    const limit=Number.isSafeInteger(maxThreads)&&maxThreads>=1?maxThreads:1;
    // Safari/WebKit with the 1024-token entity/attribute graphs stalled during
    // model compatibility checks at the default worker count. Keep this
    // specific large-contract path serial; smaller P10 and other engines retain
    // their requested CPU limits. This codec id mirrors the package contract.
    const webkit=/AppleWebKit\//i.test(userAgent??'')&&!/(?:Chrome|Chromium|Edg|OPR)\//i.test(userAgent??'');
    const conservativeEntityLimit=webkit&&codec==='gliner25-entity-attributes-v1'&&fixedWords===1024?1:limit;
    return crossOriginIsolated?Math.min(conservativeEntityLimit,cores):1;
}
