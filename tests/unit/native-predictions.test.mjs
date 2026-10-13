import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativePredictionProject,NATIVE_NOTICE} from '../../scripts/native_predictions.mjs';
import {exportBundle,importBundle} from '../../src/nextmedtator/bundle.mjs';
const receipt=()=>({format:'nextmedtator-native-predictions-v1',model:{repository:'synthetic/test',revision:'a'.repeat(40),runtimeCommit:'b'.repeat(40)},settings:{maxEncodedTokens:1024,clinicalValidation:false},runtime:{torch:'fixture'},schema:{id:'synthetic',entities:[{id:'behavior',label:'Behavior'}],attributes:[{label:'certainty',appliesTo:['behavior'],values:[{label:'confirmed'}]}]},notes:[{id:'synthetic-unicode',text:'👩‍⚕️ Café yelling yelling',encodedTokens:80,status:'complete',result:{entities:{Behavior:[{start:10,end:17,text:'yelling',confidence:.9,certainty:{label:'certainty: confirmed',confidence:.8}}]}}}]});
test('native Unicode spans and explicit attributes survive portable review without defaults',async()=>{
 const input=receipt();input.notes[0].result.entities.Behavior.push({start:18,end:25,text:'yelling',confidence:.7});
 const project=await nativePredictionProject(input);
 assert.equal(project.current.runs[0].records.length,2);
 assert.deepEqual(project.current.runs[0].records.map(r=>[r.anchor[0].start,r.anchor[0].end]),[[10,17],[18,25]]);
 assert.deepEqual(project.current.runs[0].records[1].fields,{});
 assert.equal(project.current.runs[0].records[0].fields.certainty,'confirmed');
 assert.match(project.current.runs[0].producer.notice,/No browser inference/);
 assert.equal(project.current.runs[0].settings.clinicalValidation,false);
 assert.equal(project.current.draft.records.length,0);
 assert.equal(NATIVE_NOTICE,project.current.schema.description);
});
test('native imports reject wrong anchors, unsupported attributes, defaults and over-capacity success',async()=>{
 for(const mutate of [r=>r.notes[0].result.entities.Behavior[0].text='wrong',r=>r.notes[0].result.entities.Behavior[0].certainty.label='confirmed',r=>r.notes[0].result.entities.Behavior[0].negated={label:'negated: no',confidence:1},r=>r.notes[0].encodedTokens=1025,r=>r.settings.clinicalValidation=true]){const input=receipt();mutate(input);await assert.rejects(nativePredictionProject(input));}
});
test('unsupported native documents retain no fabricated predictions or coverage',async()=>{const input=receipt();input.notes[0].status='unsupported';input.notes[0].encodedTokens=1025;delete input.notes[0].result;const project=await nativePredictionProject(input);assert.equal(project.current.runs[0].records.length,0);assert.equal(project.current.runs[0].status,'unsupported');assert.deepEqual(project.current.runs[0].coverage,[]);});
test('source entity IDs remain family identities when display labels contain spaces',async()=>{
 const input=receipt();input.schema.entities[0]={id:'motor_agitation',label:'Motor agitation'};
 input.schema.attributes[0].appliesTo=['motor_agitation'];
 input.notes[0].result.entities={'Motor agitation':input.notes[0].result.entities.Behavior};
 const project=await nativePredictionProject(input);
 assert.deepEqual(Object.keys(project.current.schema.families),['motor_agitation']);
 assert.equal(project.current.schema.families.motor_agitation.label,'Motor agitation');
 const run=project.current.runs[0];assert.equal(run.records[0].family,'motor_agitation');
 assert.equal(run.records[0].fields.certainty,'confirmed');
 project.review(run.id,run.records[0].id,'accepted');
 const reopened=await importBundle(await exportBundle(project));
 assert.equal(reopened.runs[0].records[0].family,'motor_agitation');
 assert.equal(reopened.draft.records[0].family,'motor_agitation');
});
test('native source schema IDs must be valid and unique',async()=>{
 const duplicate=receipt();duplicate.schema.entities.push({id:'behavior',label:'Different label'});
 await assert.rejects(nativePredictionProject(duplicate),/Duplicate identifier/);
 const invalid=receipt();invalid.schema.entities[0].id='bad id';
 await assert.rejects(nativePredictionProject(invalid),/Invalid identifier/);
});
