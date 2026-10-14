/** Fixed, declarative entity/attribute contracts. Model artifacts never supply code. */
import {planLongContext,scanLongContext} from './long-context.mjs';
import {invariant,validId,clone,OffsetMap,uuid,canonical} from './integrity.mjs';
import {buildEntitiesSchemaTokens,packInput,resolveOverlapsFlat} from './vendor/gliner25/gliner-boundary.mjs';
export const ENTITY_ATTRIBUTES_CODEC='gliner25-entity-attributes-v1';
export const ENTITY_ATTRIBUTES_NOTICE='Local entity/attribute inference with the imported complete prompt, declared overlap and token budget. Inapplicable fields stay absent; annotation defaults, literal binding and relations are not inferred. Clinical validity is unqualified.';
const string=value=>typeof value==='string'&&value.length>0&&value.length<=200;
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k))&&allowed.every(k=>Object.hasOwn(value,k));
export function validateEntityContract(c){
    const {maxWords,...required}=c??{};
    invariant(keys(required,['format','entities','attributes','threshold','maxEncodedTokens','overlapPolicy','contextPolicy'])&&c.format==='nextmedtator-entity-attributes-v1','Unsupported entity contract');
    invariant(maxWords===undefined||(Number.isInteger(maxWords)&&maxWords>0&&maxWords<=c.maxEncodedTokens),'Invalid word budget');
    invariant([512,1024].includes(c.maxEncodedTokens)&&c.contextPolicy==='reject'&&['allow','flat'].includes(c.overlapPolicy),'Unsupported token/context/overlap contract');
    invariant(Number.isFinite(c.threshold)&&c.threshold>=0&&c.threshold<=1,'Invalid entity threshold');
    invariant(Array.isArray(c.entities)&&c.entities.length>0&&c.entities.length<=64&&Array.isArray(c.attributes)&&c.attributes.length<=32,'Invalid contract inventory');
    const entities=new Set(),families=new Set(),prompts=new Set(),raw=new Set(),fields=new Set();
    for(const e of c.entities){invariant(keys(e,['family','label','description'])&&string(e.label)&&typeof e.description==='string'&&e.description.length<=10000,'Invalid entity prompt');validId(e.family);invariant(!entities.has(e.label)&&!families.has(e.family),'Duplicate entity');entities.add(e.label);prompts.add(e.label);families.add(e.family);}
    for(const g of c.attributes){invariant(keys(g,['field','labels','appliesTo','qualifyLabels','selection'])&&g.selection==='single'&&typeof g.qualifyLabels==='boolean','Only explicit single-value groups are supported');validId(g.field);invariant(!fields.has(g.field),'Duplicate attribute field');fields.add(g.field);invariant(Array.isArray(g.appliesTo)&&new Set(g.appliesTo).size===g.appliesTo.length&&g.appliesTo.every(l=>entities.has(l)),'Unknown attribute applicability');invariant(Array.isArray(g.labels)&&g.labels.length>0&&g.labels.length<=8,'Attribute graph supports 1–8 choices');const values=new Set();for(const r of g.labels){invariant(keys(r,['label','value'])&&string(r.label)&&string(r.value),'Invalid attribute choice');const prompt=g.qualifyLabels?g.field+': '+r.label:r.label;invariant(!raw.has(r.label)&&!values.has(r.value)&&!prompts.has(prompt),'Attribute labels/values collide');raw.add(r.label);values.add(r.value);prompts.add(prompt);}}
    invariant(prompts.size<=64,'Complete prompt exceeds 64 queries');return c;
}
const compareCodepoints=(a,b)=>{const x=Array.from(a,c=>c.codePointAt(0)),y=Array.from(b,c=>c.codePointAt(0));for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
export function entityContractPrompt(contract){
    const c=validateEntityContract(contract),attributeLabels=c.attributes.flatMap(g=>g.labels.map(r=>g.qualifyLabels?g.field+': '+r.label:r.label)).sort(compareCodepoints);
    const labels=[...c.entities.map(e=>e.label),...attributeLabels],at=new Map(labels.map((l,i)=>[l,i]));
    return {labels,descriptions:Object.fromEntries(c.entities.map(e=>[e.label,e.description])),groups:c.attributes.map(g=>({...g,choices:g.labels.map(r=>({...r,index:at.get(g.qualifyLabels?g.field+': '+r.label:r.label)}))}))};
}
// Python \w comprises letters, numbers and underscore. Match original text first
// and lowercase only token values, preserving Unicode/emoji and repeated offsets.
export function splitContractWords(text){return [...text.matchAll(/(?:https?:\/\/[^\s]+|www\.[^\s]+)|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|@[a-z0-9_]+|[\p{L}\p{N}_]+(?:[-_][\p{L}\p{N}_]+)*|\S/giu)].map(m=>({text:m[0].toLowerCase(),start:m.index,end:m.index+m[0].length}));}
export function packEntityContract(text,contract,tokenize){
    invariant(typeof text==='string'&&text.trim().length>0,'The note must not be empty');
    const prompt=entityContractPrompt(contract),normalized=/[.!?]$/.test(text)?text:text+'.',words=splitContractWords(normalized);
    const packed=packInput(tokenize,buildEntitiesSchemaTokens(prompt.labels,{descriptions:prompt.descriptions}),words.map(w=>w.text));
    const sourceWords=splitContractWords(text).length;
    return {...packed,prompt,normalized,words,encodedTokens:packed.inputIds.length,supported:packed.inputIds.length<=contract.maxEncodedTokens&&words.length<=contract.maxEncodedTokens&&sourceWords<=(contract.maxWords??contract.maxEncodedTokens)};
}
export function entityContractSchema(schema,contract){
    const c=validateEntityContract(contract),result=clone(schema),families={};
    for(const [family,definition]of Object.entries(schema.families)){const entity=c.entities.find(e=>e.label===(definition.label??family)||e.family===family);if(!entity)continue;invariant(!definition.documentLevel,'Entity contract cannot infer document-level labels');const fields={};if(definition.fields.concept?.type==='text')fields.concept={type:'text'};for(const group of c.attributes){const spec=definition.fields[group.field];if(!spec||!group.appliesTo.includes(entity.label))continue;const values=group.labels.map(r=>r.value);invariant(spec.type==='enum'&&values.every(v=>spec.values.includes(v)),'Loaded schema does not retain the complete native attribute vocabulary: '+group.field);fields[group.field]={type:'enum',values};}families[family]={label:entity.label,fields};}
    invariant(Object.keys(families).length>0,'No loaded schema family matches this entity contract');result.families=families;result.relations={};return result;
}
export function schemaFromEntityContract(contract){return {id:'entity-contract',version:'1',families:Object.fromEntries(contract.entities.map(e=>[e.family,{label:e.label,fields:Object.fromEntries(contract.attributes.filter(g=>g.appliesTo.includes(e.label)).map(g=>[g.field,{type:'enum',values:g.labels.map(r=>r.value)}]))}])),relations:{}};}
const sigmoid=x=>Math.fround(1/(1+Math.exp(-Math.fround(x))));
export function decodeContractEntities(marg,contract,text){
    const rows=[],c=marg.candidateCount,temperature=marg.pairTemperature??1;
    invariant(Number.isInteger(c)&&c>0&&marg.nullLogits?.length>=contract.entities.length,'Native candidate/abstention outputs required');
    for(const [q,entity]of contract.entities.entries()){
        if(sigmoid(marg.nullLogits[q])>marg.abstentionThreshold)continue;
        const distinct=new Map();
        for(let i=0;i<c;i++){const at=q*c+i,start=Number(marg.pairIndices[at*2]),end=Number(marg.pairIndices[at*2+1]);if(!marg.pairValid[at]||!Number.isInteger(start)||!Number.isInteger(end)||start<0||start>=end||end>marg.words.length)continue;const score=sigmoid(marg.pairLogits[at]/temperature);if(score<contract.threshold)continue;const key=start+':'+end,old=distinct.get(key);if(!old||score>old.score)distinct.set(key,{label:entity.label,family:entity.family,wordStart:start,wordEnd:end,start:marg.words[start].start,end:marg.words[end-1].end,score});}
        let selected=[...distinct.values()];if(contract.overlapPolicy==='flat')selected=resolveOverlapsFlat(selected);
        selected.sort((a,b)=>b.score-a.score||a.start-b.start||a.end-b.end);rows.push(...selected.filter(e=>e.end<=text.length&&text.slice(e.start,e.end).trim()));
    }
    return rows;
}
export function selectContractAttribute(logits,choices,temperature=1){
    invariant(logits.length===choices.length&&logits.every(Number.isFinite),'Invalid attribute scores');const values=logits.map(v=>Math.fround(v/temperature));let best=0;for(let i=1;i<values.length;i++)if(values[i]>values[best])best=i;const maximum=values[best],exponents=values.map(v=>Math.exp(v-maximum)),sum=exponents.reduce((a,b)=>a+b,0);return {value:choices[best].value,score:Math.fround(exponents[best]/sum)};
}
export async function analyzeEntityContract(api,text,schema,contract,variant,{longContext=false,onProgress}={}){
    if(!longContext)return analyzeEntityWindow(api,text,schema,contract,variant);
    let windows;
    try{windows=planLongContext(text,{split:splitContractWords,pack:part=>packEntityContract(part,contract,t=>api.rt._tokenize(t)),maxWords:contract.maxWords??contract.maxEncodedTokens});}
    catch(error){return {records:[],status:'unsupported',coverage:[],windows:[],reason:error.message};}
    if(windows.length===1)return analyzeEntityWindow(api,text,schema,contract,variant);
    return scanLongContext(text,windows,part=>analyzeEntityWindow(api,part,schema,contract,variant),{overlapPolicy:contract.overlapPolicy,onProgress});
}
async function analyzeEntityWindow(api,text,schema,contract,variant){
    const plan=packEntityContract(text,contract,t=>api.rt._tokenize(t)),base={threshold:contract.threshold,encodedTokens:plan.encodedTokens,contextPolicy:'reject',overlapPolicy:contract.overlapPolicy,windows:[],notice:ENTITY_ATTRIBUTES_NOTICE,limitations:['annotation-defaults-not-inferred','record-binding-unsupported','relations-unsupported']};
    if(!plan.supported)return {...base,records:[],status:'unsupported',coverage:[],reason:'Encoded input including the complete schema exceeds the declared budget; no truncation or windowing applied'};
    const projection=entityContractSchema(schema,contract),byLabel=new Map(Object.entries(projection.families).map(([family,def])=>[def.label,family]));
    // Preflight counted every word; computeMarginals cannot silently crop anything.
    const marg=await api.rt.computeMarginals(text,plan.prompt.labels,{maxWords:contract.maxEncodedTokens,descriptions:plan.prompt.descriptions,preparedInput:plan});
    marg.words=plan.words;marg.normalized=plan.normalized;marg.abstentionThreshold=variant.abstentionThreshold;
    const entities=decodeContractEntities(marg,contract,text);for(const e of entities){e.fields={};e.attributeScores={};}
    const width=marg.queryStates.dims[2],length=contract.maxEncodedTokens;
    for(const group of plan.prompt.groups){const selected=entities.filter(e=>group.appliesTo.includes(e.label));if(!selected.length)continue;const q=new Float32Array(8*width),qmask=new Float32Array(8);group.choices.forEach((choice,i)=>{q.set(marg.queryStates.data.subarray(choice.index*width,(choice.index+1)*width),i*width);qmask[i]=1;});for(let offset=0;offset<selected.length;offset+=16){const batch=selected.slice(offset,offset+16),indices=new BigInt64Array(8*16*2);for(let row=0;row<8;row++)for(let col=0;col<16;col++){const e=batch[Math.min(col,batch.length-1)],at=(row*16+col)*2;indices[at]=BigInt(e.wordStart);indices[at+1]=BigInt(e.wordEnd);}const output=await api.rt.attrsSession.run({text_states:marg.textStates,text_word_mask:new api.rt.ort.Tensor('float32',marg.textWordMask,[1,length]),query_states:new api.rt.ort.Tensor('float32',q,[1,8,width]),query_marker_mask:new api.rt.ort.Tensor('float32',qmask,[1,8]),span_indices:new api.rt.ort.Tensor('int64',indices,[1,8,16,2])});invariant(canonical(output.attr_logits.dims)===canonical([1,8,16]),'Attribute graph shape mismatch');for(const [col,e]of batch.entries()){const chosen=selectContractAttribute(group.choices.map((_,row)=>Number(output.attr_logits.data[row*16+col])),group.choices,variant.pairTemperature);e.fields[group.field]=chosen.value;e.attributeScores[group.field]=chosen.score;}}}
    const source=new OffsetMap(text),records=[];
    for(const e of entities){const family=byLabel.get(e.label);if(!family)continue;const fields={},definition=projection.families[family];if(definition.fields.concept)fields.concept=text.slice(e.start,e.end);for(const [key,value]of Object.entries(e.fields))if(definition.fields[key])fields[key]=value;records.push({id:uuid(),documentId:'pending',family,anchor:[source.selection(e.start,e.end)],fields,evidence:[],score:e.score,attributeScores:e.attributeScores,origin:{kind:'model',codec:ENTITY_ATTRIBUTES_CODEC}});}
    return {...base,records,status:'complete',coverage:[[0,source.length]],windows:[{sourceRange:[0,source.length],encodedTokens:plan.encodedTokens}]};
}
export function compareEntityContractRecords(expected,actual,{tolerance=1e-4}={}){
    const key=r=>canonical([r.family,r.anchor]),index=rows=>new Map(rows.map(r=>[key(r),r])),left=index(expected),right=index(actual);let maxScoreError=0;
    if(left.size!==expected.length||right.size!==actual.length||canonical([...left.keys()].sort())!==canonical([...right.keys()].sort()))return {pass:false,reason:'entity-spans-differ'};
    for(const [id,row]of left){const got=right.get(id);if(canonical(row.fields)!==canonical(got.fields)||canonical(Object.keys(row.attributeScores??{}).sort())!==canonical(Object.keys(got.attributeScores??{}).sort()))return {pass:false,reason:'attribute-values-or-presence-differ'};maxScoreError=Math.max(maxScoreError,Math.abs(row.score-got.score),...Object.entries(row.attributeScores??{}).map(([field,value])=>Math.abs(value-got.attributeScores[field])));}
    return {pass:Number.isFinite(maxScoreError)&&maxScoreError<=tolerance,spans:expected.length,maxScoreError};
}
