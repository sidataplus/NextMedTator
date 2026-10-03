import { invariant, canonical, sha256, jsonParse, ValidationError } from './integrity.mjs';
const DB = 'nextmedtator-recovery-v1';
const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
async function database() { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('projects', { keyPath: 'id' }); return req(r); }
/** Opt-in project recovery. CAS is the final authority even when Web Locks is unavailable. */
export class RecoveryStore {
    constructor() { this.enabled = false; this.id = null; this.expected = null; this.release = null; this.busy = false; }
    async enable(id, { consent = false, expectedHash = null } = {}) {
        invariant(consent, 'Local recovery requires explicit consent');
        invariant(!this.enabled, 'Recovery is already enabled');
        if (navigator.locks) {
            await new Promise((resolve, reject) => { navigator.locks.request(`nextmedtator:${id}`, { mode: 'exclusive', ifAvailable: true }, async (lock) => { if (!lock) {
                reject(new ValidationError('This project is open for recovery in another tab', 'TAB_CONFLICT'));
                return;
            } await new Promise(done => { this.release = done; resolve(); }); }).catch(reject); });
        }
        this.id = id;
        this.expected = expectedHash;
        this.enabled = true;
    }
    async checkpoint(project) {
        invariant(this.enabled && project.id === this.id, 'Recovery has not been enabled for this project');
        invariant(!this.busy, 'A recovery checkpoint is already in progress');
        this.busy = true;
        let db;
        try {
            const payload = canonical(project), hash = await sha256(payload);
            db = await database();
            await new Promise((resolve, reject) => {
                const tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects'), r = store.get(this.id);
                let conflict = false;
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(conflict ? new ValidationError('Recovery changed in another session. Export or branch; do not overwrite.', 'RECOVERY_CONFLICT') : tx.error ?? new Error('Recovery transaction aborted'));
                r.onsuccess = () => { if ((r.result?.hash ?? null) !== this.expected) {
                    conflict = true;
                    tx.abort();
                    return;
                } try{store.put({ id: this.id, hash, payload, updatedAt: new Date().toISOString() });}catch(error){tx.abort();reject(error);} };
            });
            this.expected = hash;
            const stored = await req(db.transaction('projects').objectStore('projects').get(this.id));
            invariant(stored?.hash === hash && await sha256(stored.payload) === hash, 'Recovery read-back verification failed');
            return hash;
        }
        finally {
            db?.close();
            this.busy = false;
        }
    }
    async read(id) { const db = await database(); try {
        const record = await req(db.transaction('projects').objectStore('projects').get(id));
        if (!record)
            return null;
        invariant(await sha256(record.payload) === record.hash, 'Recovery integrity check failed');
        return { data: jsonParse(record.payload), hash: record.hash };
    }
    finally {
        db.close();
    } }
    async list() { const db = await database(); try {
        return (await req(db.transaction('projects').objectStore('projects').getAll())).map(({ id, updatedAt }) => ({ id, updatedAt }));
    }
    finally {
        db.close();
    } }
    async forget() { invariant(this.enabled, 'Enable the selected project before deleting its recovery copy'); const db = await database(); try {
        await new Promise((resolve, reject) => { const tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects'), r = store.get(this.id); tx.oncomplete = resolve; tx.onabort = () => reject(new ValidationError('Recovery changed; deletion refused')); tx.onerror = () => reject(tx.error); r.onsuccess = () => { if ((r.result?.hash ?? null) !== this.expected) {
            tx.abort();
            return;
        } store.delete(this.id); }; });
        this.expected = null;
    }
    finally {
        db.close();
    } }
    async clear() { invariant(!this.busy,'Checkpoint in progress');this.disable();const db=await database();try{await new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);tx.objectStore('projects').clear();});}finally{db.close();} }
    disable() { invariant(!this.busy, 'Wait for the active checkpoint before disabling recovery'); this.release?.(); this.release = null; this.enabled = false; this.id = null; this.expected = null; }
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
