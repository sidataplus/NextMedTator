import { invariant, sourceDocument, OffsetMap, uuid, clone, jsonParse, csvCell } from './integrity.mjs';
import { ReviewProject } from './project.mjs';
import { validateRecords } from './contracts.mjs';
/** JSONL is mapped explicitly. Filenames/identifiers are never sent to a server. */
export async function importJSONL(text, schema, { idField = 'id', textField = 'text', splitField = null, groupField = null, mode = 'assisted', actor = 'annotator' } = {}) {
    const rows = text.split(/\r?\n/).filter(l => l.trim());
    invariant(rows.length > 0 && rows.length <= 10000, 'JSONL document limit');
    const documents = [];
    for (const [i, line] of rows.entries()) {
        const row = jsonParse(line), value = row[textField];
        invariant(typeof value === 'string', `Missing text in row ${i + 1}`);
        const originalId = row[idField];
        invariant(typeof originalId === 'string' || typeof originalId === 'number', `Missing ID in row ${i + 1}`);
        // Preserve source IDs as local metadata; canonical IDs are safe for paths and references.
        const doc = await sourceDocument(`document-${i + 1}`, new TextEncoder().encode(value), { split: splitField ? row[splitField] : 'unassigned', groupId: groupField ? row[groupField] ?? null : null, provenance: { kind: 'jsonl', originalId: String(originalId) } });
        documents.push(doc);
    }
    return ReviewProject.create(documents, schema, { mode, actor });
}
const xmlEscape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;').replaceAll('\r', '&#13;').replaceAll('\n', '&#10;').replaceAll('\t', '&#9;');
const xmlName = name => { invariant(/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name), 'Family/field name cannot be represented by MedTator XML'); return name; };
export function exportMedTator(doc, records, schema) {
    validateRecords(records, [doc], schema);
    const map = new OffsetMap(doc.text), losses = [];
    const tags = records.map(r => {
        const spans = r.anchor.length ? r.anchor.map(s => `${map.toUTF16(s.start)}~${map.toUTF16(s.end)}`).join(',') : '-1~-1';
        const attrs = { id: r.id, spans, text: r.anchor.map(s => s.text).join(' ... ') };
        for (const [name, value] of Object.entries(r.fields)) {
            xmlName(name);
            if (['id', 'spans', 'text', 'tag'].includes(name)) {
                losses.push({ recordId: r.id, field: name, reason: 'Reserved legacy attribute' });
                continue;
            }
            if (value === null) {
                losses.push({ recordId: r.id, field: name, reason: 'Unknown/null omitted; not equivalent to absent' });
                continue;
            }
            if (typeof value === 'object') {
                losses.push({ recordId: r.id, field: name, reason: 'Structured field retained only in native project' });
                continue;
            }
            attrs[name] = value;
        }

        if (r.evidence?.length)
            losses.push({ recordId: r.id, reason: 'Supporting evidence retained only in native project' });
        return `<${xmlName(r.family)} ${Object.entries(attrs).map(([k, v]) => `${k}="${xmlEscape(v)}"`).join(' ')}/>`;
    });
    for(const r of records)for(const [i,rel] of (r.relations??[]).entries()){const mapping=schema.relations?.[rel.type]?.legacy??{head:'arg0',tail:'arg1'};tags.push(`<${xmlName(rel.type)} id="${xmlEscape('relation-'+r.id+'-'+i)}" ${xmlName(mapping.head)}="${xmlEscape(r.id)}" ${xmlName(mapping.tail)}="${xmlEscape(rel.targetId)}"/>`);}
    losses.push({ reason: 'Machine lineage, review history, completeness and snapshots are retained only in the native project' });
    // Character references preserve CR across XML end-of-line normalization.
    return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n<NEXTMEDTATOR><TEXT>${xmlEscape(doc.text)}</TEXT><TAGS>${tags.join('\n')}</TAGS><META/></NEXTMEDTATOR>\n`, losses };
}
/** Browser-only parser; native project bundles remain the authoritative interchange. */
export async function importMedTator(xml, { mode = 'assisted', actor = 'annotator', documentId = uuid(), relationMappings = {} } = {}) {
    invariant(new TextEncoder().encode(xml).length <= 64 * 1024 * 1024, 'XML size limit');
    invariant(!/<!DOCTYPE|<!ENTITY/i.test(xml), 'DTD and entity declarations are not accepted in annotation XML');
    const tree = new DOMParser().parseFromString(xml, 'application/xml');
    invariant(!tree.querySelector('parsererror'), 'Invalid XML');
    const root = tree.documentElement;
    const textNode = [...root.children].find(n => n.tagName === 'TEXT'), tagsNode = [...root.children].find(n => n.tagName === 'TAGS');
    invariant(textNode && tagsNode, 'Missing TEXT or TAGS');
    const doc = await sourceDocument(documentId, new TextEncoder().encode(textNode.textContent), { provenance: { kind: 'medtator-xml', offsetConvention: 'utf16', license: 'unknown' } }), map = new OffsetMap(doc.text);
    const schema = { id: 'medtator-import', version: '1', description: 'Inferred text attributes; load an explicit schema for typed semantics', families: {} };
    const records = [], losses = [], pendingRelations=[];
    for (const tag of tagsNode.children) {
        const family = xmlName(tag.tagName), raw = tag.getAttribute('spans');
        if (raw == null) {
            const mapping=relationMappings[family]??(tag.hasAttribute('arg0')&&tag.hasAttribute('arg1')?{head:'arg0',tail:'arg1'}:tag.hasAttribute('fromID')&&tag.hasAttribute('toID')?{head:'fromID',tail:'toID'}:null);
            if(mapping){pendingRelations.push({type:family,headId:tag.getAttribute(mapping.head),tailId:tag.getAttribute(mapping.tail),mapping});for(const attr of tag.attributes)if(!['id',mapping.head,mapping.tail].includes(attr.name))losses.push({tag:family,field:attr.name,reason:'Relation attribute requires explicit native mapping'});}else losses.push({ tag: family, reason: 'Supply a relationMappings entry naming head/tail IDREF attributes; this relation was not imported' });
            continue;
        }
        const documentLevel = raw === '-1~-1';
        const anchor = documentLevel ? [] : raw.split(',').map(s => { invariant(/^\d+~\d+$/.test(s), 'Invalid legacy span syntax'); const [a, b] = s.split('~').map(Number); return map.selection(a, b); });
        const expected = tag.getAttribute('text');
        if (expected !== null && anchor.length === 1)
            invariant(anchor[0].text === expected, 'Legacy offsets do not match text. CRLF normalization or offset convention may differ. Import is quarantined.');
        schema.families[family] ??= { label: family, documentLevel, fields: {} };
        invariant(schema.families[family].documentLevel === documentLevel, 'Mixed document-level and span tags require explicit schema');
        const fields = {};
        for (const attr of tag.attributes) {
            if (['id', 'spans', 'text', 'tag'].includes(attr.name))
                continue;
            xmlName(attr.name);
            fields[attr.name] = attr.value;
            schema.families[family].fields[attr.name] = { type: 'text' };
        }
        records.push({ id: tag.getAttribute('id') ?? uuid(), documentId, family, anchor, fields, origin: { kind: 'imported', source: 'medtator-xml', reviewStatus: 'unknown' } });
    }
    for(const rel of pendingRelations){const head=records.find(r=>r.id===rel.headId),tail=records.find(r=>r.id===rel.tailId);invariant(head&&tail,'Legacy relation references missing entities');head.relations??=[];head.relations.push({type:rel.type,targetId:tail.id});schema.relations??={};schema.relations[rel.type]??={head:[],tail:[],legacy:rel.mapping};for(const [role,r] of [['head',head],['tail',tail]])if(!schema.relations[rel.type][role].includes(r.family))schema.relations[rel.type][role].push(r.family);}
    if (!Object.keys(schema.families).length)
        schema.families.entity = { fields: { concept: { type: 'text' } }, label: 'Entity' };
    const project = await ReviewProject.create([doc], schema, { mode, actor });
    const data = clone(project.current);
    data.draft.records = records;
    data.extensions.importReport = { kind: 'medtator-xml', losses };
    return { project: await ReviewProject.open(data), losses };
}
export function evidenceJSONL(project, snapshot) { return project.documents.map(doc => JSON.stringify({ documentId: doc.id, text: doc.text, sourceHash: doc.textSha256, split: doc.split, groupId: doc.groupId, schemaHash: project.schemaHash, snapshotHash: snapshot.hash, schema:project.schema, modelRuns:project.runs.filter(r=>r.documentId===doc.id).map(r=>({fingerprint:r.fingerprint,producer:r.producer,runtime:r.runtime,settings:r.settings})), unresolved:snapshot.unresolved??[], completeness: snapshot.completeness[doc.id] ?? null, exposure: snapshot.exposure, records: snapshot.records.filter(r => r.documentId === doc.id) })).join('\n') + '\n'; }
export function eventCSV(events) { return ['event_id,action,actor,time', ...events.map(e => [e.id, e.action, e.actor, e.at].map(csvCell).join(','))].join('\n'); }
