import {WorkerRPC} from './rpc.mjs';
export class StorageBackend{
    constructor(){this.rpc=new WorkerRPC(new URL('./storage-worker.mjs',import.meta.url),{timeout:120000});}
    health(){return this.rpc.request('health');}
    checkpoint(project,expectedHash){return this.rpc.request('checkpoint',{project,expectedHash});}
    read(id){return this.rpc.request('read',{id});}
    list(){return this.rpc.request('list');}
    forget(id,expectedHash){return this.rpc.request('forget',{id,expectedHash});}
    clear(){return this.rpc.request('clear');}
    query(id,query={}){return this.rpc.request('query',{id,query});}
    export(id){return this.rpc.request('export',{id});}
    close(){this.rpc.close();}
}
