import {downloadCatalogPackage} from './model-store.mjs';
import {invariant} from './integrity.mjs';
import {renderLoadingProgress} from './loading-progress.mjs';

/** Called by an explicit Analyze request. Startup never resolves or downloads it. */
export async function loadWasmFallback(owner,{manifestHash},{offline=false}={}){
    const installed=await owner.modelStore.listExisting();
    if(installed.some(item=>item.manifestHash===manifestHash))return owner.modelStore.read(manifestHash);
    invariant(!offline,'Install the original FP32 package for offline WASM fallback');
    if(!owner.catalog){
        const response=await fetch(new URL('../../models/catalog.json',import.meta.url),{credentials:'omit'});
        invariant(response.ok,'WASM fallback needs a connection or an installed FP32 package');
        owner.catalog=await response.json();
    }
    const entry=owner.catalog.entries.find(item=>item.revision===manifestHash);
    invariant(entry,'The approved FP32 fallback is missing from this app catalog');
    owner.installController=new AbortController();
    const total=entry.manifest.files.reduce((n,f)=>n+f.bytes,0);
    owner.loadingProgress={phase:'Downloading FP32 WASM fallback',received:0,total,started:performance.now()};
    owner.message='Preparing the original FP32 WASM fallback. This download is cached for later use.';owner.render();
    try{
        const candidate=await downloadCatalogPackage(entry,{signal:owner.installController.signal,onStage:stage=>{owner.loadingProgress={...stage,started:performance.now()};renderLoadingProgress(owner.root,owner.loadingProgress);},onProgress:({received,total})=>{if(!owner.loadingProgress.phase.startsWith('Downloading'))owner.loadingProgress.started=performance.now();Object.assign(owner.loadingProgress,{phase:'Downloading FP32 WASM fallback',received,total});renderLoadingProgress(owner.root,owner.loadingProgress);}});
        owner.loadingProgress.phase='Installing FP32 WASM fallback';renderLoadingProgress(owner.root,owner.loadingProgress);
        return await owner.modelStore.install(candidate,{signal:owner.installController.signal});
    }finally{owner.installController=null;}
}
