import {loadCore,compareCore} from './backend/core-loader.mjs';
let core;
self.onmessage=async({data})=>{try{core??=await loadCore();self.postMessage({report:await compareCore(core,...data)});}catch{self.postMessage({error:'Comparison failed. Verify sources, schemas and selected coverage, or reduce the corpus size.'});}};
