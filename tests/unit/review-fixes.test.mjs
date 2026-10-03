import {test} from 'node:test';
import assert from 'node:assert/strict';
import {finalizeSmallRecords} from '../../src/nextmedtator/gliner-small.mjs';
import {clone,canonical,OffsetMap,sourceDocument} from '../../src/nextmedtator/integrity.mjs';
import {ReviewProject,makeRun} from '../../src/nextmedtator/project.mjs';
import {demoProject,authoredReference} from '../../src/nextmedtator/samples.mjs';
import {compareSnapshots} from '../../src/nextmedtator/compare.mjs';
import {previewSchemaMigration,applySchemaMigration} from '../../src/nextmedtator/migration.mjs';

test('window reconciliation suppresses boundary and field variants without collapsing separate occurrences or families',async()=>{
    const doc=await sourceDocument('d',new TextEncoder().encode('alpha beta gamma delta alpha')),map=new OffsetMap(doc.text);
    const schema={id:'s',version:'1',families:{a:{fields:{concept:{type:'text'}}},b:{fields:{concept:{type:'text'}}}}};
    const record=(id,family,start,end,score,concept)=>({id,documentId:'d',family,anchor:[map.span(start,end)],fields:{concept},evidence:[],score});
    const input=[record('window-1','a',0,5,.6,'first context'),record('window-2','a',0,10,.9,'second context'),record('window-3','a',0,10,.7,'third context'),record('separate','a',23,28,.8,'alpha'),record('other-family','b',0,5,.8,'alpha')];
    const records=finalizeSmallRecords(input,doc.text);
    assert.deepEqual(records.map(r=>r.id),['window-2','separate','other-family']);
    assert.equal(records[0].fields.concept,'second context');
    const project=await ReviewProject.create([doc],schema);await project.addRun(await makeRun(project,doc,records,{producer:{kind:'model'}}));
    assert.equal(project.current.runs[0].records.length,3);
});

test('record-backed evidence in reverse field order and overlapping duplicate spans remains valid source coverage',async()=>{
    const doc=await sourceDocument('d',new TextEncoder().encode('alpha beta gamma')),map=new OffsetMap(doc.text);
    const schema={id:'s',version:'1',families:{a:{fields:{left:{type:'span'},right:{type:'span'}}}}};
    const record={id:'r',documentId:'d',family:'a',anchor:[map.span(0,5)],fields:{left:[map.span(6,10)],right:[map.span(6,16)]},evidence:[map.span(11,16),map.span(6,10),map.span(6,10),map.span(6,16),map.span(0,5)],score:.9};
    const [result]=finalizeSmallRecords([record],doc.text);
    assert.deepEqual(result.evidence,[map.span(0,5),map.span(6,16)]);
    assert.deepEqual(result.fields,record.fields);assert.equal(record.evidence.length,5);
    const project=await ReviewProject.create([doc],schema);await project.addRun(await makeRun(project,doc,[result],{producer:{kind:'model'}}));
});

async function linkedProject(){
    const project=await demoProject(),records=authoredReference(project.current.documents[0]);
    records[0].relations=[{type:'related',targetId:records[1].id}];project.transformRecords([],records);return project;
}
async function complete(project){for(const doc of project.current.documents)project.completeness(doc.id,{families:Object.keys(project.current.schema.families),ranges:[[0,new OffsetMap(doc.text).length]],omissionsChecked:true,relationsChecked:true});return project.snapshot();}
test('unreviewed relations on either side generate neither missing nor extra linkage errors',async()=>{
    const project=await linkedProject(),reference=await complete(project),candidate=clone(reference);delete candidate.hash;candidate.id='b';
    candidate.records[0].relations=[];candidate.records[1].relations=[{type:'related',targetId:candidate.records[0].id}];
    const covered=await compareSnapshots(reference,candidate);assert.equal(covered.relationMetrics.fn,1);assert.equal(covered.relationMetrics.fp,1);
    for(const side of ['reference','candidate']){
        const a=clone(reference),b=clone(candidate);(side==='reference'?a:b).completeness[reference.records[0].documentId].relationsChecked=false;
        const report=await compareSnapshots(a,b);assert.equal(report.relationMetrics.status,'not-applicable');assert.equal(report.disagreements.filter(d=>d.kind.endsWith('linkage')).length,0);assert.equal(report.recordCompleteness.f1,1);
    }
});

test('merging linked occurrences remaps both incoming endpoints, retains both outgoing sets, removes internal edges and is reversible',async()=>{
    const doc=await sourceDocument('d',new TextEncoder().encode('alpha beta gamma delta')),map=new OffsetMap(doc.text),schema={id:'s',version:'1',families:{a:{fields:{concept:{type:'text'}}}},relations:{related:{head:['a'],tail:['a']}}};
    const project=await ReviewProject.create([doc],schema);
    const records=[[0,5],[6,10],[11,16],[17,22]].map(([a,b],i)=>({id:'r'+i,documentId:'d',family:'a',anchor:[map.span(a,b)],fields:{concept:map.span(a,b).text},evidence:[map.span(a,b)],relations:[]}));
    records[0].relations=[{type:'related',targetId:'r1'},{type:'related',targetId:'r2'}];records[1].relations=[{type:'related',targetId:'r3'}];records[2].relations=[{type:'related',targetId:'r0'},{type:'related',targetId:'r1'}];
    project.transformRecords([],records);const before=canonical(project.current.draft);
    const mergedId=project.mergeRecords('r0','r1'),merged=project.current.draft.records.find(r=>r.id===mergedId);
    assert.deepEqual(merged.relations,[{type:'related',targetId:'r2'},{type:'related',targetId:'r3'}]);assert.deepEqual(project.current.draft.records.find(r=>r.id==='r2').relations,[{type:'related',targetId:mergedId}]);
    assert.equal(merged.fields.concept,'alpha');assert.equal(project.current.events.at(-1).details.removedSelfRelations,1);
    await ReviewProject.open(project.current);project.undo();assert.equal(canonical(project.current.draft),before);
});

for(const role of ['head','tail'])test(`migration reports incompatible ${role} family edges as losses while retaining valid records`,async()=>{
    const project=await linkedProject(),schema=clone(project.current.schema),family=project.current.draft.records[0].family;
    schema.version='2';schema.families.revised=clone(schema.families[family]);delete schema.families[family];
    const other=Object.keys(schema.families).find(id=>id!=='revised');schema.relations={related:{head:role==='head'?[other]:['revised'],tail:role==='tail'?[other]:['revised']}};
    const before=canonical(project.current),proposal=await previewSchemaMigration(project,schema,{families:{[family]:'revised'}});
    assert.equal(proposal.records.length,project.current.draft.records.length);assert.deepEqual(proposal.records[0].relations,[]);
    assert.equal(proposal.report.losses.length,1);assert.match(proposal.report.losses[0].reason,/head or tail family incompatible/);assert.equal(proposal.report.losses[0].targetId,project.current.draft.records[1].id);
    await applySchemaMigration(project,proposal);assert.equal(canonical(project.current),before);
});
