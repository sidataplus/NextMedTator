import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import sqliteInit from '@sqlite.org/sqlite-wasm';
import {loadCore,compareCore,validateCore} from '../../src/nextmedtator/backend/core-loader.mjs';
import {SQLiteProjectStore} from '../../src/nextmedtator/backend/storage-engine.mjs';
import {demoProject,authoredReference,authoredSuggestionRun} from '../../src/nextmedtator/samples.mjs';
import {compareSnapshots} from '../../src/nextmedtator/compare.mjs';
import {validateRecords} from '../../src/nextmedtator/contracts.mjs';
import {clone,canonical,OffsetMap} from '../../src/nextmedtator/integrity.mjs';
import {WorkerRPC} from '../../src/nextmedtator/backend/rpc.mjs';
const core=await loadCore(await readFile('wasm/core/target/wasm32-unknown-unknown/release/nextmedtator_core.wasm'));
const sqlite=await sqliteInit({wasmBinary:await readFile('node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm'),print:()=>{},printErr:()=>{}});
function database(){const db=new sqlite.oo1.DB(':memory:','c');return {db,store:new SQLiteProjectStore(db,core)};}
async function fixture(){const p=await demoProject(),records=authoredReference(p.current.documents[0]);records[0].relations=[{type:'related',targetId:records[1].id}];p.transformRecords([],records);await p.addRun(await authoredSuggestionRun(p,p.current.documents[0]));for(const d of p.current.documents)p.completeness(d.id,{families:Object.keys(p.current.schema.families),ranges:[[0,new OffsetMap(d.text).length]],omissionsChecked:true,relationsChecked:true});return p;}
test('compiled Rust offsets/search preserve code points, UTF-16, CRLF, combining text and duplicate mentions',()=>{const text='ไทย 👩‍⚕️\r\né diabetes diabetes',map=new OffsetMap(text);assert.deepEqual(core({operation:'offsets',text}).codePointToUTF16,map.cpTo16);const matches=core({operation:'search',text,needle:'diabetes'});assert.equal(matches.length,2);for(const span of matches)assert.deepEqual(span,map.span(span.start,span.end));assert.throws(()=>core({operation:'search',text,needle:''}));});
test('Rust validator accepts source contracts and rejects mismatched spans, duplicates, invalid enums and dangling links',async()=>{const p=await fixture();assert.deepEqual(validateCore(core,p.current),{valid:true});for(const mutate of [r=>r[0].anchor[0].text='wrong',r=>r[1].id=r[0].id,r=>r[0].fields.assertion='invalid',r=>r[0].relations[0].targetId='missing',r=>r[0].score=Infinity,r=>r[0].fields.concept=NaN]){const records=clone(p.current.draft.records);mutate(records);assert.throws(()=>validateRecords(records,p.current.documents,p.current.schema));assert.throws(()=>core({operation:'validate',records,documents:p.current.documents,schema:p.current.schema}));}});
test('compiled Rust comparison exactly preserves JavaScript reports for fields, evidence, relations, coverage and matching choices',async()=>{const p=await fixture(),a=await p.snapshot();for(const mode of ['exact','overlap'])for(const covered of [true,false]){const b=clone(a);delete b.hash;b.id='second';b.records[0].fields.experiencer='patient';b.records[0].evidence=[new OffsetMap(p.current.documents[0].text).span(0,3)];b.records[0].relations=[];b.completeness[b.records[0].documentId].relationsChecked=covered;const options={mode,referenceDeclared:true};assert.equal(canonical(await compareCore(core,a,b,options)),canonical(await compareSnapshots(a,b,options)));}});
test('Rust maximum-cardinality matcher agrees with the reference on ambiguous overlapping candidates and excluded failed documents',async()=>{const p=await fixture(),a=await p.snapshot(),b=clone(a);delete b.hash;b.kind='machine';b.completeness[a.records[0].documentId]={full:false,status:'failed',coverage:[]};assert.equal(canonical(await compareCore(core,a,b)),canonical(await compareSnapshots(a,b)));b.kind='human';b.completeness=clone(a.completeness);b.records=[clone(a.records[0]),clone(a.records[0])];b.records[0].id='Z-1';b.records[1].id='a-2';for(const r of b.records)r.relations=[];assert.equal(canonical(await compareCore(core,a,b,{mode:'overlap'})),canonical(await compareSnapshots(a,b,{mode:'overlap'})));});
test('actual SQLite-WASM transaction preserves native identity plus normalized records, events, model runs, snapshots and comparisons',async()=>{const {db,store}=database();try{const p=await fixture(),a=await p.snapshot(),b=clone(a);delete b.hash;b.id='B';await p.importSnapshot({...b,hash:await (await import('../../src/nextmedtator/integrity.mjs')).fingerprint(b)});const report=await compareSnapshots(a,p.current.snapshots[1]);await p.addComparison(report);const hash=await store.checkpoint(p.current,null),restored=await store.read(p.current.id);assert.equal(canonical(restored.data),canonical(p.current));assert.equal(hash,restored.hash);assert.equal(store.query(p.current.id).events,p.current.events.length);assert.deepEqual(store.query(p.current.id,{kind:'records'}),p.current.draft.records);assert.equal(db.selectValue('SELECT COUNT(*) FROM model_runs'),p.current.runs.length);assert.equal(db.selectValue('SELECT COUNT(*) FROM snapshots'),2);assert.equal(db.selectValue('SELECT COUNT(*) FROM comparisons'),1);assert.equal(db.selectValue('PRAGMA secure_delete'),1);}finally{db.close();}});
test('SQLite CAS and statement failure roll back atomically and retain the last verified checkpoint',async()=>{const {db,store}=database();try{const p=await fixture(),hash=await store.checkpoint(p.current,null);p.record({...clone(p.current.draft.records[0]),id:'extra',relations:[]});await assert.rejects(store.checkpoint(p.current,null),/another session/);db.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON review_events BEGIN SELECT RAISE(ABORT,'injected disk write failure'); END;");await assert.rejects(store.checkpoint(p.current,hash));assert.equal((await store.read(p.current.id)).hash,hash);assert.equal(store.query(p.current.id,{kind:'records'}).length,2);db.exec('DROP TRIGGER injected_failure');await store.checkpoint(p.current,hash);assert.equal(store.query(p.current.id,{kind:'records'}).length,3);}finally{db.close();}});
test('SQLite fixed queries reject arbitrary SQL, paginate safely and cascade deletion',async()=>{const {db,store}=database();try{const p=await fixture(),hash=await store.checkpoint(p.current,null);assert.throws(()=>store.query(p.current.id,{kind:'DROP TABLE projects'}));assert.throws(()=>store.query(p.current.id,{limit:1001}));assert.equal(store.query(p.current.id,{kind:'records',limit:1,offset:1}).length,1);assert.equal(store.query("x' OR 1=1 --",{kind:'records'}).length,0);assert.throws(()=>store.forget(p.current.id,'stale'));store.forget(p.current.id,hash);assert.equal(store.list().length,0);assert.equal(db.selectValue('SELECT COUNT(*) FROM records'),0);}finally{db.close();}});
test('actual SQLITE_FULL leaves the previous durable project intact',async()=>{
    const {db,store}=database();try{
        const p=await fixture(),hash=await store.checkpoint(p.current,null);
        db.exec('PRAGMA max_page_count='+db.selectValue('PRAGMA page_count'));
        const larger=clone(p.current);larger.extensions.quotaProbe='synthetic'.repeat(100000);
        await assert.rejects(store.checkpoint(larger,hash));
        assert.equal((await store.read(p.current.id)).hash,hash);
        assert.equal(store.query(p.current.id,{kind:'records'}).length,2);
    }finally{db.close();}
});
test('cancellation rejects both active and queued RPC work without restarting a worker',async()=>{
    const original=globalThis.Worker;let starts=0,terminated=0;
    globalThis.Worker=class {constructor(){starts++;}postMessage(){}terminate(){terminated++;}};
    try{
        const rpc=new WorkerRPC('synthetic-worker',{timeout:10000}),a=rpc.request('first'),b=rpc.request('second');
        const results=Promise.allSettled([a,b]);await Promise.resolve();rpc.close();
        for(const r of await results){assert.equal(r.status,'rejected');assert.equal(r.reason.code,'WORKER_CANCELLED');}
        assert.equal(starts,1);assert.equal(terminated,1);
    }finally{globalThis.Worker=original;}
});
test('Rust matching/report conformance covers varied overlap graphs, thresholds, IDs and linkage',async()=>{
    const p=await fixture(),base=await p.snapshot(),map=new OffsetMap(p.current.documents[0].text);
    let seed=1753;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
    for(let sample=0;sample<40;sample++){
        const snapshots=['reference','candidate'].map((name,side)=>{
            const snapshot=clone(base);delete snapshot.hash;snapshot.id=name;
            snapshot.records=Array.from({length:random(12)},(_,i)=>{
                const start=random(25),end=start+1+random(15);
                return {id:(i%2?'a-':'Z-')+i,documentId:p.current.documents[0].id,family:'condition_occurrence',anchor:[map.span(start,end)],fields:{concept:'fixture',assertion:random(3)?'present':null,experiencer:side?'family':'patient'},evidence:random(2)?[]:[map.span(0,3)],relations:[]};
            });
            if(snapshot.records.length>1)snapshot.records[0].relations=[{type:'related',targetId:snapshot.records[1].id}];
            snapshot.completeness[p.current.documents[0].id].relationsChecked=sample%3!==0;
            return snapshot;
        });
        for(const options of [{mode:'exact'},{mode:'overlap',iou:.25},{mode:'overlap',iou:.5},{mode:'overlap',iou:.9}])assert.equal(canonical(await compareCore(core,...snapshots,options)),canonical(await compareSnapshots(...snapshots,options)),`graph ${sample}, ${JSON.stringify(options)}`);
    }
});
test('compiled validation cannot attribute a record from a different source to a model run',async()=>{
    const p=await fixture(),bad=clone(p.current);
    bad.runs[0].records=[authoredReference(p.current.documents[1])[0]];
    assert.throws(()=>validateCore(core,bad),/Unknown source/);
});
