import {invariant,ValidationError} from './integrity.mjs';
import {StorageBackend} from './backend/storage-client.mjs';
import {readLegacy,listLegacy,forgetLegacy,clearLegacy} from './backend/legacy-recovery.mjs';
/** Consent remains separate from compute/model installation. SQLite CAS is authoritative. */
export class RecoveryStore {
    constructor({backend=new StorageBackend()}={}){this.backend=backend;this.enabled=false;this.id=null;this.expected=null;this.release=null;this.busy=false;this.migrated=false;this.listWarnings=[];}
    async enable(id,{consent=false,expectedHash=null}={}){
        invariant(consent,'Local recovery requires explicit consent');invariant(!this.enabled,'Recovery is already enabled');
        try{
            if(navigator.locks)await new Promise((resolve,reject)=>{navigator.locks.request(`nextmedtator:${id}`,{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock){reject(new ValidationError('This project is open for recovery in another tab','TAB_CONFLICT'));return;}await new Promise(done=>{this.release=done;resolve();});}).catch(reject);});
            await this.backend.health();
            const current=await this.backend.read(id);
            if(expectedHash!==null&&!current){const legacy=await readLegacy(id);invariant(legacy?.hash===expectedHash,'Recovery changed; reload the selected checkpoint');const hash=await this.backend.checkpoint(legacy.data,null);invariant(hash===legacy.hash,'Migration changed the portable project');this.migrated=true;}
            else {if(!current&&expectedHash===null)invariant(!await readLegacy(id),'Legacy recovery exists; inspect and restore it before enabling');invariant((current?.hash??null)===expectedHash,'Recovery already exists or changed; inspect and restore it before enabling');}
            this.id=id;this.expected=expectedHash;this.enabled=true;
        }catch(error){this.release?.();this.release=null;this.backend.close();throw error;}
    }
    async checkpoint(project){invariant(this.enabled&&project.id===this.id,'Recovery has not been enabled for this project');invariant(!this.busy,'A recovery checkpoint is already in progress');this.busy=true;try{const hash=await this.backend.checkpoint(project,this.expected);this.expected=hash;return hash;}finally{this.busy=false;}}
    async read(id,{backend='sqlite-opfs'}={}){if(backend==='indexeddb-legacy')return readLegacy(id);const stored=await this.backend.read(id);return stored??readLegacy(id);}
    async list(){
        const results=await Promise.allSettled([this.backend.list(),listLegacy()]);
        this.listWarnings=results.flatMap((result,index)=>result.status==='rejected'?[index===0?'Local database recovery is unavailable; only readable legacy checkpoints are listed.':'Legacy recovery is unavailable; only local database checkpoints are listed.']:[]);
        if(results.every(result=>result.status==='rejected'))throw new ValidationError('Recovery stores are unavailable. Export current work to keep it.','STORAGE_UNAVAILABLE');
        return results.flatMap(result=>result.status==='fulfilled'?result.value:[]);
    }
    async forget(){invariant(this.enabled,'Enable the selected project before deleting its recovery copy');invariant(!this.busy,'Checkpoint in progress');await this.backend.forget(this.id,this.expected);const legacy=await readLegacy(this.id);if(legacy)await forgetLegacy(this.id,legacy.hash);this.expected=null;}
    async forgetListed(id,hash,backend){invariant(!this.enabled,'Disable active recovery before deleting another checkpoint');if(backend==='indexeddb-legacy')await forgetLegacy(id,hash);else await this.backend.forget(id,hash);}
    async clear(){invariant(!this.busy,'Checkpoint in progress');this.disable();await this.backend.clear();await clearLegacy();this.backend.close();}
    async query(query={}){invariant(this.enabled,'Enable local recovery before querying it');return this.backend.query(this.id,query);}
    async exportDatabase(){invariant(this.enabled,'Enable and checkpoint this project before exporting its database');return this.backend.export(this.id);}
    disable(){invariant(!this.busy,'Wait for the active checkpoint before disabling recovery');this.backend.close();this.release?.();this.release=null;this.enabled=false;this.id=null;this.expected=null;this.migrated=false;}
}
export class ActiveTimer {
    constructor({ idleMs = 60000, clock = () => performance.now() } = {}) { this.clock = clock; this.idleMs = idleMs; this.total = 0; this.last = clock(); this.activity = this.last; this.paused = false; this.visible = true; }
    tick() { const t = this.clock(); if (!this.paused && this.visible)
        this.total += Math.max(0, Math.min(t, this.activity + this.idleMs) - this.last); this.last = t; return this.total; }
    touch() { this.tick(); this.activity = this.clock(); }
    pause(value) { this.tick(); this.paused = value; }
    visibility(value) { this.tick(); this.visible = value; if (value)
        this.activity = this.clock(); }
    report() { return { activeMs: Math.round(this.tick()), idleCutoffMs: this.idleMs, rawKeystrokesStored: false }; }
}
