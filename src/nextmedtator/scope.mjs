import {CLINICAL_V3_CODEC,CLINICAL_V3,clinicalV3Schema} from './clinical-v3.mjs';
import {CLINICAL_CONTRACT as CONTRACT} from './clinical-contract.mjs';
import {clone, freeze, fingerprint, invariant, canonical} from './integrity.mjs';
import {validateSchema} from './contracts.mjs';
import {validateSmallSchema} from './gliner-small.mjs';

export {CONTRACT as CLINICAL_CONTRACT};
export const SCOPE_FORMAT = 'nextmedtator-clinical-scope-v1';
export const FAMILY_TITLES = freeze({condition_occurrence:'Conditions and symptoms',measurement_occurrence:'Measurements',treatment_occurrence:'Treatments',event_occurrence:'Actions, experiences and states',function_occurrence:'Function and activities',care_context_occurrence:'Care settings and support'});
const DESCRIPTIONS = freeze({condition_occurrence:'Diagnoses, disorders, symptoms and clinical states.',measurement_occurrence:'Named clinical measurements, tests and scores.',treatment_occurrence:'Medications, procedures and other medical interventions.',event_occurrence:'Clinical actions, episodes, behaviors, psychological experiences and persistent states.',function_occurrence:'Daily living, mobility, transfers and communication activities.',care_context_occurrence:'Care services, settings, goals and support.'});
const ALL = Object.keys(CONTRACT.families);
export const SCOPE_PRESETS = freeze([
    {id:'all',name:'All clinical evidence',families:ALL,definition:'Extract explicitly documented clinical evidence across the selected record families.'},
    {id:'conditions-measurements',name:'Conditions and measurements',families:['condition_occurrence','measurement_occurrence'],definition:'Extract documented clinical conditions, symptoms, measurements and test results.'},
    {id:'treatments-care',name:'Treatments and care',families:['treatment_occurrence','care_context_occurrence'],definition:'Extract documented medications, interventions, care services, settings and support.'},
    {id:'events-function',name:'Actions and function',families:['event_occurrence','function_occurrence'],definition:'Extract documented actions, experiences, states and functional activities.'}
]);

export function presetScope(id='all',codec=null,threshold=null) {
    const preset=SCOPE_PRESETS.find(p=>p.id===id);invariant(preset,'Unknown broad scope preset');
    return {format:SCOPE_FORMAT,threshold:threshold??(codec===CLINICAL_V3_CODEC?.6:.5),fields:Object.fromEntries(ALL.map(f=>[f,codec===CLINICAL_V3_CODEC?['assertion','time_frame','experiencer']:['assertion','time_frame','experiencer','time_text']])),
        semanticSchema:{schema_version:CONTRACT.semanticSchemaVersion,name:preset.name,version:'1',grammar_hash:CONTRACT.registryHash,
            families:[...preset.families],tasks:[{task_id:'clinical_scope',definition:preset.definition}],concepts:[],relations:[],
            parent_schema_hash:null,discovery_plan_hash:null,deferred_proposals:[],frozen_by:null,frozen_at:null,schema_hash:null}};
}
function exactKeys(object,allowed,label) {
    invariant(object && Object.getPrototypeOf(object)===Object.prototype,`${label} must be a JSON object`);
    invariant(Object.keys(object).every(k=>allowed.includes(k)),`Unknown ${label} property`);
}
function text(value,min,max,label) {
    invariant(typeof value==='string'&&value.trim().length>=min&&value.length<=max,`${label} must contain ${min}–${max} characters`);
    invariant(!/\[(?:E|P|C|R|DESCRIPTION|SEP_TEXT|SEP_STRUCT)\]/.test(value),`${label} contains a reserved model token`);
}
function slug(value,label) {invariant(typeof value==='string'&&/^[a-z][a-z0-9_]{1,95}$/.test(value),`${label} must be a stable lowercase identifier`);}
export function validateScope(profile) {
    exactKeys(profile,['format','threshold','fields','semanticSchema'],'scope');
    invariant(profile.format===SCOPE_FORMAT,'Unsupported scope format');
    invariant(Number.isFinite(profile.threshold)&&profile.threshold>=0&&profile.threshold<=1,'Threshold must be between 0 and 1');
    const s=profile.semanticSchema;
    exactKeys(s,['schema_version','name','version','grammar_hash','families','tasks','concepts','relations','parent_schema_hash','discovery_plan_hash','deferred_proposals','frozen_by','frozen_at','schema_hash'],'semantic schema');
    invariant(s.schema_version===CONTRACT.semanticSchemaVersion&&s.grammar_hash===CONTRACT.registryHash,'Clinical-evidence training grammar does not match the pinned registry');
    text(s.name,1,100,'Scope name');text(s.version,1,40,'Scope version');
    invariant(Array.isArray(s.families)&&s.families.length&&new Set(s.families).size===s.families.length&&s.families.every(f=>ALL.includes(f)),'Choose distinct clinical-evidence record families');
    invariant(Array.isArray(s.tasks)&&s.tasks.length>0&&s.tasks.length<=8,'Provide a scope definition');
    for(const task of s.tasks){exactKeys(task,['task_id','definition'],'task');slug(task.task_id,'Task ID');text(task.definition,12,1000,'Scope definition');invariant(!task.definition.includes('REPLACE_ME'),'Write an explicit scope definition');}
    invariant(new Set(s.tasks.map(t=>t.task_id)).size===s.tasks.length,'Duplicate task ID');
    invariant(Array.isArray(s.concepts)&&s.concepts.length<=48,'Scope supports up to 48 custom concepts');
    for(const concept of s.concepts){
        exactKeys(concept,['concept_id','family','description','aliases'],'concept');slug(concept.concept_id,'Concept ID');
        invariant(s.families.includes(concept.family),'A concept must belong to a selected training family');
        text(concept.description,1,1000,'Concept description');
        invariant(Array.isArray(concept.aliases)&&concept.aliases.length<=20,'Concept aliases must be a list of up to 20 phrases');
        for(const alias of concept.aliases)text(alias,1,120,'Concept alias');
    }
    invariant(new Set(s.concepts.map(c=>c.concept_id)).size===s.concepts.length,'Duplicate concept ID');
    invariant(Array.isArray(s.relations)&&s.relations.length===0,'Automatic relation suggestions are not supported by this decoder');
    invariant(Array.isArray(s.deferred_proposals)&&s.deferred_proposals.length===0,'This scope editor cannot apply grammar proposals');
    for(const key of ['parent_schema_hash','discovery_plan_hash','schema_hash'])invariant(s[key]===null||/^[a-f0-9]{64}$/.test(s[key]),'Invalid semantic schema hash');
    invariant(s.frozen_by===null||typeof s.frozen_by==='string','Invalid scope reviewer');
    invariant(s.frozen_at===null||typeof s.frozen_at==='string','Invalid scope timestamp');
    exactKeys(profile.fields,ALL,'field selection');
    invariant(ALL.every(f=>Array.isArray(profile.fields[f])),'Provide field selections for every training family');
    for(const [family,names]of Object.entries(profile.fields)){
        invariant(Array.isArray(names)&&new Set(names).size===names.length,'Choose distinct training fields');
        for(const name of names)invariant(name!==CONTRACT.families[family].anchor&&!!CONTRACT.families[family].fields[name],`Unknown training field: ${family}.${name}`);
    }
    return profile;
}
export async function importScope(input) {
    const defaults=presetScope();
    const profile=input.format===SCOPE_FORMAT?clone(input):{...defaults,semanticSchema:{...defaults.semanticSchema,...clone(input)}};
    validateScope(profile);
    const s=profile.semanticSchema;
    if(s.schema_hash){const {schema_hash,...body}=s;invariant(await fingerprint(body)===schema_hash&&s.frozen_by&&s.frozen_at,'Frozen semantic schema integrity mismatch');}
    return profile;
}
export async function freezeScope(profile,actor='legacy-annotator') {
    validateScope(profile);const result=clone(profile),s=result.semanticSchema;
    s.frozen_by=actor;s.frozen_at=new Date().toISOString();s.schema_hash=null;
    const {schema_hash,...body}=s;s.schema_hash=await fingerprint(body);
    return freeze(result);
}
export function fieldSupport(family,name,codec=null) {
    const field=CONTRACT.families[family]?.fields[name];
    if(codec===CLINICAL_V3_CODEC&&!CLINICAL_V3.axes[name])return 'V3 exposes shared axes only; separate field spans have no qualified record binding';
    if(!field)return 'Outside the training grammar';
    if(field.dtype==='list')return 'Requires a multi-span record decoder';
    if(field.kind==='choice'&&field.exportValues.length>8)return `${field.exportValues.length} trained choices exceed the eight-choice head`;
    return null;
}
const sameSet=(a,b)=>a.length===b.length&&[...a].sort().join('\0')===[...b].sort().join('\0');
/** Inference is a projection into the existing native annotation schema. */
export function compileScope(profile,nativeSchema,codec=null) {
    validateScope(profile);validateSchema(nativeSchema);
    const s=profile.semanticSchema,families={},targets=[];
    for(const family of s.families){
        const grammar=CONTRACT.families[family],native=nativeSchema.families[family];
        invariant(native&&!native.documentLevel,`Load the clinical annotation schema with ${FAMILY_TITLES[family]}`);
        invariant(native.fields.concept?.type==='text','Native span text must map to the concept field');
        const fields={concept:{type:'text'}};
        for(const name of profile.fields[family]??[]){
            const error=fieldSupport(family,name,codec);invariant(!error,`${family}.${name}: ${error}`);
            const definition=grammar.fields[name],attr=native.fields[name];
            invariant(attr,`Annotation schema is missing ${family}.${name}; use or load the generated clinical schema`);
            if(definition.kind==='choice')invariant(attr.type==='enum'&&(sameSet(attr.values,definition.values)||sameSet(attr.values,definition.exportValues)),`Annotation choices differ from training: ${family}.${name}`);
            else invariant(attr.type==='text'||attr.type==='span',`Literal field must retain source text or spans: ${name}`);
            fields[name]=clone(attr);
        }
        families[family]={label:grammar.entityType,fields,recordParent:family,recordAnchorLabel:grammar.anchor};
        const concepts=s.concepts.filter(c=>c.family===family),task=s.tasks.map(t=>t.definition).join(' ');
        if(concepts.length)for(const c of concepts)targets.push({label:c.concept_id,family,conceptId:c.concept_id,description:`${codec===CLINICAL_V3_CODEC?CLINICAL_V3.core[grammar.entityType]+' ':''}${c.description}${c.aliases.length?' Examples: '+c.aliases.join('; ')+'.':''} Scope: ${task}`});
        else targets.push({label:grammar.entityType,family,description:`${codec===CLINICAL_V3_CODEC?CLINICAL_V3.core[grammar.entityType]:DESCRIPTIONS[family]} Scope: ${task}`});
    }
    const inferenceSchema={id:nativeSchema.id,version:nativeSchema.version,families,entityTargets:targets,clinicalScope:{grammarHash:CONTRACT.registryHash,schemaHash:s.schema_hash}};
    if(codec===CLINICAL_V3_CODEC)return clinicalV3Schema(inferenceSchema);
    validateSmallSchema(inferenceSchema);
    return inferenceSchema;
}
export async function scopeIdentity(profile,inferenceSchema) {
    await importScope(profile);
    invariant(profile.semanticSchema.schema_hash,'Apply the scope before analysis');
    return {profile:clone(profile),profileHash:await fingerprint(profile),trainingRegistry:{repository:CONTRACT.repository,revision:CONTRACT.revision,hash:CONTRACT.registryHash},
        inferenceSchema:clone(inferenceSchema),inferenceSchemaHash:await fingerprint(inferenceSchema),semantics:'prompt-guidance; exact family mapping, no deterministic concept-membership guarantee'};
}
export function nativeScopeDTD(profile) {
    validateScope(profile);
    const lines=['<!ENTITY name "clinical_evidence">'];
    for(const family of profile.semanticSchema.families){
        lines.push(`<!ELEMENT ${family} (#PCDATA)>`);
        for(const name of profile.fields[family]??[]){
            const error=fieldSupport(family,name);invariant(!error,`${family}.${name}: ${error}`);
            const field=CONTRACT.families[family].fields[name];
            lines.push(field.kind==='choice'?`<!ATTLIST ${family} ${name} ( ${field.exportValues.join(' | ')} ) #IMPLIED "">`:`<!ATTLIST ${family} ${name} CDATA #IMPLIED "">`);
        }
    }
    return lines.join('\n')+'\n';
}
export function sameScope(a,b){return canonical(a)===canonical(b);}
