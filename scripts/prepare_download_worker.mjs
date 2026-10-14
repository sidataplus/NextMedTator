import {readFile,writeFile} from 'node:fs/promises';
const catalog=JSON.parse(await readFile('deployment/production-model-catalog.json','utf8'));
const packages={};
for(const entry of catalog.entries){
    entry.delivery.verification='turnstile-v1';
    const fallback=entry.manifest.variants[0].precision==='fp16'?catalog.entries.find(e=>e.manifest.variants[0].precision==='fp32'&&e.manifest.lineage.adapter.repository===entry.manifest.lineage.adapter.repository)?.revision:null;
    packages[entry.revision]={files:Object.fromEntries(entry.manifest.files.map(f=>[f.path,f.bytes])),...(fallback?{fallback}:{})};
}
await writeFile('deployment/production-model-catalog.json',JSON.stringify(catalog,null,2)+'\n');
await writeFile('deployment/download-worker/packages.mjs','// Generated from the reviewed production catalog. No arbitrary R2 keys are served.\nexport const PACKAGES='+JSON.stringify(packages,null,2)+';\n');
