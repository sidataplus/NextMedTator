import {wasmThreadCount} from '../../src/nextmedtator/inference-options.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {CLINICAL_V3,CLINICAL_V3_CODEC,clinicalV3Schema,clinicalV3Prompt} from '../../src/nextmedtator/clinical-v3.mjs';
import {schemaPrompt} from '../../src/nextmedtator/gliner.mjs';
import {presetScope,nativeScopeDTD,compileScope,fieldSupport} from '../../src/nextmedtator/scope.mjs';
const schema=()=>({id:'v3-test',version:'1',families:{condition_occurrence:{label:'condition_occurrence',fields:{concept:{type:'text'},...Object.fromEntries(Object.entries(CLINICAL_V3.axes).map(([key,axis])=>[key,{type:'enum',values:[...axis.labels.map(row=>row.value),'unspecified','not_applicable']} ])),time_text:{type:'span'},severity:{type:'enum',values:['mild','severe']}}}}});
test('V3 projects native administrative vocabulary without inventing defaults or record binding',()=>{
 const native=schema(),projected=clinicalV3Schema(native),prompt=schemaPrompt(projected);
 assert.equal(projected.families.condition_occurrence.label,'clinical_condition');
 assert.deepEqual(Object.keys(projected.families.condition_occurrence.fields),['concept','assertion','experiencer','time_frame']);
 assert(native.families.condition_occurrence.fields.time_text);
 assert(prompt.labels.includes('assertion: ruled out'));
 assert(prompt.labels.includes('time frame: historical'));
 assert(!prompt.labels.includes('time_frame: historical'));
 assert(!prompt.labels.some(label=>label.includes('unspecified')||label.includes('not_applicable')));
 assert.equal(prompt.descriptions.clinical_condition,CLINICAL_V3.core.clinical_condition);
 assert.deepEqual(prompt.groups.find(g=>g.field==='assertion').choices.map(c=>c.value),['affirmed','hypothetical','negated','ruled_out','uncertain']);
});
test('V3 rejects incomplete or foreign axis vocabularies instead of treating omitted values as defaults',()=>{
 const native=schema();native.families.condition_occurrence.fields.assertion.values=['affirmed','negated'];
 assert.throws(()=>clinicalV3Schema(native),/full trained/);
 native.families.condition_occurrence.fields.assertion.values=CLINICAL_V3.axes.assertion.labels.map(r=>r.value).concat('positive');
 assert.throws(()=>clinicalV3Schema(native),/Unknown V3 axis/);
});
test('V3 broad presets retain the grammar and make unqualified field binding unavailable',()=>{
 const draft=presetScope('events-function',CLINICAL_V3_CODEC);
 assert.equal(draft.threshold,.6);
 assert.deepEqual(draft.fields.event_occurrence,['assertion','time_frame','experiencer']);
 assert.equal(fieldSupport('event_occurrence','assertion',CLINICAL_V3_CODEC),null);
 assert.match(fieldSupport('event_occurrence','time_text',CLINICAL_V3_CODEC),/no qualified record binding/);
 assert(nativeScopeDTD(draft).includes('ruled_out'));
 draft.fields.condition_occurrence=['time_text'];draft.semanticSchema.families=['condition_occurrence'];
 assert.throws(()=>compileScope(draft,schema(),CLINICAL_V3_CODEC),/no qualified record binding/);
});


test('release prompts retain all 18 trained queries when the output scope selects one family and axis',()=>{
 const projected=clinicalV3Schema(schema());projected.families.condition_occurrence.fields={concept:{type:'text'},assertion:projected.families.condition_occurrence.fields.assertion};
 const requested=schemaPrompt(projected),full=clinicalV3Prompt(projected,{labels:requested.labels.slice(0,requested.contentCount),byLabel:requested.byLabel},{complete:true});
 assert.equal(full.labels.length,18);assert.equal(full.contentCount,6);assert.deepEqual(full.descriptions,CLINICAL_V3.core);
 assert.deepEqual(full.groups.map(g=>g.choices.length),[5,3,4]);assert.equal(full.byLabel.get('clinical_condition'),'condition_occurrence');
 assert.throws(()=>clinicalV3Prompt(projected,{labels:['custom-condition'],byLabel:new Map()},{complete:true}),/canonical family labels/);
});


test('WASM thread policy uses one thread without isolation and caps available hardware at four',()=>{
 assert.equal(wasmThreadCount({crossOriginIsolated:false,hardwareConcurrency:16}),1);
 for(const [hardwareConcurrency,expected] of [[0,1],[2,2],[32,4]])assert.equal(wasmThreadCount({crossOriginIsolated:true,hardwareConcurrency}),expected);
});
