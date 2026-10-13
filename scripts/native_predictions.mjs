import {invariant, OffsetMap, sourceDocument, clone, uniqueIds} from '../src/nextmedtator/integrity.mjs';
import {ReviewProject, makeRun} from '../src/nextmedtator/project.mjs';

export const NATIVE_NOTICE='Imported local native inference; unreviewed research predictions. No browser inference or clinical validation claim.';

/** Convert a local GLiNER entity/attribute receipt into the existing review format. */
export async function nativePredictionProject(receipt) {
    invariant(receipt?.format==='nextmedtator-native-predictions-v1','Unsupported native prediction receipt');
    invariant(receipt.model?.repository && /^[a-f0-9]{40}$/.test(receipt.model.revision),'Pinned model identity required');
    invariant(receipt.settings?.clinicalValidation===false,'Clinical validity must remain unqualified');
    invariant(Array.isArray(receipt.notes)&&receipt.notes.length>0&&receipt.notes.length<=10000,'Invalid note inventory');
    const spec=receipt.schema;
    invariant(Array.isArray(spec?.entities)&&spec.entities.length>0&&Array.isArray(spec.attributes),'Explicit source schema required');
    uniqueIds(spec.entities);
    const families={}, byLabel=new Map();
    for(const entity of spec.entities){
        invariant(!byLabel.has(entity.label),'Duplicate entity label');
        const fields={};
        for(const axis of spec.attributes)if(axis.appliesTo.includes(entity.id))fields[axis.label]={type:'enum',values:axis.values.map(v=>v.label)};
        families[entity.id]={label:entity.label,fields};byLabel.set(entity.label,{entity,fields});
    }
    const schema={id:spec.id,version:'1',description:NATIVE_NOTICE,families};
    const docs=await Promise.all(receipt.notes.map(n=>sourceDocument(n.id,new TextEncoder().encode(n.text),{split:'unassigned',provenance:{kind:'native-local-inference',filename:n.id+'.txt',notice:NATIVE_NOTICE}})));
    const project=await ReviewProject.create(docs,schema,{actor:'local-reviewer'});
    for(const [i,note] of receipt.notes.entries()){
        invariant(['complete','unsupported','failed'].includes(note.status),'Invalid native run status');
        const doc=docs[i],map=new OffsetMap(doc.text),records=[];
        if(note.status==='complete'){
            invariant(note.encodedTokens<=receipt.settings.maxEncodedTokens,'Oversized input cannot be complete');
            invariant(note.result?.entities&&typeof note.result.entities==='object','Missing actual native output');
            for(const [label,rows]of Object.entries(note.result.entities)){
                invariant(byLabel.has(label)&&Array.isArray(rows),'Output entity outside source schema');
                for(const row of rows){
                    invariant(Number.isInteger(row.start)&&Number.isInteger(row.end)&&row.start<row.end,'Invalid native span');
                    const anchor=map.span(row.start,row.end);invariant(anchor.text===row.text,'Native span text mismatch');
                    invariant(Number.isFinite(row.confidence)&&row.confidence>=0&&row.confidence<=1,'Invalid native score');
                    const fields={},attributeScores={};
                    for(const [name,definition]of Object.entries(byLabel.get(label).fields)){
                        const value=row[name];if(value==null)continue;
                        invariant(typeof value.label==='string'&&value.label.startsWith(name+': '),'Unqualified attribute label');
                        const decoded=value.label.slice(name.length+2);invariant(definition.values.includes(decoded),'Attribute outside source vocabulary');
                        invariant(Number.isFinite(value.confidence)&&value.confidence>=0&&value.confidence<=1,'Invalid attribute confidence');
                        fields[name]=decoded;attributeScores[name]=value.confidence;
                    }
                    for(const name of Object.keys(row))invariant(['text','start','end','confidence',...Object.keys(byLabel.get(label).fields)].includes(name),'Unexpected or inapplicable native attribute');
                    records.push({id:'native-'+i+'-'+records.length,documentId:doc.id,family:byLabel.get(label).entity.id,anchor:[anchor],fields,score:row.confidence,origin:{kind:'model',source:'native-local-inference',reviewStatus:'unreviewed',attributeScores}});
                }
            }
        }
        const run=await makeRun(project,doc,records,{producer:{kind:'model',name:receipt.model.repository,revision:receipt.model.revision,notice:NATIVE_NOTICE,lineage:clone(receipt.model)},runtime:{backend:'native-cpu',precision:'fp32',version:receipt.model.runtimeCommit,...clone(receipt.runtime)},settings:{...clone(receipt.settings),inferenceLocation:'local-native',importedPredictions:true},status:note.status,coverage:note.status==='complete'?[[0,map.length]]:[],timing:{inferenceMs:note.inferenceMs??0},failures:note.status==='complete'?[]:[{category:note.status}]});
        await project.addRun(run);
    }
    return project;
}
