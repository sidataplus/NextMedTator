import {Gliner25} from './vendor/gliner25/api.mjs';
import {decodeEntitiesV2,buildEntitiesSchemaTokens,buildRelationSchemaTokens} from './vendor/gliner25/gliner-boundary.mjs';
import {decodeAssignedRecords} from './vendor/gliner25/joint-ie.mjs';
import {schemaPrompt, GlinerTokenizer, splitWords, planWindows, documentCoverage} from './gliner.mjs';
import {OffsetMap, invariant, uuid, canonical} from './integrity.mjs';
export const SMALL_CODEC='gliner25-small-records-v5';
export const SMALL_NOTICE='Pinned GLiNER2.5-small ONNX v5: local anchors, enum attributes, anchored record fields. Automatic relations are withheld pending source-score qualification. Unqualified clinical accuracy; cross-window relations and anchorless records are unsupported.';
export function smallRuntime(ort,sessions,tokenizer,variant){return new Gliner25({ort,session:sessions.model,headsSession:sessions.relations,attrsSession:sessions.attributes,recordsSession:sessions.records,tokenize:t=>tokenizer.encodeIds(t),pairTemperature:variant.pairTemperature??1});}
export function validateSmallSchema(schema){
    schemaPrompt(schema);
    for(const family of Object.values(schema.families)){
        invariant(!family.documentLevel,'This package cannot infer anchorless/document labels');
        for(const [name,f] of Object.entries(family.fields))invariant(['enum','text','span'].includes(f.type),'Unsupported inference field type: '+name);
        for(const f of Object.values(family.fields))if(f.type==='enum')invariant(f.values.length<=8,'Enum exceeds the eight-query attribute head');
    }
    invariant(Object.keys(schema.relations??{}).length<=8,'Relation type budget exceeded');
}
export async function analyzeSmall(api,text,schema,{threshold=.5,onProgress,automaticRelations=false}={}){
    validateSmallSchema(schema);const prompt=schemaPrompt(schema), words=splitWords(text),tokenizer=api.rt.tokenizer??{encodeIds:t=>api.rt._tokenize(t)};
    const cost=tokens=>[...tokens,'[SEP_TEXT]'].reduce((n,t)=>n+tokenizer.encodeIds(t).length,0)+tokenizer.encodeIds('.').length;
    let prefixTokens=cost(buildEntitiesSchemaTokens(prompt.labels));
    for(const [family,def] of Object.entries(schema.families)){const fields=Object.entries(def.fields).filter(([name,spec])=>name!=='concept'&&spec.type!=='enum').map(([name])=>name);if(fields.length)prefixTokens=Math.max(prefixTokens,cost(buildEntitiesSchemaTokens([def.recordAnchorLabel??def.label??family,...fields],{parent:def.recordParent??def.label??family})));}
    if(automaticRelations){const tokens=Object.keys(schema.relations??{}).flatMap((type,i)=>[...(i?['[SEP_STRUCT]']:[]),...buildRelationSchemaTokens(type)]);prefixTokens=Math.max(prefixTokens,cost(tokens));}
    const plan=planWindows(tokenizer,prompt.labels,words,{prefixTokens});
    const source=new OffsetMap(text), all=[], relations=[], windows=[];
    for(const [windowIndex,[from,to]] of plan.windows.entries()){
        const start=source.toUTF16(words[from].start),end=source.toUTF16(words[to-1].end),chunk=text.slice(start,end);
        const marg=await api.rt.computeMarginals(chunk,prompt.labels,{maxWords:512});
        const entities=decodeEntitiesV2({pairIndices:marg.pairIndices,pairLogits:marg.pairLogits,pairValid:marg.pairValid,candidateCount:marg.candidateCount,labels:prompt.labels.slice(0,prompt.contentCount),wordOffsets:marg.words,text:marg.normalized,threshold,pairTemperature:marg.pairTemperature});
        for(const e of entities){e.fields={};}
        const width=marg.queryStates.dims[2];
        for(const group of prompt.groups){
            const q=new Float32Array(group.choices.length*width);
            group.choices.forEach((choice,i)=>q.set(marg.queryStates.data.subarray((prompt.contentCount+choice.index)*width,(prompt.contentCount+choice.index+1)*width),i*width));
            const attrMarg={...marg,queryStates:{data:q,dims:[1,group.choices.length,width]}};
            const scored=await api.rt.scoreExplicitAttributes(chunk,entities,group.choices.map(c=>c.value),{marg:attrMarg});
            for(const e of scored)e.fields[group.field]=e.attribute;
        }
        const byLabel=new Map(Object.entries(schema.families).map(([id,def])=>[def.label||id,id]));
        for(const e of entities){
            if(e.end>chunk.length)continue;
            const family=byLabel.get(e.label),def=schema.families[family],fields={};
            for(const name of Object.keys(def.fields))fields[name]=name==='concept'?e.text:e.fields[name]??null;
            const anchor=[source.selection(start+e.start,start+e.end)];
            all.push({id:uuid(),documentId:'pending',family,anchor,fields,evidence:[],score:e.score,origin:{kind:'model',codec:SMALL_CODEC}});
        }
        // The record head binds text/span fields to retained anchors, never by nearest-text guessing.
        for(const [family,def] of Object.entries(schema.families)){
            const fieldNames=Object.entries(def.fields).filter(([name,spec])=>name!=='concept'&&spec.type!=='enum').map(([name])=>name);
            if(!fieldNames.length || !entities.some(e=>byLabel.get(e.label)===family))continue;
            const labels=[def.recordAnchorLabel??def.label??family,...fieldNames], parsed=labels.map((name,i)=>({name,dtype:'str',anchor:i===0}));
            const recordMarg=await api.rt.computeMarginals(chunk,labels,{parent:def.recordParent??def.label??family,maxWords:512});
            const scored=await api.rt.scoreRecords(recordMarg,parsed,{threshold});if(!scored)continue;
            const rows=decodeAssignedRecords({parent:family,parsed,instSlots:scored.instSlots,assign:scored.assign,marg:recordMarg,anchor:0,toItem:e=>e})[family]??[];
            for(const row of rows){const anchor=row[labels[0]];if(!anchor)continue;
                const record=all.find(r=>r.family===family&&r.anchor[0].start===source.toCodePoint(start+anchor.start)&&r.anchor[0].end===source.toCodePoint(start+anchor.end));
                if(!record)continue;
                for(const name of fieldNames){const hit=row[name];if(!hit||hit.end>chunk.length)continue;const span=source.selection(start+hit.start,start+hit.end);record.fields[name]=def.fields[name].type==='span'?[span]:span.text;record.evidence.push(span);}
            }
        }
        if(automaticRelations&&Object.keys(schema.relations??{}).length){
            const types=Object.fromEntries(Object.entries(schema.relations).map(([type,def])=>[type,{head:def.head.map(id=>schema.families[id].label||id),tail:def.tail.map(id=>schema.families[id].label||id)}]));
            const output=await api.extract_relations(chunk,types,{threshold,labels:prompt.labels.slice(0,prompt.contentCount)});
            relations.push(...output.relations.map(r=>({...r,windowStart:start})));
        }
        windows.push({from,to,sourceRange:[words[from].start,words[to-1].end]});onProgress?.({completed:windowIndex+1,total:plan.windows.length});
    }
    const records=[],seen=new Set();for(const r of all.sort((a,b)=>b.score-a.score)){const key=canonical({family:r.family,anchor:r.anchor,fields:r.fields});if(!seen.has(key)){seen.add(key);records.push(r);}}
    for(const relation of relations){const locate=(mention,role)=>records.find(r=>schema.relations[relation.type][role].includes(r.family)&&r.anchor[0].start===source.toCodePoint(relation.windowStart+mention.start)&&r.anchor[0].end===source.toCodePoint(relation.windowStart+mention.end));const head=locate(relation.head,'head'),tail=locate(relation.tail,'tail');if(head&&tail){head.relations??=[];if(!head.relations.some(r=>r.type===relation.type&&r.targetId===tail.id))head.relations.push({type:relation.type,targetId:tail.id});}}
    return {records,...documentCoverage(text,words,plan.uncovered),windows,limitations:['cross-window-relations','anchorless-records',...(!automaticRelations&&Object.keys(schema.relations??{}).length?['automatic-relations-unqualified']:[])],threshold,notice:SMALL_NOTICE};
}
