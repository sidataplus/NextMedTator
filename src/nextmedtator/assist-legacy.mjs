/** MedTator working-copy interop shared by the Assistance panel modules. */
import { OffsetMap, invariant } from './integrity.mjs';

export function utf16Offset(text, codePointOffset) {
    if (!Number.isInteger(codePointOffset) || codePointOffset < 0)
        throw new Error('Offset required');
    let units = 0, seen = 0;
    for (const ch of text) {
        if (seen === codePointOffset)
            return units;
        units += ch.length;
        seen += 1;
    }
    if (seen === codePointOffset)
        return units;
    throw new Error('Offset is outside the document');
}
export function medtatorSpans(text, anchor) {
    return anchor.map(span => {
        const start = utf16Offset(text, span.start);
        const end = utf16Offset(text, span.end);
        if (text.slice(start, end) !== span.text)
            throw new Error('Span text does not match the document');
        return `${start}~${end}`;
    }).join(',');
}
export function documentKey(filename, text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++)
        hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return `${filename}\0${text.length}\0${hash >>> 0}`;
}
export function spanTags(tags) {
    return (tags ?? []).filter(tag => !tag.is_non_consuming);
}
export function preferredTag(family, tags) {
    const span = spanTags(tags);
    const want = String(family ?? '').toLowerCase();
    const named = span.find(tag => tag.name.toLowerCase() === want || tag.name.toLowerCase().replaceAll('_', '') === want.replaceAll('_', ''));
    if (named)
        return named.name;
    return span.length === 1 ? span[0].name : '';
}
export function editableAttrs(tagDef) {
    return (tagDef?.attrs ?? []).filter(attr => !['id', 'spans', 'text', 'tag'].includes(attr.name) && attr.vtype !== 'idref' && attr.vtype !== 'dfix');
}
export function attributeDraft(attrs, fields) {
    const values = {}, used = new Set();
    for (const attr of attrs ?? []) {
        if (['id', 'spans', 'text', 'tag'].includes(attr.name) || attr.vtype === 'idref' || attr.vtype === 'dfix')
            continue;
        values[attr.name] = attr.default_value ?? '';
        const match = Object.keys(fields ?? {}).find(name => name.toLowerCase() === attr.name.toLowerCase());
        if (!match || fields[match] == null)
            continue;
        const value = String(fields[match]);
        if (attr.vtype === 'list' && Array.isArray(attr.values) && !attr.values.includes(value))
            continue;
        values[attr.name] = value;
        used.add(match);
    }
    const unmatched = Object.keys(fields ?? {}).filter(name => name !== 'concept' && fields[name] != null && !used.has(name));
    return { values, unmatched };
}

export function legacySchema(dtd) {
    const families = {};
    for (const tag of dtd?.etags ?? []) {
        const fields = Object.fromEntries(editableAttrs(tag).map(attr => [attr.name, {
            type: attr.vtype === 'list' ? 'enum' : 'text',
            ...(attr.vtype === 'list' ? { values: attr.values } : {}),
        }]));
        families[tag.name] = {
            label: tag.name,
            ...(tag.is_non_consuming ? { documentLevel: true } : {}),
            fields: { concept: { type: 'text' }, ...fields },
        };
    }
    invariant(Object.keys(families).length, 'Load a span annotation schema');
    const relations = {};
    for (const tag of dtd?.rtags ?? []) {
        const refs = (tag.attrs ?? []).filter(a => a.vtype === 'idref');
        if (refs.length === 2)
            relations[tag.name] = { head: Object.keys(families), tail: Object.keys(families), legacy: { head: refs[0].name, tail: refs[1].name } };
    }
    return { id: 'medtator-schema', version: '1', families, ...(Object.keys(relations).length ? { relations } : {}) };
}
export function legacyRecords(ann, doc, schema) {
    const map = new OffsetMap(doc.text);
    const fieldValue = (tag, name, def) => {
        if (name === 'concept')
            return tag.text;
        // An empty enum choice means "unset" unless the schema lists it.
        if (def.type === 'enum' && tag[name] === '' && !def.values.includes(''))
            return null;
        return tag[name] ?? null;
    };
    const records = (ann.tags ?? []).filter(t => t.spans && schema.families[t.tag]).map(t => {
        const family = schema.families[t.tag];
        return {
            id: t.id,
            documentId: doc.id,
            family: t.tag,
            anchor: family.documentLevel ? [] : t.spans.split(',').map(range => {
                const [a, b] = range.split('~').map(Number);
                return map.selection(a, b);
            }),
            fields: Object.fromEntries(Object.entries(family.fields).map(([name, def]) => [name, fieldValue(t, name, def)])),
            origin: { kind: 'imported', source: 'medtator-working-copy', reviewStatus: 'unknown' },
        };
    });
    for (const tag of ann.tags ?? []) {
        const rel = schema.relations?.[tag.tag];
        if (!rel)
            continue;
        const head = records.find(r => r.id === tag[rel.legacy.head]), tail = records.find(r => r.id === tag[rel.legacy.tail]);
        invariant(head && tail, 'Legacy relation endpoint is missing');
        head.relations ??= [];
        head.relations.push({ type: tag.tag, targetId: tail.id });
    }
    return records;
}
