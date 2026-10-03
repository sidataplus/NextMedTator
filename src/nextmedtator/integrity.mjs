/** Immutable, Unicode-safe primitives shared by the UI, imports and workers. */
export class ValidationError extends Error {
    constructor(message, code = 'INVALID_DATA') { super(message); this.name = 'ValidationError'; this.code = code; }
}
export function invariant(condition, message, code) { if (!condition)
    throw new ValidationError(message, code); }
export const LIMITS = Object.freeze({ documents: 10000, records: 100000, text: 16 * 1024 * 1024, json: 64 * 1024 * 1024, depth: 40 });
/** Canonical source coverage; overlapping evidence remains covered once. */
export function unionSpans(spans,text,{adjacent=false}={}){
    const map=new OffsetMap(text),ranges=[];
    for(const span of [...spans].sort((a,b)=>a.start-b.start||a.end-b.end)){
        invariant(map.span(span.start,span.end).text===span.text,'Span text does not match source');
        const last=ranges.at(-1);
        if(last&&(span.start<last[1]||(adjacent&&span.start===last[1])))last[1]=Math.max(last[1],span.end);
        else ranges.push([span.start,span.end]);
    }
    return ranges.map(([start,end])=>map.span(start,end));
}
export function jsonParse(text, maxBytes = LIMITS.json) {
    invariant(typeof text === 'string' && new TextEncoder().encode(text).length <= maxBytes, 'JSON exceeds the import limit');
    let result;
    try {
        result = JSON.parse(text);
    }
    catch {
        throw new ValidationError('Invalid JSON');
    }
    let nodes = 0;
    function visit(value, depth) {
        invariant(depth <= LIMITS.depth && ++nodes <= 2000000, 'JSON structure exceeds limits');
        if (value && typeof value === 'object')
            for (const key of Object.keys(value)) {
                invariant(!['__proto__', 'prototype', 'constructor'].includes(key), 'Unsafe object key');
                visit(value[key], depth + 1);
            }
    }
    visit(result, 0);
    return result;
}
export function canonical(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return JSON.stringify(value);
    if (typeof value === 'number') {
        invariant(Number.isFinite(value), 'Non-finite number');
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    invariant(value && Object.getPrototypeOf(value) === Object.prototype, 'Only plain JSON objects are supported');
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
export const clone = value => structuredClone(value);
export function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value))
        freeze(child);
    Object.freeze(value);
} return value; }
export async function sha256(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const fingerprint = value => sha256(canonical(value));
export const uuid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function validId(id) { invariant(typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id), 'Invalid identifier'); return id; }
export function validHash(hash) { invariant(typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash), 'Invalid SHA-256'); return hash; }
export function uniqueIds(items) { const ids = new Set(); for (const item of items) {
    validId(item.id);
    invariant(!ids.has(item.id), 'Duplicate identifier');
    ids.add(item.id);
} }
export function assertUnicode(text) {
    invariant(typeof text === 'string' && text.length <= LIMITS.text, 'Invalid or oversized source text');
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
            const next = text.charCodeAt(++i);
            invariant(next >= 0xdc00 && next <= 0xdfff, 'Unpaired surrogate');
        }
        else
            invariant(c < 0xdc00 || c > 0xdfff, 'Unpaired surrogate');
    }
}
export class OffsetMap {
    constructor(text) { assertUnicode(text); this.text = text; this.cpTo16 = [0]; let n = 0; for (const c of text) {
        n += c.length;
        this.cpTo16.push(n);
    } }
    get length() { return this.cpTo16.length - 1; }
    toUTF16(cp) { invariant(Number.isInteger(cp) && cp >= 0 && cp <= this.length, 'Code-point offset out of bounds'); return this.cpTo16[cp]; }
    toCodePoint(u16) {
        invariant(Number.isInteger(u16) && u16 >= 0 && u16 <= this.text.length, 'UTF-16 offset out of bounds');
        let lo = 0, hi = this.cpTo16.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const v = this.cpTo16[mid];
            if (v === u16)
                return mid;
            if (v < u16)
                lo = mid + 1;
            else
                hi = mid - 1;
        }
        throw new ValidationError('Selection splits a surrogate pair');
    }
    slice(start, end) { invariant(end >= start, 'Reversed span'); return this.text.slice(this.toUTF16(start), this.toUTF16(end)); }
    span(start, end) { invariant(end > start, 'An evidence span must not be empty'); return { start, end, text: this.slice(start, end) }; }
    selection(start16, end16) { return this.span(this.toCodePoint(start16), this.toCodePoint(end16)); }
}
export function validateSpans(spans, text, allowEmpty = false) {
    invariant(Array.isArray(spans) && (allowEmpty || spans.length > 0) && spans.length <= 128, 'Invalid spans');
    const map = new OffsetMap(text);
    let previous = -1;
    for (const span of spans) {
        invariant(span.start >= previous && span.end > span.start, 'Unordered or overlapping spans');
        invariant(map.slice(span.start, span.end) === span.text, 'Span text does not match immutable source', 'OFFSET_MISMATCH');
        previous = span.end;
    }
}
export async function sourceDocument(id, bytes, metadata = {}) {
    validId(id);
    invariant(bytes instanceof Uint8Array && bytes.byteLength <= LIMITS.text, 'Invalid or oversized UTF-8 file');
    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    }
    catch {
        throw new ValidationError('Source must be valid UTF-8; no replacement characters were inserted');
    }
    assertUnicode(text);
    return freeze({ id, text, encoding: 'utf-8', bytesSha256: await sha256(bytes), textSha256: await sha256(text), split: metadata.split ?? 'unassigned', groupId: metadata.groupId ?? null, provenance: clone(metadata.provenance ?? { origin: 'local-import' }) });
}
export function csvCell(value) { let s = String(value ?? ''); if (/^[\s]*[=+@-]/u.test(s))
    s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }
/** Explicit map for the textarea's mandatory CRLF/CR-to-LF display normalization. */
export class TextareaOffsetMap {
    constructor(text) {
        this.source = new OffsetMap(text);
        this.view = '';
        this.viewToSource = new Map([[0, 0]]);
        this.sourceToView = new Map([[0, 0]]);
        for (let i = 0; i < text.length;) {
            let token = String.fromCodePoint(text.codePointAt(i)), end = i + token.length;
            if (token === '\r') {
                if (text[i + 1] === '\n')
                    end++;
                token = '\n';
            }
            this.view += token;
            i = end;
            this.viewToSource.set(this.view.length, i);
            this.sourceToView.set(i, this.view.length);
        }
        this.graphemes = null;
        if (typeof Intl.Segmenter === 'function') {
            this.graphemes = new Set([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(this.view)].map(x => x.index));
            this.graphemes.add(this.view.length);
        }
    }
    selection(start, end) {
        invariant(this.viewToSource.has(start) && this.viewToSource.has(end), 'Selection splits a Unicode character');
        if (this.graphemes)
            invariant(this.graphemes.has(start) && this.graphemes.has(end), 'Selection splits a displayed grapheme');
        return this.source.selection(this.viewToSource.get(start), this.viewToSource.get(end));
    }
    viewOffset(codePointOffset) { const raw = this.source.toUTF16(codePointOffset); invariant(this.sourceToView.has(raw), 'Span boundary falls inside a normalized line ending and cannot be located exactly in this view'); return this.sourceToView.get(raw); }
}
