import {loadCore,compareCore,validateCore} from './core-loader.mjs';
import {assertUnicode} from '../integrity.mjs';
let core;
self.onmessage=async({data:{id,operation,args}})=>{try{core??=await loadCore();let value;
    if(operation==='compare')value=await compareCore(core,args.reference,args.candidate,args.options);
    else if(operation==='validate')value=validateCore(core,args.project);
    else{if(args.text!==undefined)assertUnicode(args.text);value=core({operation,...args});}
    self.postMessage({id,value});
}catch(error){self.postMessage({id,error:{code:error.code??'CORE_FAILURE',message:error.code==='CORE_VALIDATION'?error.message:'Local core operation failed. Verify the input or retry.'}});}};
