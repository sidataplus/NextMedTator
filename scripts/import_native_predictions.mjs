import {readFile,writeFile} from 'node:fs/promises';
import {nativePredictionProject} from './native_predictions.mjs';
import {exportBundle} from '../src/nextmedtator/bundle.mjs';
const [input,output]=process.argv.slice(2);
if(!input||!output){console.error('Usage: node scripts/import_native_predictions.mjs local-receipt.json output.nmt.zip');process.exit(2);}
const project=await nativePredictionProject(JSON.parse(await readFile(input,'utf8')));
await writeFile(output,await exportBundle(project.current),{flag:'wx'});
console.log(`Created local review bundle: ${project.current.documents.length} notes, ${project.current.runs.reduce((n,r)=>n+r.records.length,0)} unreviewed predictions. Native inference; browser inference unsupported for this contract.`);
