import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const env={...process.env,NMT_MODEL_CATALOG:'deployment/production-model-catalog.json'};
for(const [command,args] of [
    [process.execPath,['scripts/build_wasm.mjs']],
    ['uv',['run','--locked','python','scripts/build_nextmedtator.py']],
    [process.execPath,['scripts/finalize_build.mjs']],
]){
    const result=spawnSync(command,args,{cwd:root,env,stdio:'inherit'});
    if(result.error)throw result.error;
    if(result.status!==0)process.exit(result.status??1);
}
