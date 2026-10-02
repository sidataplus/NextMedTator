import { sourceDocument, OffsetMap, uuid, clone } from './integrity.mjs';
import { DEMO_SCHEMA } from './contracts.mjs';
import { ReviewProject, makeRun } from './project.mjs';
const text = [
    'Her mother has diabetes. The patient denies diabetes.',
    'Temperature 38.2 °C. Oxygen saturation is 97% on room air.',
    'Started amoxicillin yesterday. Surgery is planned next month.',
    'A fall occurred in 2019. The patient reports no falls this year.',
    'Needs assistance with dressing but eats independently.\r\nภาษาไทย 👩‍⚕️ café e\u0301'
];
export const DEMO_NOTICE = 'Original synthetic walkthrough. Suggestions and reference examples were authored for demonstration, not produced by GLiNER or clinically validated.';
export async function demoProject(mode = 'assisted', actor = 'demo-reviewer') {
    const documents = await Promise.all(text.map((t, i) => sourceDocument(`synthetic-${i + 1}`, new TextEncoder().encode(t), { split: 'demo', groupId: `synthetic-case-${i + 1}`, provenance: { origin: 'synthetic', license: 'Apache-2.0', notice: DEMO_NOTICE } })));
    return ReviewProject.create(documents, DEMO_SCHEMA, { mode, actor });
}
function record(doc, family, phrase, fields, from = 0) { const map = new OffsetMap(doc.text), start = doc.text.indexOf(phrase, from); return { id: uuid(), documentId: doc.id, family, anchor: [map.selection(start, start + phrase.length)], fields, origin: { kind: 'author-demo' } }; }
export function authoredReference(doc) {
    const context = { assertion: 'present', temporality: 'current', experiencer: 'patient' };
    switch (doc.id) {
        case 'synthetic-1': return [record(doc, 'condition_occurrence', 'diabetes', { concept: 'diabetes', ...context, experiencer: 'family' }), record(doc, 'condition_occurrence', 'diabetes', { concept: 'diabetes', ...context, assertion: 'negated' }, 25)];
        case 'synthetic-2': return [record(doc, 'measurement_occurrence', 'Temperature', { concept: 'temperature', ...context, value: '38.2', unit: '°C' }), record(doc, 'measurement_occurrence', 'Oxygen saturation', { concept: 'oxygen saturation', ...context, value: '97', unit: '%' })];
        case 'synthetic-3': return [record(doc, 'treatment_occurrence', 'amoxicillin', { concept: 'amoxicillin', ...context }), record(doc, 'treatment_occurrence', 'Surgery', { concept: 'surgery', ...context, temporality: 'future' })];
        case 'synthetic-4': return [record(doc, 'event_occurrence', 'fall', { concept: 'fall', ...context, temporality: 'historical' }), record(doc, 'event_occurrence', 'falls', { concept: 'fall', ...context, assertion: 'negated' })];
        case 'synthetic-5': return [record(doc, 'function_occurrence', 'dressing', { concept: 'assistance with dressing', ...context }), record(doc, 'function_occurrence', 'eats independently', { concept: 'independent eating', ...context })];
        default: throw Error('Recorded examples are only available for the synthetic walkthrough');
    }
}
export async function authoredSuggestionRun(project, doc) {
    const records = clone(authoredReference(doc));
    // Intentionally imperfect authored examples teach error correction and omission review.
    if (doc.id === 'synthetic-1') {
        records[0].fields.experiencer = 'patient';
        records.pop();
    }
    if (doc.id === 'synthetic-2')
        records[0].fields.unit = null;
    return makeRun(project, doc, records, { producer: { kind: 'author-demo', name: 'Authored walkthrough suggestions', version: '1', notice: DEMO_NOTICE } });
}
