import {downloadCatalogPackage,cacheModelForSession,ModelIntegrityError} from './model-store.mjs';
import {invariant} from './integrity.mjs';
import {renderLoadingProgress} from './loading-progress.mjs';

/** Called by an explicit Analyze request. Startup never resolves or downloads it. */
export async function loadWasmFallback(owner,{manifestHash},{offline=false,reason,detail}={}){
    if(!offline&&owner.model?.manifestHash===manifestHash)return owner.model;
    // Storage may be disabled altogether. It must not prevent session-only use.
    let installed=[];
    try{installed=await owner.modelStore.listExisting();}
    catch(error){if(error?.name!=='SecurityError')throw error;}
    if(installed.some(item=>item.manifestHash===manifestHash)){
        try{const cached=await owner.modelStore.read(manifestHash);if(cached)return cached;}
        catch(error){
            if(!(error instanceof ModelIntegrityError))throw error;
            if(offline)throw new ModelIntegrityError('Offline FP32 fallback is corrupt; reconnect and restore the original package before offline use.',{cause:error});
        }
    }
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
    owner.message=`${reason?`FP16 could not run on this browser GPU${detail?`: ${detail}`:'.'}`:'CPU analysis requires the FP32 package.'} Preparing FP32; it will be reused in this tab and saved when browser storage is available.`;owner.render();
    try{
        const candidate=await downloadCatalogPackage(entry,{signal:owner.installController.signal,onStage:stage=>{owner.loadingProgress={...stage,started:performance.now()};renderLoadingProgress(owner.root,owner.loadingProgress);},onProgress:({received,total})=>{if(!owner.loadingProgress.phase.startsWith('Downloading'))owner.loadingProgress.started=performance.now();Object.assign(owner.loadingProgress,{phase:'Downloading FP32 WASM fallback',received,total});renderLoadingProgress(owner.root,owner.loadingProgress);}});
        invariant(candidate.manifestHash===manifestHash,'Downloaded FP32 fallback does not match the requested catalog revision');
        owner.loadingProgress.phase='Installing FP32 WASM fallback';renderLoadingProgress(owner.root,owner.loadingProgress);
        return await cacheModelForSession(owner,candidate,{signal:owner.installController.signal});
    }finally{owner.installController=null;}
}
