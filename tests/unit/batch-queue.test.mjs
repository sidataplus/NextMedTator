import test from 'node:test';
import assert from 'node:assert/strict';
import {CorpusCommitGate,createBatchQueue,restoreBatchQueue,checkpointBatchQueue,queueCounts,queueWork,batchReport} from '../../src/nextmedtator/batch-queue.mjs';

test('checkpoint waits for a complete result commit and failures do not lock the queue',async()=>{
    const gate=new CorpusCommitGate(),events=[];let release;
    const hold=new Promise(resolve=>release=resolve);
    const commit=gate.run(async()=>{events.push('result');await hold;events.push('tags');});
    const snapshot=gate.run(()=>events.push('checkpoint'));
    await Promise.resolve();assert.deepEqual(events,['result']);
    release();await Promise.all([commit,snapshot]);assert.deepEqual(events,['result','tags','checkpoint']);
    await assert.rejects(gate.run(()=>{throw Error('failed commit');}),/failed commit/);
    assert.equal(await gate.run(()=>42),42);
});

const notes=Array.from({length:5},(_,i)=>({key:String(i),filename:`note-${i}`,sourceHash:String(i)}));
test('checkpoint never skips a completed run absent from the captured corpus',()=>{
    const q=createBatchQueue('settings',notes);Object.assign(q.notes[0],{status:'completed',runId:'saved'});Object.assign(q.notes[1],{status:'completed',runId:'new'});
    const saved=checkpointBatchQueue(q,(key,id)=>key==='0'&&id==='saved');
    assert.equal(saved.notes[0].status,'completed');assert.equal(saved.notes[1].status,'pending');assert.equal(saved.notes[1].runId,undefined);assert.equal(q.notes[1].status,'completed');
});
test('resume preserves completed work, retry targets only failures, and context must match',()=>{
    const q=createBatchQueue('settings',notes);
    q.notes[0].status='completed';q.notes[1].status='failed';q.notes[2].status='cancelled';
    assert.deepEqual(queueWork(q,'settings').map(n=>n.key),['2','3','4']);
    assert.deepEqual(queueWork(q,'settings',{retryFailed:true}).map(n=>n.key),['1']);
    assert.throws(()=>queueWork(q,'new-model'),/changed/);
    assert.deepEqual(queueCounts(q),{total:5,completed:1,failed:1,cancelled:1,running:0,pending:2});
});
test('recovery converts interrupted work to pending and preserves completed receipts',()=>{
    const q=createBatchQueue('settings',notes);q.notes[0].status='completed';q.notes[0].runId='saved';q.notes[1].status='running';
    const restored=restoreBatchQueue(JSON.parse(JSON.stringify(q)));
    assert.equal(restored.state,'paused');assert.equal(restored.notes[1].status,'pending');assert.equal(restored.notes[0].runId,'saved');
    assert.equal(q.notes[1].status,'running');
});
test('report retains outcomes without source text and hides predictions in blind mode',()=>{
    const q=createBatchQueue('settings',notes);Object.assign(q.notes[0],{status:'completed',suggestions:4,runId:'r'});
    assert.equal(batchReport(q).notes[0].suggestions,4);
    assert.equal(batchReport(q,{blind:true}).notes[0].suggestions,undefined);
    assert.equal(q.notes[0].suggestions,4);
    q.settings={mode:'blind'};
    assert.equal(batchReport(q,{blind:false}).notes[0].suggestions,undefined);
    assert.equal(batchReport(q,{blind:false}).notes[0].runId,undefined);
    assert.throws(()=>createBatchQueue('settings',[notes[0],notes[0]]),/duplicate/);
});
