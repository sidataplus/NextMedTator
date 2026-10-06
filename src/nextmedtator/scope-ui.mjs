import {CLINICAL_CONTRACT, SCOPE_PRESETS, FAMILY_TITLES, presetScope, fieldSupport, nativeScopeDTD} from './scope.mjs';
import {localDownload} from './bundle.mjs';
import {jsonParse} from './integrity.mjs';

function node(tag,text,attrs={}){const n=document.createElement(tag);if(text!=null)n.textContent=String(text);for(const[k,v]of Object.entries(attrs))if(v!=null&&v!==false)n.setAttribute(k,String(v));return n;}
function label(text,input){const n=node('label');n.append(node('span',text),input);return n;}
function button(text,handler,id,disabled=false){const n=node('button',text,{type:'button','data-testid':id,disabled});n.onclick=handler;return n;}
function input(text,value,update,{id,area=false,type='text',...attrs}={}){
    const n=node(area?'textarea':'input',null,{'aria-label':text,...(!area?{type}:{}),...(id?{'data-testid':id}:{}),...attrs});n.value=value;
    n.oninput=()=>update(n.value);return label(text,n);
}
export function renderScopeEditor(assist){
    const section=node('section',null,{'aria-label':'Clinical suggestion scope',class:'scope'}),row=node('div',null,{class:'row'});
    row.append(node('strong','Suggestion scope'),button(assist.scopeEditing?'Close editor':'Build / edit scope',()=>{assist.scopeEditing=!assist.scopeEditing;assist.render();},'scope-edit',assist.busy));
    section.append(row,node('p',assist.scope?`${assist.scope.semanticSchema.name} · ${assist.scope.semanticSchema.families.length} families · ${assist.scope.semanticSchema.concepts.length} custom concepts`:'Using the loaded annotation schema. Build a clinical scope to customize targets within the training grammar.',{class:'muted','data-testid':'scope-active'}));
    if(!assist.scopeEditing)return section;
    const draft=assist.scopeDraft,s=draft.semanticSchema,codec=assist.model?.manifest.variants[0]?.codec;
    section.append(node('p','Start broadly, then choose families and add your own concepts. Families, field names and choice vocabularies come from clinical-evidence/0.1.',{class:'muted'}));
    section.append(node('p','Load or generate a compatible annotation schema, define your scope, then Apply scope and analyze. Custom targets can reduce recall; compare a broad run when checking for omissions.',{class:'muted'}));
    const presets=node('select',null,{'aria-label':'Broad starting preset','data-testid':'scope-preset',disabled:assist.busy});
    presets.append(node('option','Choose a broad starting preset',{value:''}));for(const p of SCOPE_PRESETS)presets.append(node('option',p.name,{value:p.id}));
    presets.onchange=()=>{if(!presets.value)return;assist.scopeDraft=presetScope(presets.value,codec);assist.render();};section.append(label('Broad starting preset',presets));
    section.append(input('Scope name',s.name,v=>s.name=v,{id:'scope-name',maxlength:100}),input('Scope version',s.version,v=>s.version=v,{id:'scope-version',maxlength:40}));
    for(const [index,task]of s.tasks.entries())section.append(input(index?'Additional scope definition':'Scope definition',task.definition,v=>task.definition=v,{id:index?'scope-additional-definition':'scope-definition',area:true,rows:3,maxlength:1000}));
    section.append(node('p','Descriptions can state included concepts and exclusions. They guide the model; relevance still needs review.',{class:'muted'}));
    section.append(input('Suggestion threshold',draft.threshold,v=>draft.threshold=Number(v),{id:'scope-threshold',type:'number',min:0,max:1,step:.05}));
    const families=node('fieldset');families.append(node('legend','Training record families'));
    for(const [family,title]of Object.entries(FAMILY_TITLES)){
        const check=node('input',null,{type:'checkbox','aria-label':title,'data-testid':'scope-family-'+family});check.checked=s.families.includes(family);
        check.onchange=()=>{s.families=check.checked?[...s.families,family]:s.families.filter(f=>f!==family);assist.render();};
        const row=node('label',null,{class:'check'});row.append(check,node('span',title));families.append(row);
    }section.append(families);
    const concepts=node('div');concepts.append(node('h3','Your concepts'),node('p','Each concept uses an existing family. A family with concepts searches those concepts; a family without concepts uses its broad clinical category.',{class:'muted'}));
    for(const [index,concept]of s.concepts.entries()){
        const card=node('div',null,{class:'card','data-testid':'scope-concept'});
        card.append(input('Concept identifier',concept.concept_id,v=>concept.concept_id=v,{id:'scope-concept-id',maxlength:96}));
        const family=node('select',null,{'aria-label':'Concept record family','data-testid':'scope-concept-family'});
        for(const f of s.families)family.append(node('option',FAMILY_TITLES[f],{value:f}));family.value=concept.family;
        family.onchange=()=>concept.family=family.value;card.append(label('Record family',family));
        card.append(input('Concept description',concept.description,v=>concept.description=v,{id:'scope-concept-description',area:true,rows:3,maxlength:1000}),
            input('Aliases / examples (one per line)',concept.aliases.join('\n'),v=>concept.aliases=v.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),{id:'scope-concept-aliases',area:true,rows:2}),
            button('Remove concept',()=>{s.concepts.splice(index,1);assist.render();},'scope-remove-concept'));
        concepts.append(card);
    }
    concepts.append(button('Add concept',()=>{let n=1;while(s.concepts.some(c=>c.concept_id===`concept_${n}`))n++;s.concepts.push({concept_id:`concept_${n}`,family:s.families[0]??'condition_occurrence',description:'',aliases:[]});assist.render();},'scope-add-concept',s.concepts.length>=48));section.append(concepts);
    const fields=node('details');fields.append(node('summary','Training fields and decoder support'));
    for(const family of s.families){
        const box=node('fieldset');box.append(node('legend',FAMILY_TITLES[family]),node('p',`Anchor: ${CLINICAL_CONTRACT.families[family].anchor} (always retained as the exact native span).`,{class:'muted'}));
        for(const [name,definition]of Object.entries(CLINICAL_CONTRACT.families[family].fields)){
            if(name===CLINICAL_CONTRACT.families[family].anchor)continue;
            const error=fieldSupport(family,name,codec),check=node('input',null,{type:'checkbox','aria-label':`${family}.${name}`,'data-testid':`scope-field-${family}-${name}`,disabled:!!error&&!draft.fields[family].includes(name)});check.checked=draft.fields[family].includes(name);
            check.onchange=()=>{const names=draft.fields[family];draft.fields[family]=check.checked?[...names,name]:names.filter(n=>n!==name);if(error)assist.render();};
            const row=node('label',null,{class:'check'});row.append(check,node('span',name));box.append(row);
            if(error)box.append(node('p',error,{class:'muted'}));
            else if(definition.kind==='choice')box.append(node('p',definition.exportValues.join(' · '),{class:'muted'}));
        }fields.append(box);
    }section.append(fields);
    const actions=node('div',null,{class:'row'});
    actions.append(button('Apply scope',()=>assist.perform(()=>assist.applyScope()),'scope-apply',assist.busy),
        button('Use loaded schema',()=>assist.disableScope(),'scope-disable',assist.busy));section.append(actions);
    section.append(node('p','Applying a scope affects the next analysis. Existing predictions retain their original scope.',{class:'muted'}));
    const schemaActions=node('div',null,{class:'row'});
    schemaActions.append(button('Use clinical annotation schema',()=>assist.perform(()=>assist.useScopeSchema()),'scope-use-schema',assist.busy),
        button('Download annotation schema',()=>assist.perform(()=>localDownload(new TextEncoder().encode(nativeScopeDTD(draft)),'clinical-evidence.dtd','text/plain')),'scope-download-dtd',assist.busy));section.append(schemaActions);
    section.append(node('p','Use the generated schema on unannotated notes. For an existing annotation task, download it and use the usual schema controls or a reviewed migration.',{class:'muted'}));
    const share=node('div',null,{class:'row'});
    share.append(button('Export scope',()=>assist.perform(()=>assist.exportScope(false)),'scope-export',!assist.scope||assist.busy),
        button('Export training semantic schema',()=>assist.perform(()=>assist.exportScope(true)),'scope-export-semantic',!assist.scope||assist.busy));section.append(share);
    const upload=node('input',null,{type:'file',accept:'.json','aria-label':'Import scope or training semantic schema','data-testid':'scope-import'});
    upload.onchange=()=>{const file=upload.files?.[0];if(file)assist.perform(async()=>assist.importScope(jsonParse(await file.text())));};section.append(label('Import scope or training semantic schema',upload));
    section.append(node('a','Pinned training grammar',{href:`https://github.com/${CLINICAL_CONTRACT.repository}/blob/${CLINICAL_CONTRACT.revision}/docs/GRAMMAR.md`,target:'_blank',rel:'noopener noreferrer'}));
    return section;
}
