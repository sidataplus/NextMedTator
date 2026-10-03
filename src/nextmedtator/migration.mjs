import {clone,fingerprint,uuid,invariant} from './integrity.mjs';
import {validateSchema,validateRecords} from './contracts.mjs';
import {ReviewProject} from './project.mjs';
/** Explicit revision proposal. The caller displays losses before applying; input is never mutated. */
export async function previewSchemaMigration(project,schema,mapping={}){
 const p=project.current??project;validateSchema(schema);const losses=[],records=[];
 for(const original of p.draft.records){const family=mapping.families?.[original.family]??original.family,def=schema.families[family];if(!def){losses.push({recordId:original.id,reason:'Family has no destination',family:original.family});continue;}
 const r={...clone(original),family,fields:{},origin:{...clone(original.origin),migrationSourceSchema:p.schemaHash}};
 if(Boolean(def.documentLevel)!==Boolean(p.schema.families[original.family].documentLevel)){losses.push({recordId:r.id,reason:'Anchor/document-level semantics changed; record excluded'});continue;}
 for(const [name,value] of Object.entries(original.fields)){const target=mapping.fields?.[original.family]?.[name]??name;if(!def.fields[target]){losses.push({recordId:r.id,field:name,reason:'Field has no destination'});continue;}r.fields[target]=clone(value);}
 try{validateRecords([{...r,relations:[]}],p.documents,schema);records.push(r);}catch(error){losses.push({recordId:r.id,reason:error.message});}
 }
 const ids=new Set(records.map(r=>r.id));for(const r of records)r.relations=(r.relations??[]).filter(rel=>{const valid=ids.has(rel.targetId)&&(!schema.relations||schema.relations[rel.type]);if(!valid)losses.push({recordId:r.id,relation:rel.type,reason:'Relation destination or type excluded'});return valid;});
 validateRecords(records,p.documents,schema);
 const report={id:uuid(),fromSchemaHash:p.schemaHash,fromDraftHash:await fingerprint(p.draft),toSchemaHash:await fingerprint(schema),mapping:clone(mapping),retainedRecords:records.length,inputRecords:p.draft.records.length,losses};return {schema:clone(schema),records,report};
}
export async function applySchemaMigration(project,proposal){const p=project.current??project;invariant(p.schemaHash===proposal.report.fromSchemaHash&&await fingerprint(p.draft)===proposal.report.fromDraftHash,'Project changed; regenerate the migration preview');invariant(await fingerprint(proposal.schema)===proposal.report.toSchemaHash,'Migration schema changed');const next=await ReviewProject.create(p.documents,proposal.schema,{mode:p.mode,actor:p.actor}),data=clone(next.current);data.draft.records=clone(proposal.records);data.exposure=clone(p.exposure);data.extensions.schemaMigration={report:clone(proposal.report),priorProject:clone(p)};return ReviewProject.open(data);}
