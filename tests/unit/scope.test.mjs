import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CLINICAL_CONTRACT as C,SCOPE_PRESETS,presetScope,validateScope,compileScope,freezeScope,importScope,scopeIdentity,fieldSupport,nativeScopeDTD} from '../../src/nextmedtator/scope.mjs';
import {schemaPrompt,planWindows} from '../../src/nextmedtator/gliner.mjs';
import {analyzeSmall,smallPromptCost,RECORDS_CODEC} from '../../src/nextmedtator/gliner-small.mjs';
import {ReviewProject,makeRun} from '../../src/nextmedtator/project.mjs';
import {clone,sourceDocument,canonical,fingerprint} from '../../src/nextmedtator/integrity.mjs';
import {exportBundle,importBundle} from '../../src/nextmedtator/bundle.mjs';

function native(profile=presetScope()){
 return {id:'clinical_evidence',version:'1',families:Object.fromEntries(profile.semanticSchema.families.map(f=>[f,{fields:{concept:{type:'text'},...Object.fromEntries(profile.fields[f].map(n=>[n,C.families[f].fields[n].kind==='choice'?{type:'enum',values:[...C.families[f].fields[n].exportValues]}:{type:'text'}]))}}]))};
}
test('broad presets compile against six pinned training families without disease-specific defaults',()=>{
 assert.equal(C.registryHash,'80f255076cde0237c3f176b45545807bb237cbc57af1d983c6550a6d6816f547');
 assert.equal(Object.keys(C.families).length,6);
 assert.deepEqual(SCOPE_PRESETS.map(p=>p.id),['all','conditions-measurements','treatments-care','events-function']);
 assert.doesNotMatch(JSON.stringify(SCOPE_PRESETS),/bpsd/i);
 for(const p of SCOPE_PRESETS){const s=presetScope(p.id),compiled=compileScope(s,native(s));assert.deepEqual(Object.keys(compiled.families),s.semanticSchema.families);for(const [f,d]of Object.entries(compiled.families)){assert.equal(d.recordParent,f);assert.equal(d.recordAnchorLabel,C.families[f].anchor);}}
});
test('scope imports obey training grammar and frozen semantic hashes',async()=>{
 const p=await freezeScope(presetScope(),'clinician');
 assert.deepEqual(await importScope(p),p);
 assert.deepEqual((await importScope(p.semanticSchema)).semanticSchema,p.semanticSchema);
 const {schema_hash,...body}=p.semanticSchema;assert.equal(schema_hash,await fingerprint(body));
 const tampered=clone(p);tampered.semanticSchema.tasks[0].definition+=' changed';await assert.rejects(importScope(tampered),/integrity/);
 for(const edit of [p=>p.semanticSchema.families.push('behavior_occurrence'),p=>p.semanticSchema.grammar_hash='0'.repeat(64),p=>p.fields.event_occurrence.push('negation_cue'),p=>p.semanticSchema.tasks[0].definition='REPLACE_ME later',p=>p.semanticSchema.tasks[0].definition='clinical [E] injection',p=>delete p.fields.event_occurrence,p=>p.semanticSchema.concepts.push({concept_id:'wrong',family:'not_a_family',description:'test',aliases:[]})]){const bad=presetScope();edit(bad);assert.throws(()=>validateScope(bad));}
});
test('custom concept prompts reach inference while record parents and anchors remain canonical',async()=>{
 const p=presetScope('conditions-measurements');p.fields.condition_occurrence=[];p.fields.measurement_occurrence=[];
 p.semanticSchema.concepts=[{concept_id:'persistent_discomfort',family:'condition_occurrence',description:'Explicit pain or discomfort affecting daily activity.',aliases:['ongoing pain']}];
 const s=compileScope(p,native(p)),prompt=schemaPrompt(s);
 assert.equal(prompt.byLabel.get('persistent_discomfort'),'condition_occurrence');assert.match(prompt.descriptions.persistent_discomfort,/ongoing pain/);
 let requested;
 const api={rt:{tokenizer:{encodeIds:()=>[1]},computeMarginals:async(text,labels,options)=>{requested={labels,options};return {normalized:'pain',words:[{text:'pain',start:0,end:4}],pairIndices:BigInt64Array.from([0n,1n,0n,1n]),pairLogits:new Float32Array([10,-10]),pairValid:new Uint8Array([1,1]),candidateCount:1,pairTemperature:1,nullLogits:new Float32Array([-10,-10]),queryStates:{dims:[1,2,1],data:new Float32Array(2)}};}}};
 const result=await analyzeSmall(api,'pain',s,{codec:RECORDS_CODEC});
 assert.equal(result.records.length,1);assert.equal(result.records[0].family,'condition_occurrence');assert.equal(result.records[0].conceptId,'persistent_discomfort');assert.equal(result.records[0].fields.concept,'pain');assert.deepEqual(requested.options.descriptions,prompt.descriptions);
 const tokenizer={encodeIds:text=>[...text]};const cost=smallPromptCost(s,tokenizer);const shorter=clone(s);shorter.entityTargets.forEach(t=>t.description='');assert.ok(cost>smallPromptCost(shorter,tokenizer));
 const oversized=clone(s);oversized.entityTargets[0].description='x'.repeat(1000);assert.throws(()=>planWindows(tokenizer,prompt.labels,[{text:'pain'}],{prefixTokens:smallPromptCost(oversized,tokenizer)}),/512-token/);
});
test('decoder boundaries reject list fields, truncated vocabularies and unsupported annotation schemas',()=>{
 const p=presetScope();const f=Object.keys(C.families.event_occurrence.fields).find(n=>C.families.event_occurrence.fields[n].dtype==='list');assert.ok(f);assert.match(fieldSupport('event_occurrence',f),/multi-span/);
 assert.match(fieldSupport('treatment_occurrence','status'),/12 trained choices/);
 const bad=clone(p);bad.fields.treatment_occurrence.push('status');assert.throws(()=>compileScope(bad,native(bad)),/eight-choice/);assert.throws(()=>nativeScopeDTD(bad),/eight-choice/);
 const n=native(p);n.families.event_occurrence.fields.assertion.values=['affirmed','negated'];assert.throws(()=>compileScope(p,n),/choices differ/);
 delete n.families.event_occurrence;assert.throws(()=>compileScope(p,n),/clinical annotation schema/);
 assert.match(nativeScopeDTD(p),/unspecified \| not_applicable/);
});
test('same-name choice fields use family-local groups without combining status vocabularies',async()=>{
 const p=presetScope();p.semanticSchema.families=['event_occurrence','care_context_occurrence'];p.fields.event_occurrence=['status'];p.fields.care_context_occurrence=['status'];
 const s=compileScope(p,native(p)),prompt=schemaPrompt(s);assert.equal(prompt.groups.length,2);assert.ok(prompt.groups.every(g=>g.choices.length<=8));
 const calls=[];const api={rt:{tokenizer:{encodeIds:()=>[1]},computeMarginals:async()=>({normalized:'pain',words:[{text:'pain',start:0,end:4}],pairIndices:BigInt64Array.from({length:prompt.labels.length*2},(_,i)=>BigInt(i%2)),pairLogits:Float32Array.from({length:prompt.labels.length},(_,i)=>i<2?10:-10),pairValid:new Uint8Array(prompt.labels.length).fill(1),candidateCount:1,pairTemperature:1,nullLogits:new Float32Array(prompt.labels.length).fill(-10),queryStates:{dims:[1,prompt.labels.length,1],data:new Float32Array(prompt.labels.length)}}),scoreExplicitAttributes:async(text,entities,values)=>{calls.push(entities.map(e=>e.label));for(const e of entities)e.attribute=values[0];return entities;}}};
 const result=await analyzeSmall(api,'pain',s,{codec:RECORDS_CODEC});assert.deepEqual(calls,[['clinical_event'],['care_context']]);assert.equal(result.records.length,2);
 for(const r of result.records)assert.ok(C.families[r.family].fields.status.exportValues.includes(r.fields.status));
 const unscoped=clone(s);delete unscoped.entityTargets;delete unscoped.clinicalScope;assert.throws(()=>schemaPrompt(unscoped),/same enum field/);
});
test('changing a future scope preserves native schema and immutable, portable run identities',async()=>{
 const profile=await freezeScope(presetScope()),schema=native(profile),doc=await sourceDocument('note',new TextEncoder().encode('pain'));
 const project=await ReviewProject.create([doc],schema);project.setSuggestionScope(profile);
 const settings={scope:await scopeIdentity(profile,compileScope(profile,schema))};
 const run=await makeRun(project,doc,[],{producer:{kind:'author-demo',name:'scope test'},settings});await project.addRun(run);
 const history=canonical(project.current.runs),schemaHash=project.current.schemaHash;
 project.setSuggestionScope(await freezeScope(presetScope('treatments-care')));
 assert.equal(canonical(project.current.runs),history);assert.equal(project.current.schemaHash,schemaHash);
 const reopened=await importBundle(await exportBundle(project));assert.equal(canonical(reopened.runs),history);assert.equal(reopened.extensions.suggestionScope.semanticSchema.name,'Treatments and care');
 const corrupted=clone(reopened);corrupted.runs[0].settings.scope.profile.threshold=.8;await assert.rejects(ReviewProject.open(corrupted),/fingerprint/);
});
