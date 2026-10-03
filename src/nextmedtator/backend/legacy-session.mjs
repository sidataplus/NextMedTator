import {RecoveryStore} from '../recovery.mjs';
import {invariant} from '../integrity.mjs';
/** Debounced durable projection of the existing Vue workspace; no UI replacement. */
export class LegacyRecoverySession{
    constructor({capture,restore,onStatus,store=new RecoveryStore()}){this.capture=capture;this.restore=restore;this.onStatus=onStatus;this.store=store;this.projectId=null;this.revision=0;this.savedRevision=0;this.pending=null;this.timer=null;this.stopping=false;this.status='Recovery off; export files to save';}
    setStatus(value){this.status=value;this.onStatus?.(value);}
    get enabled(){return this.store.enabled;}
    touch(){if(this.stopping)return;this.revision++;if(!this.enabled)return;this.setStatus('Unsaved changes; local checkpoint pending');clearTimeout(this.timer);this.timer=setTimeout(()=>this.save().catch(()=>{}),750);}
    async enable(){const revision=this.revision,project=await this.capture();await this.store.enable(project.id,{consent:true});this.projectId=project.id;await this.save(project,revision);}
    async save(initial=null,initialRevision=this.revision){
        invariant(this.enabled,'Enable local corpus recovery first');clearTimeout(this.timer);this.timer=null;
        if(this.pending){await this.pending;return this.save();}
        const revision=initial?initialRevision:this.revision;let failed=false;this.setStatus('Saving local checkpoint…');
        this.pending=(async()=>{const project=initial??await this.capture(this.projectId);await this.store.checkpoint(project);this.savedRevision=revision;this.setStatus(revision===this.revision?'Local checkpoint verified; export still recommended':'Unsaved changes; another checkpoint pending');})().catch(error=>{failed=true;this.setStatus('Unsaved changes; recovery failed. Export your files.');throw error;}).finally(()=>{this.pending=null;if(!failed&&!this.stopping&&this.enabled&&this.savedRevision!==this.revision){clearTimeout(this.timer);this.timer=setTimeout(()=>this.save().catch(()=>{}),750);}});
        return this.pending;
    }
    async list(){return this.store.list();}
    async recover(id,backend){invariant(!this.enabled,'Disable current corpus recovery before restoring another corpus');const saved=await this.store.read(id,{backend});invariant(saved,'Recovery entry no longer exists');invariant(saved.data.extensions?.legacyWorkspace,'This entry belongs to the evidence workspace; open it there');await this.store.enable(id,{consent:true,expectedHash:saved.hash});try{await this.restore(saved.data);}catch(error){this.store.disable();throw error;}this.projectId=id;this.revision=0;this.savedRevision=0;this.setStatus('Corpus restored from verified local checkpoint');}
    async disable(){this.stopping=true;clearTimeout(this.timer);this.timer=null;if(this.pending)try{await this.pending;}catch{}this.store.disable();this.projectId=null;this.stopping=false;this.setStatus('Recovery off; current work remains in memory');}
    async forget(){clearTimeout(this.timer);if(this.pending)try{await this.pending;}catch{}await this.store.forget();await this.disable();this.setStatus('Local corpus recovery deleted; export to keep work');}
    async exportDatabase(){await this.save();return this.store.exportDatabase();}
}
