import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReviewProject} from '../../src/nextmedtator/project.mjs';
import {demoProject, authoredSuggestionRun} from '../../src/nextmedtator/samples.mjs';
import {canonical, clone} from '../../src/nextmedtator/integrity.mjs';
import {exportBundle, importBundle} from '../../src/nextmedtator/bundle.mjs';
import {legacyRecords} from '../../src/nextmedtator/assist.mjs';

test('bulk machine application is unreviewed, portable, reversible and preserves predictions', async () => {
    const p = await demoProject(), run = await authoredSuggestionRun(p,p.current.documents[0]);
    await p.addRun(run);
    const machine = canonical(p.current.runs), before = canonical(p.current.draft);
    p.applyMachineGroup(run.id,run.records);
    assert.equal(p.current.draft.records.length,run.records.length);
    for (const r of p.current.draft.records) {
        assert.equal(r.origin.kind,'machine-applied');
        assert.equal(r.origin.reviewStatus,'unreviewed');
        assert.equal(r.origin.runId,run.id);
        assert.equal(p.current.draft.decisions[`${run.id}/${r.origin.recordId}`].status,'applied');
    }
    assert.deepEqual(p.current.draft.completeness,{});
    const applied = canonical(p.current);
    assert.throws(()=>p.applyMachineGroup(run.id,run.records),/already decided/);
    assert.equal(canonical(p.current),applied);
    assert.equal(canonical(p.current.runs),machine);
    assert.equal(canonical(await importBundle(await exportBundle(p))),applied);
    const snapshot = await p.snapshot();
    assert.equal(snapshot.independent,false);
    p.undo();
    assert.equal(canonical(p.current.draft),before);
    assert.equal(canonical(p.current.runs),machine);
});

test('bulk application preflight cannot partially write invalid occurrences or overwrite rejection', async () => {
    const p = await demoProject(), run = await authoredSuggestionRun(p,p.current.documents[0]);
    await p.addRun(run);
    const invalid = clone(run.records); invalid.at(-1).anchor[0].text = 'wrong source';
    const before = canonical(p.current);
    assert.throws(()=>p.applyMachineGroup(run.id,invalid),/source occurrence/);
    assert.equal(canonical(p.current),before);
    p.review(run.id,run.records[0].id,'rejected');
    const rejected = canonical(p.current);
    assert.throws(()=>p.applyMachineGroup(run.id,run.records),/already decided/);
    assert.equal(canonical(p.current),rejected);
});

test('auto apply cannot expose a frozen blind annotation', async () => {
    const p = await demoProject('blind'), run = await authoredSuggestionRun(p,p.current.documents[0]);
    await p.snapshot(); await p.addRun(run);
    const before = canonical(p.current);
    assert.throws(()=>p.applyMachineGroup(run.id,run.records),/frozen/);
    assert.equal(canonical(p.current),before);
});

test('native empty enum values retain model abstention instead of a schema default', () => {
    const schema = {families:{condition_occurrence:{fields:{concept:{type:'text'},assertion:{type:'enum',values:['affirmed','negated']}}}}};
    const ann = {text:'pain',tags:[{id:'C0',tag:'condition_occurrence',spans:'0~4',text:'pain',assertion:''}]};
    assert.equal(legacyRecords(ann,{id:'d',text:'pain'},schema)[0].fields.assertion,null);
    schema.families.condition_occurrence.fields.assertion.values.push('');
    assert.equal(legacyRecords(ann,{id:'d',text:'pain'},schema)[0].fields.assertion,'');
});
