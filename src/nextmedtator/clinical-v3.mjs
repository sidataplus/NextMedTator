import {clone,invariant,canonical} from './integrity.mjs';
export const CLINICAL_V3_CODEC='gliner25-clinical-v3-spans-v1';
// Pinned v3 registry prompts, not executable model-supplied code.
export const CLINICAL_V3={"registryHash":"80f255076cde0237c3f176b45545807bb237cbc57af1d983c6550a6d6816f547","core":{"clinical_condition":"A diagnosis, disorder, symptom, or clinical state; preserve context without deciding a phenotype.","clinical_measure":"A named clinical measurement and its locally bound raw result.","clinical_treatment":"Medication or intervention mention, distinguished from exposure, allergy, indication, and candidacy.","clinical_event":"Unified clinical actions, episodes, behavioral patterns, psychological experiences, and persistent states. Not restricted to acute events.","functional_activity":"Specific ADL, IADL, mobility, transfer, or communication ability; not a frailty label.","care_context":"Care setting, services, goals, and support without inferring prognosis or terminal illness."},"axes":{"assertion":{"group":"assertion","default":"affirmed","labels":[{"value":"affirmed","span_label":"assertion: affirmed"},{"value":"negated","span_label":"assertion: negated"},{"value":"uncertain","span_label":"assertion: uncertain"},{"value":"hypothetical","span_label":"assertion: hypothetical"},{"value":"ruled_out","span_label":"assertion: ruled out"}]},"experiencer":{"group":"experiencer","default":"patient","labels":[{"value":"patient","span_label":"experiencer: patient"},{"value":"family","span_label":"experiencer: family"},{"value":"other","span_label":"experiencer: other"}]},"time_frame":{"group":"time frame","default":"current","labels":[{"value":"current","span_label":"time frame: current"},{"value":"recent","span_label":"time frame: recent"},{"value":"historical","span_label":"time frame: historical"},{"value":"future","span_label":"time frame: future"}]}},"families":{"condition_occurrence":"clinical_condition","measurement_occurrence":"clinical_measure","treatment_occurrence":"clinical_treatment","event_occurrence":"clinical_event","function_occurrence":"functional_activity","care_context_occurrence":"care_context"}};
export const CLINICAL_V3_NOTICE='ClinicalEvidence v3: exact anchors and explicit assertion, experiencer and time frame on this device. Shared axes use one-value softmax with no attribute threshold. Family-specific choice/literal spans, record binding and relations are not supported by this decoder. Clinical accuracy is unqualified.';
export function clinicalV3Schema(schema){
    const result=clone(schema);result.clinicalV3=true;
    for(const [family,def]of Object.entries(result.families)){
        if(CLINICAL_V3.families[family])def.label=CLINICAL_V3.families[family];
        invariant(!def.documentLevel,'This package cannot infer anchorless/document labels');
        const fields={};
        for(const [name,spec]of Object.entries(def.fields)){
            if(name==='concept'){fields[name]=clone(spec);continue;}
            const axis=CLINICAL_V3.axes[name];if(!axis)continue;
            invariant(spec.type==='enum','V3 shared axes must be enum fields: '+name);
            const values=axis.labels.map(row=>row.value);
            invariant(values.every(value=>spec.values.includes(value)),'V3 requires the full trained shared-axis vocabulary: '+name);
            invariant(spec.values.every(value=>values.includes(value)||['unspecified','not_applicable'].includes(value)),'Unknown V3 axis value: '+name);
            fields[name]={...clone(spec),values};
        }
        def.fields=fields;
    }
    result.relations={};return result;
}
export function clinicalV3Prompt(schema,{labels,byLabel},{complete=false}={}){
    if(complete){
        invariant(labels.every(label=>Object.hasOwn(CLINICAL_V3.core,label)),'This clinical release requires canonical family labels; custom concept queries need another package');
        const core=Object.keys(CLINICAL_V3.core),ordered=Object.values(CLINICAL_V3.axes).flatMap(axis=>axis.labels.map(row=>row.span_label)).sort();
        const at=new Map(ordered.map((label,index)=>[label,index]));
        return {labels:[...core,...ordered],byLabel,contentCount:core.length,descriptions:{...CLINICAL_V3.core},
            groups:Object.entries(CLINICAL_V3.axes).map(([field,axis])=>({field,families:Object.keys(schema.families),choices:[...axis.labels].sort((a,b)=>a.span_label.localeCompare(b.span_label)).map(row=>({value:row.value,index:at.get(row.span_label)}))}))};
    }
    const groups=new Map(),rows=new Map(),descriptions={};
    for(const label of labels)if(CLINICAL_V3.core[label])descriptions[label]=CLINICAL_V3.core[label];
    for(const target of schema.entityTargets??[])descriptions[target.label]=target.description;
    for(const [family,def]of Object.entries(schema.families))for(const [field,spec]of Object.entries(def.fields)){
        if(spec.type!=='enum')continue;
        const axis=CLINICAL_V3.axes[field];invariant(axis,'Unsupported V3 field: '+field);
        const choices=[...axis.labels].sort((a,b)=>a.span_label.localeCompare(b.span_label));
        const group=groups.get(field)??{field,choices,families:[]};group.families.push(family);groups.set(field,group);
        for(const choice of choices)rows.set(choice.span_label,choice);
    }
    const ordered=[...rows.keys()].sort(),at=new Map(ordered.map((label,index)=>[label,index]));
    return {labels:[...labels,...ordered],byLabel,contentCount:labels.length,descriptions,
        groups:[...groups.values()].map(group=>({...group,choices:group.choices.map(choice=>({value:choice.value,index:at.get(choice.span_label)}))}))};
}
export function validateClinicalV3Registry(registry){
    invariant(registry.registry_sha256===CLINICAL_V3.registryHash,'V3 registry hash mismatch');
    invariant(canonical(registry.core_entities)===canonical(CLINICAL_V3.core)&&canonical(registry.shared_axes)===canonical(CLINICAL_V3.axes),'V3 artifact prompts differ from the application contract');
    invariant(canonical(Object.fromEntries(Object.entries(registry.families).map(([family,definition])=>[family,definition.entity_type])))===canonical(CLINICAL_V3.families),'V3 artifact family mapping mismatch');
}
