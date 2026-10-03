import {WorkerRPC} from './rpc.mjs';
export class CoreBackend{
    constructor(){this.rpc=new WorkerRPC(new URL('./core-worker.mjs',import.meta.url));}
    health(){return this.rpc.request('health');}
    validate(project){return this.rpc.request('validate',{project});}
    compare(reference,candidate,options={}){return this.rpc.request('compare',{reference,candidate,options});}
    offsets(text){return this.rpc.request('offsets',{text});}
    search(text,needle){return this.rpc.request('search',{text,needle});}
    cancel(){this.rpc.close();}
}
export const coreBackend=new CoreBackend();
