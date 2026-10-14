import {clone,invariant,uuid} from './integrity.mjs';

/** Keep checkpoint snapshots outside an in-progress result/auto-apply commit. */
export class CorpusCommitGate{
    constructor(){this.tail=Promise.resolve();}
    run(action){const pending=this.tail.then(action);this.tail=pending.then(()=>{},()=>{});return pending;}
}

/** Metadata only: source text and predictions remain in their existing owners. */
export function createBatchQueue(context,notes){
    invariant(notes.length>0,'Select notes for the batch');
    invariant(new Set(notes.map(n=>n.key)).size===notes.length,'Rename duplicate notes before batch analysis');
    return {version:1,id:uuid(),context,createdAt:new Date().toISOString(),state:'running',elapsedMs:0,notes:notes.map(n=>({...n,status:'pending',attempts:0}))};
}
export function restoreBatchQueue(saved){
    if(!saved)return null;
    invariant(saved.version===1&&Array.isArray(saved.notes)&&saved.notes.length<=10000&&typeof saved.context==='string'&&Number.isFinite(saved.elapsedMs)&&saved.elapsedMs>=0,'Invalid batch checkpoint');
    const queue=clone(saved);
    invariant(new Set(queue.notes.map(n=>n.key)).size===queue.notes.length,'Duplicate queue identity');
    for(const note of queue.notes){
        invariant(typeof note.key==='string'&&typeof note.filename==='string'&&typeof note.sourceHash==='string'&&Number.isInteger(note.attempts)&&note.attempts>=0&&['pending','running','completed','failed','cancelled'].includes(note.status),'Invalid queued note');
        if(note.status==='running')note.status='pending';
    }
    if(queue.state==='running')queue.state='paused';
    return queue;
}
export function queueCounts(queue){
    const counts={total:queue?.notes.length??0,completed:0,failed:0,pending:0,running:0,cancelled:0};
    for(const note of queue?.notes??[])counts[note.status]++;
    return counts;
}
export function checkpointBatchQueue(queue,hasRun){
    if(!queue)return null;
    const saved=clone(queue);
    // Corpus capture can overlap inference. Never mark a note finished unless
    // the same checkpoint actually contains its saved prediction run.
    for(const note of saved.notes)if(note.status==='completed'&&!hasRun(note.key,note.runId)){
        note.status='pending';delete note.runId;delete note.suggestions;
    }
    return saved;
}
export function queueWork(queue,context,{retryFailed=false}={}){
    invariant(queue&&queue.context===context,'Model, schema, threshold or review mode changed. Restore the batch settings to resume, or start a new batch.');
    return queue.notes.filter(n=>retryFailed?n.status==='failed':['pending','cancelled'].includes(n.status));
}
export function batchReport(queue,{blind=false}={}){
    const report=clone(queue);
    // A blind job must not reveal prediction counts before explicit reveal.
    if(blind||queue.settings?.mode==='blind')for(const note of report.notes){delete note.suggestions;delete note.runId;}
    return {...report,counts:queueCounts(queue),exportedAt:new Date().toISOString()};
}
