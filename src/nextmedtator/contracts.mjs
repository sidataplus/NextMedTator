import {coreBackend} from './backend/core-client.mjs';
const useWasm=()=>typeof document!=='undefined'&&typeof Worker!=='undefined'&&/^https?:$/.test(globalThis.location?.protocol??'');
import { invariant, freeze, clone, validId, validHash, uniqueIds, validateSpans, OffsetMap, fingerprint, sha256, LIMITS, assertUnicode } from './integrity.mjs';
export const VERSION = 'nextmedtator-project-v1';
export const FAMILIES = Object.freeze(['condition_occurrence', 'measurement_occurrence', 'treatment_occurrence', 'event_occurrence', 'function_occurrence']);
const context = { assertion: { type: 'enum', values: ['present', 'negated', 'possible', 'conditional', 'unknown'] }, temporality: { type: 'enum', values: ['current', 'historical', 'future', 'unknown'] }, experiencer: { type: 'enum', values: ['patient', 'family', 'other', 'unknown'] } };
// Provisional UI preset. A supplied Clinical-Evidence schema is authoritative.
export const DEMO_SCHEMA = freeze({ id: 'clinical-evidence-demo', version: '1.0.0', description: 'Demonstration schema, not the final training grammar', families: Object.fromEntries(FAMILIES.map(f => [f, { label: f.replaceAll('_', ' '), fields: { concept: { type: 'text' }, ...clone(context), ...(f === 'measurement_occurrence' ? { value: { type: 'text' }, unit: { type: 'text' } } : {}) } }])) });
export function validateSchema(schema) {
    validId(schema.id);
    invariant(typeof schema.version === 'string', 'Schema version required');
    invariant(schema.families && typeof schema.families === 'object' && !Array.isArray(schema.families), 'Schema families required');
    invariant(Object.keys(schema.families).length > 0 && Object.keys(schema.families).length <= 200, 'Schema family limit');
    for (const [family, def] of Object.entries(schema.families)) {
        validId(family);
        for(const key of ['recordParent','recordAnchorLabel'])if(def[key]!=null)invariant(typeof def[key]==='string'&&def[key].length>0&&def[key].length<=200,'Invalid record query mapping');
        invariant(def.fields && typeof def.fields === 'object' && !Array.isArray(def.fields), 'Family fields required');
        invariant(Object.keys(def.fields).length <= 100, 'Field limit');
        for (const [name, field] of Object.entries(def.fields)) {
            validId(name);
            invariant(['text', 'number', 'boolean', 'enum', 'span'].includes(field.type), 'Unsupported field type');
            if (field.type === 'enum')
                invariant(Array.isArray(field.values) && field.values.length > 0 && field.values.length <= 1000 && field.values.every(v => typeof v === 'string') && new Set(field.values).size === field.values.length, 'Invalid enum');
        }
    }
    for(const [type,rel] of Object.entries(schema.relations??{})){validId(type);invariant(Array.isArray(rel.head)&&Array.isArray(rel.tail)&&[...rel.head,...rel.tail].every(id=>schema.families[id]),'Invalid relation families');}
    return schema;
}
export function validateRecord(record, doc, schema) {
    validId(record.id);
    invariant(record.documentId === doc.id, 'Record belongs to another document');
    const def = schema.families[record.family];
    invariant(def, 'Unknown occurrence family');
    validateSpans(record.anchor, doc.text, def.documentLevel === true);
    invariant(record.fields && typeof record.fields === 'object' && !Array.isArray(record.fields), 'Record fields required');
    for (const [name, value] of Object.entries(record.fields)) {
        const field = def.fields[name];
        invariant(field, 'Unknown field');
        if (value === null)
            continue;
        if (field.type === 'span') {
            validateSpans(value, doc.text);
            continue;
        }
        invariant(field.type === 'enum' ? field.values.includes(value) : typeof value === (field.type === 'text' ? 'string' : field.type), 'Invalid field value');
        if (typeof value === 'number')
            invariant(Number.isFinite(value), 'Non-finite field');
        if (typeof value === 'string')
            invariant(value.length <= 20000, 'Oversized field');
    }
    if (record.evidence)
        validateSpans(record.evidence, doc.text, true);
    if (record.score != null)
        invariant(Number.isFinite(record.score), 'Invalid model score');
    if (record.relations) {
        invariant(Array.isArray(record.relations) && record.relations.length <= 1000, 'Invalid relations');
        for (const rel of record.relations) {
            validId(rel.targetId);
            validId(rel.type);
            if(schema.relations)invariant(schema.relations[rel.type]?.head.includes(record.family),'Unsupported relation type or head family');
        }
    }
    return record;
}
export function validateRecords(records, documents, schema) {
    invariant(Array.isArray(records) && records.length <= LIMITS.records, 'Too many records');
    uniqueIds(records);
    const docs = new Map(documents.map(d => [d.id, d]));
    const ids = new Map(records.map(r => [r.id, r]));
    for (const r of records) {
        const d = docs.get(r.documentId);
        invariant(d, 'Unknown document');
        validateRecord(r, d, schema);
        for (const rel of r.relations ?? []) {
            const target = ids.get(rel.targetId);
            invariant(target && target.documentId === r.documentId, 'Dangling or cross-document relation');
            if(schema.relations)invariant(schema.relations[rel.type].tail.includes(target.family),'Unsupported relation tail family');
        }
    }
}
export function validateCoverage(coverage, doc, status) {
    invariant(Array.isArray(coverage), 'Coverage required');
    const n = new OffsetMap(doc.text).length;
    let end = 0;
    for (const range of coverage) {
        invariant(Array.isArray(range) && range.length === 2, 'Invalid coverage range');
        const [a, b] = range;
        invariant(Number.isInteger(a) && Number.isInteger(b) && a >= end && b >= a && b <= n, 'Invalid coverage');
        if (status === 'complete')
            invariant(a === end, 'Complete run has a coverage gap');
        end = b;
    }
    if (status === 'complete')
        invariant(end === n, 'Complete run does not cover the document');
}
export async function validateRun(run, project, {recordsValidated=false}={}) {
    validId(run.id);
    invariant(['complete', 'partial', 'cancelled', 'failed', 'unsupported'].includes(run.status), 'Invalid run status');
    invariant(run.schemaHash === project.schemaHash, 'Run schema mismatch');
    invariant(run.producer && ['model', 'author-demo', 'imported'].includes(run.producer.kind), 'Producer provenance required');
    invariant(run.settings && run.runtime && typeof run.runtime.backend === 'string', 'Run settings/runtime required');
    const doc = project.documents.find(d => d.id === run.documentId);
    invariant(doc, 'Unknown run document');
    invariant(run.sourceHash === doc.textSha256, 'Run source mismatch');
    validateCoverage(run.coverage, doc, run.status);
    if(!recordsValidated){if(useWasm())await coreBackend.validate({schema:project.schema,documents:[doc],draft:{records:run.records},runs:[],snapshots:[]});else validateRecords(run.records,[doc],project.schema);}
    for (const record of run.records)
        for (const span of [...record.anchor, ...(record.evidence ?? [])])
            invariant(run.coverage.some(([a, b]) => span.start >= a && span.end <= b), 'Prediction outside declared coverage');
    const expected = await fingerprint(runIdentity(run));
    invariant(run.fingerprint === expected, 'Run fingerprint mismatch');
    return run;
}
export function runIdentity(run) { return { documentId: run.documentId, sourceHash: run.sourceHash, schemaHash: run.schemaHash, producer: run.producer, settings: run.settings, runtime: run.runtime }; }
export async function validateProject(project) {
    invariant(project.format === VERSION, 'Unsupported project version');
    validId(project.id);
    validateSchema(project.schema);
    validHash(project.schemaHash);
    invariant(await fingerprint(project.schema) === project.schemaHash, 'Schema hash mismatch');
    invariant(Array.isArray(project.documents) && project.documents.length <= LIMITS.documents, 'Document limit');
    uniqueIds(project.documents);
    for (const doc of project.documents) {
        assertUnicode(doc.text);
        invariant(doc.encoding === 'utf-8', 'Unsupported source encoding');
        validHash(doc.textSha256);
        validHash(doc.bytesSha256);
        invariant(await sha256(doc.text) === doc.textSha256 && doc.bytesSha256 === doc.textSha256, 'Source hash mismatch');
        invariant(['train', 'validation', 'test', 'protected', 'demo', 'unassigned'].includes(doc.split), 'Invalid split');
    }
    invariant(project.mode === 'assisted' || project.mode === 'blind', 'Invalid mode');
    invariant(typeof project.actor === 'string' && project.actor.trim().length > 0 && project.actor.length <= 100, 'Invalid annotator identifier');
    invariant(Array.isArray(project.exposure), 'Exposure history required');
    invariant(project.draft && project.draft.decisions && project.draft.completeness, 'Draft review state required');
    for (const key of ['runs', 'snapshots', 'events']) {
        invariant(Array.isArray(project[key]), `Missing ${key}`);
        uniqueIds(project[key]);
    }
    const recordsValidated=useWasm();
    if(recordsValidated)await coreBackend.validate(project);else validateRecords(project.draft.records,project.documents,project.schema);
    validateCompleteness(project.draft.completeness, project.documents, project.schema);
    invariant(project.mode !== 'blind' || project.phase !== 'annotation' || (project.runs.length === 0 && project.snapshots.length === 0 && project.exposure.length === 0), 'Blind assignment already contains exposed material');
    for (const run of project.runs)
        await validateRun(run, project, {recordsValidated});
    for (const snapshot of project.snapshots) {
        const { hash, ...body } = snapshot;
        invariant(await fingerprint(body) === hash, 'Snapshot hash mismatch');
        invariant(snapshot.schemaHash === project.schemaHash, 'Snapshot schema mismatch');
        invariant(snapshot.sources && Object.keys(snapshot.sources).length === project.documents.length, 'Snapshot source inventory mismatch');
        for (const doc of project.documents)
            invariant(snapshot.sources[doc.id] === doc.textSha256, 'Snapshot source mismatch');
        invariant(['human', 'machine', 'adjudicated'].includes(snapshot.kind), 'Unsupported snapshot kind');
        if(!recordsValidated)validateRecords(snapshot.records,project.documents,project.schema);
        validateCompleteness(snapshot.completeness, project.documents, project.schema, { machine: snapshot.kind === 'machine' });
    }
    for(const report of project.extensions?.comparisons??[]){const {hash,...body}=report;invariant(await fingerprint(body)===hash,'Comparison hash mismatch');invariant(project.snapshots.some(s=>s.hash===report.referenceHash)&&project.snapshots.some(s=>s.hash===report.candidateHash),'Comparison input missing');}
    invariant(project.phase === 'annotation' || project.phase === 'frozen' || project.phase === 'revealed', 'Invalid phase');
    invariant(project.phase === 'annotation' || project.snapshots.length > 0, 'Frozen state without snapshot');
    return project;
}
export function validateCompleteness(items, documents, schema, { machine = false } = {}) {
    invariant(items && typeof items === 'object' && !Array.isArray(items), 'Invalid completeness map');
    const docs = new Map(documents.map(d => [d.id, d]));
    for (const [id, value] of Object.entries(items)) {
        const doc = docs.get(id);
        invariant(doc, 'Completeness references unknown source');
        invariant(typeof value.full === 'boolean', 'Explicit completeness status required');
        if (machine) {
            invariant(['complete', 'partial', 'failed', 'cancelled', 'unsupported'].includes(value.status), 'Invalid machine coverage status');
            validateCoverage(value.coverage, doc, value.status);
            invariant(value.full === (value.status === 'complete'), 'Machine completeness contradicts coverage');
            continue;
        }
        invariant(Array.isArray(value.families) && value.families.every(f => schema.families[f]), 'Invalid reviewed families');
        invariant(typeof value.omissionsChecked === 'boolean' && typeof value.unresolved === 'boolean', 'Omission/uncertainty status required');
        validateCoverage(value.ranges, doc, 'partial');
        const n = new OffsetMap(doc.text).length, full = value.ranges.length === 1 && value.ranges[0][0] === 0 && value.ranges[0][1] === n && Object.keys(schema.families).every(f => value.families.includes(f)) && value.omissionsChecked && !value.unresolved;
        invariant(value.full === full, 'Completeness flag contradicts reviewed coverage');
    }
}
