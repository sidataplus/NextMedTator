import {compareSnapshots} from './compare.mjs';
self.onmessage=async({data})=>{try{self.postMessage({report:await compareSnapshots(...data)});}catch{self.postMessage({error:'Comparison failed. Verify sources, schemas and selected coverage.'});}};
