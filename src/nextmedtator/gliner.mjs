import { invariant, jsonParse, OffsetMap, uuid } from './integrity.mjs';
/** Application-owned GLiNER2.5 boundary span codec. Packages supply graphs and a tokenizer, never executable code. */
export const GLINER_CODEC = 'gliner25-boundary-span-v1';
export const GLINER_STRUCTURED = 'gliner25-boundary-structured-v1';
export const GLINER_LIMITS = Object.freeze({ sequence: 512, labels: 64, wordOverlap: 32, threshold: 0.5, abstention: 0.5, explicitWords: 512 });
export const SPAN_NOTICE = 'GLiNER2.5 boundary span extraction on this device. Scores are span probabilities. Assertion, temporality, experiencer, measurement value/unit, and relations are not predicted.';
export const STRUCTURED_NOTICE = 'GLiNER2.5 boundary spans plus the span-attribute head on this device. Enum fields are the softmax choice at the retained span. Measurement value, unit, and relations are not predicted.';
const encoder = new TextEncoder();
const META = '\u2581';
const EXTRA_SPACE = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x85]);
const cps = text => [...text];
export function isPythonSpace(ch) {
    const cp = ch.codePointAt(0);
    return EXTRA_SPACE.has(cp) || /\p{Z}/u.test(ch);
}
function isWordChar(ch) { return ch === '_' || /[\p{L}\p{N}]/u.test(ch); }
function isAsciiClass(ch, pattern) { return pattern.test(ch); }
/** GLiNER2 whitespace splitter. Offsets are Unicode code points into the original string. */
export function splitWords(text) {
    invariant(typeof text === 'string', 'Text required');
    const chars = cps(text), words = [];
    for (let i = 0; i < chars.length;) {
        if (isPythonSpace(chars[i])) {
            i++;
            continue;
        }
        const size = matchUrl(chars, i) || matchEmail(chars, i) || matchMention(chars, i) || matchWord(chars, i) || 1;
        words.push({ text: chars.slice(i, i + size).join('').toLowerCase(), start: i, end: i + size });
        i += size;
    }
    return words;
}
function matchUrl(chars, i) {
    const head = chars.slice(i, i + 8).join('').toLowerCase();
    const scheme = head.startsWith('https://') ? 8 : head.startsWith('http://') ? 7 : head.startsWith('www.') ? 4 : 0;
    if (!scheme || i + scheme >= chars.length || isPythonSpace(chars[i + scheme]))
        return 0;
    let j = i + scheme;
    while (j < chars.length && !isPythonSpace(chars[j]))
        j++;
    return j - i;
}
function matchEmail(chars, i) {
    let j = i;
    if (!isAsciiClass(chars[j] ?? '', /[A-Za-z0-9._%+-]/))
        return 0;
    while (j < chars.length && isAsciiClass(chars[j], /[A-Za-z0-9._%+-]/))
        j++;
    if (chars[j] !== '@')
        return 0;
    const domain = j + 1;
    j = domain;
    while (j < chars.length && isAsciiClass(chars[j], /[A-Za-z0-9.-]/))
        j++;
    const dom = chars.slice(domain, j);
    let best = -1;
    for (let k = dom.length; k >= 4; k--)
        if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(dom.slice(0, k).join(''))) {
            best = k;
            break;
        }
    return best < 0 ? 0 : domain + best - i;
}
function matchMention(chars, i) {
    if (chars[i] !== '@' || !isAsciiClass(chars[i + 1] ?? '', /[A-Za-z0-9_]/))
        return 0;
    let j = i + 2;
    while (j < chars.length && isAsciiClass(chars[j], /[A-Za-z0-9_]/))
        j++;
    return j - i;
}
function matchWord(chars, i) {
    if (!isWordChar(chars[i]))
        return 0;
    let j = i + 1;
    while (j < chars.length && isWordChar(chars[j]))
        j++;
    while (j + 1 < chars.length && (chars[j] === '-' || chars[j] === '_') && isWordChar(chars[j + 1])) {
        j += 2;
        while (j < chars.length && isWordChar(chars[j]))
            j++;
    }
    return j - i;
}
function normalizeToken(text) {
    const chars = cps(text);
    let out = '';
    for (let i = 0; i < chars.length;) {
        if (!isPythonSpace(chars[i])) {
            out += chars[i++];
            continue;
        }
        let j = i + 1;
        while (j < chars.length && isPythonSpace(chars[j]))
            j++;
        out += j - i >= 2 || chars[i] === '\n' || chars[i] === '\r' || chars[i] === '\t' ? ' ' : chars[i];
        i = j;
    }
    const normalized = cps(out.normalize('NFC'));
    while (normalized.length && isPythonSpace(normalized.at(-1)))
        normalized.pop();
    return normalized.join('');
}
function metaspace(text) {
    let value = text.replaceAll(' ', META);
    if (!value.startsWith(META))
        value = META + value;
    const parts = [];
    let buf = '';
    for (const ch of value) {
        if (ch === META && buf) {
            parts.push(buf);
            buf = META;
        }
        else
            buf += ch;
    }
    if (buf)
        parts.push(buf);
    return parts;
}
function utf8Length(cp) { return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4; }
/** Hugging Face Unigram (optimized Viterbi, fused unknown pieces) plus Deberta metaspace. */
export class GlinerTokenizer {
    constructor(vocab, unkId, added) {
        this.unkId = unkId;
        this.added = added;
        this.tokenToId = new Map();
        this.minScore = Infinity;
        this.root = { next: new Map() };
        vocab.forEach(([token, score], id) => {
            invariant(typeof token === 'string' && typeof score === 'number' && Number.isFinite(score), 'Invalid unigram vocab');
            this.tokenToId.set(token, id);
            this.minScore = Math.min(this.minScore, score);
            let node = this.root;
            for (const byte of encoder.encode(token)) {
                if (!node.next.has(byte))
                    node.next.set(byte, { next: new Map() });
                node = node.next.get(byte);
            }
            node.id = id;
            node.score = score;
        });
        invariant(Number.isInteger(unkId) && unkId >= 0 && unkId < vocab.length, 'Unigram unk id missing');
    }
    static fromJson(text) {
        const parsed = jsonParse(text, 32 * 1024 * 1024);
        const model = parsed.model;
        invariant(model?.type === 'Unigram' && model.byte_fallback !== true && Array.isArray(model.vocab), 'Tokenizer must be an Unigram model without byte fallback');
        const added = new Map();
        for (const token of parsed.added_tokens ?? [])
            if (token.special && typeof token.content === 'string' && Number.isInteger(token.id))
                added.set(token.content, token.id);
        return new GlinerTokenizer(model.vocab, model.unk_id, added);
    }
    idFor(token) { return this.added.get(token) ?? this.tokenToId.get(token) ?? this.unkId; }
    /** Unigram pieces for one already-normalized string, with no metaspace. */
    unigramPieces(sentence) { return this.#encodeUnigram(sentence); }
    encodeIds(text) {
        invariant(typeof text === 'string', 'Token text required');
        if (this.added.has(text))
            return [this.added.get(text)];
        const ids = [];
        for (const piece of metaspace(normalizeToken(text)))
            for (const token of this.#encodeUnigram(piece))
                ids.push(this.tokenToId.get(token) ?? this.unkId);
        return ids;
    }
    #prefixes(bytes, start) {
        const found = [];
        let node = this.root;
        for (let i = start; i < bytes.length && node; i++) {
            node = node.next.get(bytes[i]);
            if (node?.id !== undefined)
                found.push({ end: i + 1, id: node.id, score: node.score });
        }
        return found;
    }
    #encodeUnigram(sentence) {
        if (!sentence)
            return [];
        const bytes = encoder.encode(sentence), size = bytes.length, unk = this.minScore - 10;
        const best = Array.from({ length: size + 1 }, () => ({ score: 0, start: -1, unk: false }));
        let starts = 0;
        for (const ch of sentence) {
            const mblen = utf8Length(ch.codePointAt(0)), path = best[starts].score;
            let single = false;
            for (const hit of this.#prefixes(bytes, starts)) {
                const node = best[hit.end];
                const candidate = path + hit.score;
                if (node.start < 0 || candidate > node.score) {
                    node.score = candidate;
                    node.start = starts;
                    node.unk = false;
                }
                if (hit.end - starts === mblen)
                    single = true;
            }
            if (!single) {
                const node = best[starts + mblen], candidate = path + unk;
                if (node.start < 0 || candidate > node.score) {
                    node.score = candidate;
                    node.start = starts;
                    node.unk = true;
                }
            }
            starts += mblen;
        }
        const pieces = [];
        let end = size, fused = [];
        while (end > 0) {
            const node = best[end];
            invariant(node.start >= 0, 'Unigram path broken');
            const slice = new TextDecoder().decode(bytes.subarray(node.start, end));
            if (node.unk)
                fused.push(slice);
            else {
                if (fused.length)
                    pieces.push(fused.reverse().join(''));
                fused = [];
                pieces.push(slice);
            }
            end = node.start;
        }
        if (fused.length)
            pieces.push(fused.reverse().join(''));
        return pieces.reverse();
    }
}
export function readGlinerConfig(text) {
    const config = jsonParse(text);
    invariant(config.architecture === 'boundary' && config.special_tokens, 'GLiNER config must declare the boundary architecture');
    for (const name of ['[E]', '[P]', '[SEP_TEXT]', '[SEP_STRUCT]'])
        invariant(Number.isInteger(config.special_tokens[name]), 'GLiNER special-token id missing');
    return config.special_tokens;
}
export function schemaEntityLabels(schema) {
    const labels = [], byLabel = new Map();
    invariant(Object.keys(schema.families).length <= GLINER_LIMITS.labels, 'Too many entity labels for one GLiNER prompt');
    for (const [id, def] of Object.entries(schema.families)) {
        const label = String(def.label || id).trim();
        invariant(label && !byLabel.has(label), 'Span extraction needs a unique label for each occurrence family');
        byLabel.set(label, id);
        labels.push(label);
    }
    return { labels, byLabel };
}
/** Family labels, then attribute labels in the alphabetical order GLiNER2 inserts into the entity prompt. */
export function schemaPrompt(schema) {
    const { labels, byLabel } = schemaEntityLabels(schema);
    const enums = new Map();
    for (const def of Object.values(schema.families))
        for (const [field, spec] of Object.entries(def.fields)) {
            if (spec.type !== 'enum')
                continue;
            const previous = enums.get(field);
            invariant(!previous || previous.join('\u0000') === spec.values.join('\u0000'), 'The same enum field must have the same values on every family');
            enums.set(field, spec.values);
        }
    const rows = [...enums.entries()].flatMap(([field, values]) => values.map(value => ({ field, value, label: `${field}: ${value}` })));
    rows.sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
    for (const row of rows)
        invariant(!byLabel.has(row.label), 'Attribute label collides with an occurrence family');
    const prompt = [...labels, ...rows.map(row => row.label)];
    invariant(prompt.length <= GLINER_LIMITS.labels && new Set(prompt).size === prompt.length, 'Structured prompt exceeds the label budget');
    const at = new Map(rows.map((row, index) => [row.label, index]));
    const groups = [...enums.keys()].map(field => ({ field, choices: enums.get(field).map(value => ({ value, index: at.get(`${field}: ${value}`) })) }));
    return { labels: prompt, contentCount: labels.length, groups, byLabel };
}
export function softmaxChoice(logits) {
    invariant(logits.length > 0 && logits.every(value => Number.isFinite(value)), 'Attribute logits required');
    const max = Math.max(...logits);
    const shifted = logits.map(value => Math.exp(value - max));
    const sum = shifted.reduce((total, value) => total + value, 0);
    let index = 0;
    for (let i = 1; i < shifted.length; i++)
        if (shifted[i] > shifted[index])
            index = i;
    return { index, score: shifted[index] / sum };
}
/** Single-label attribute groups. Logits are [1, attributes, spans], matching score_explicit_spans. */
export function attributeFields(logits, dims, spanIndex, groups) {
    const fields = {};
    for (const group of groups) {
        const values = group.choices.map(choice => Number(logits[index(dims, 0, choice.index, spanIndex)]));
        const best = softmaxChoice(values);
        fields[group.field] = group.choices[best.index].value;
    }
    return fields;
}
export function prepareWindow(tokenizer, labels, words) {
    const schema = ['(', '[P]', 'entities', '('];
    const markers = [];
    for (const label of labels) {
        markers.push(schema.length);
        schema.push('[E]', label);
    }
    schema.push(')', ')');
    const combined = [...schema, '[SEP_TEXT]', ...words.map(word => word.text)];
    const ids = [], queryPositions = [], wordFirst = [];
    let separated = false, last = -1;
    const markerSet = new Set(markers);
    for (let i = 0; i < combined.length; i++) {
        const at = ids.length, pieces = tokenizer.encodeIds(combined[i]);
        if (combined[i] === '[SEP_TEXT]')
            separated = true;
        else if (!separated && markerSet.has(i))
            queryPositions.push(at);
        else if (separated && i !== last) {
            last = i;
            wordFirst.push(at);
        }
        ids.push(...pieces);
    }
    invariant(queryPositions.length === labels.length && wordFirst.length === words.length, 'GLiNER prompt alignment failed');
    return { inputIds: ids, queryPositions, wordFirst };
}
export function planWindows(tokenizer, labels, words) {
    const prefix = prepareWindow(tokenizer, labels, []).inputIds.length;
    invariant(prefix < GLINER_LIMITS.sequence, 'Schema prompt exceeds the 512-token encoder window', 'SCHEMA_WINDOW');
    const widths = words.map(word => tokenizer.encodeIds(word.text).length);
    const windows = [], uncovered = [];
    let start = 0;
    while (start < words.length) {
        let end = start, used = prefix;
        while (end < words.length && widths[end] > 0 && used + widths[end] <= GLINER_LIMITS.sequence) {
            used += widths[end];
            end++;
        }
        if (end === start) {
            uncovered.push(start);
            start++;
            continue;
        }
        windows.push([start, end]);
        if (end >= words.length)
            break;
        start = Math.max(start + 1, end - GLINER_LIMITS.wordOverlap);
    }
    return { windows, uncovered };
}
export function sigmoid(value) {
    if (value >= 0)
        return 1 / (1 + Math.exp(-value));
    const z = Math.exp(value);
    return z / (1 + z);
}
function index(dims, ...coords) { let offset = coords[0]; for (let i = 1; i < coords.length; i++)
    offset = offset * dims[i] + coords[i]; return offset; }
/** Threshold, abstain, and flat (maximum-total-score) overlap resolution. Indices are half-open word offsets. */
export function decodeBoundary({ pairLogits, pairDims, candidateIndices, indexDims, candidateValid, nullLogits, labels, threshold = GLINER_LIMITS.threshold, abstention = GLINER_LIMITS.abstention }) {
    const queries = labels.length, candidates = pairDims[2];
    const perLabel = labels.map(() => []);
    for (let q = 0; q < queries; q++) {
        if (sigmoid(Number(nullLogits[q])) > abstention)
            continue;
        for (let c = 0; c < candidates; c++) {
            if (!candidateValid[index(pairDims, 0, q, c)])
                continue;
            const score = sigmoid(Number(pairLogits[index(pairDims, 0, q, c)]));
            if (score < threshold)
                continue;
            const start = Number(candidateIndices[index(indexDims, 0, q, c, 0)]), end = Number(candidateIndices[index(indexDims, 0, q, c, 1)]);
            if (Number.isInteger(start) && Number.isInteger(end) && end > start)
                perLabel[q].push({ label: labels[q], start, end, score });
        }
    }
    return resolveFlat(perLabel.flat());
}
/** Exact occurrence multiset; scores have separate numerical conformance fixtures. */
export function compareSpanOccurrences(actual, expected, text) {
    const source = cps(text);
    const rows = spans => spans.map(span => {
        invariant(typeof span.label === 'string' && Number.isInteger(span.start) && Number.isInteger(span.end)
            && span.start >= 0 && span.end > span.start && span.end <= source.length,
        'Span fixtures require exact code-point start/end offsets; regenerate older packages');
        invariant(span.text === source.slice(span.start, span.end).join(''), 'Fixture span text does not match its source offsets');
        return { label: span.label, start: span.start, end: span.end, text: span.text };
    });
    const remaining = rows(actual), missing = [];
    for (const span of rows(expected)) {
        const at = remaining.findIndex(candidate => candidate.label === span.label && candidate.start === span.start
            && candidate.end === span.end && candidate.text === span.text);
        if (at < 0)
            missing.push(span);
        else
            remaining.splice(at, 1);
    }
    return { pass: missing.length === 0 && remaining.length === 0, missing, unexpected: remaining };
}
export function resolveFlat(items) {
    if (!items.length)
        return [];
    const ranked = items.map((item, index) => ({ item, index })).sort((a, b) => rank(a, b));
    const distinct = [];
    const seen = new Set();
    for (const row of ranked) {
        const key = `${row.item.start}:${row.item.end}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        distinct.push(row);
    }
    const byEnd = [...distinct].sort((a, b) => a.item.end - b.item.end || a.item.start - b.item.start || b.item.score - a.item.score || a.index - b.index);
    const ends = byEnd.map(row => row.item.end);
    const predecessors = byEnd.map((row, index) => bisectRight(ends, row.item.start, index) - 1);
    const best = [{ score: 0, pick: [] }];
    for (let i = 0; i < byEnd.length; i++) {
        const previous = best[predecessors[i] + 1];
        const withItem = { score: previous.score + byEnd[i].item.score, pick: [...previous.pick, i] };
        const without = best[i];
        best.push(compareSelections(withItem, without, byEnd) < 0 ? withItem : without);
    }
    return best.at(-1).pick.map(i => byEnd[i]).sort(rank).map(row => row.item);
}
function rank(a, b) { return b.item.score - a.item.score || a.item.start - b.item.start || a.item.end - b.item.end || a.index - b.index; }
function bisectRight(values, target, hi) { let lo = 0; while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= target)
        lo = mid + 1;
    else
        hi = mid;
} return lo; }
function selectionKey(pick, rows) { return pick.map(i => rows[i]).sort(rank).map(row => [-row.item.score, row.item.start, row.item.end, row.index]); }
function compareSelections(left, right, rows) {
    if (left.score !== right.score)
        return right.score - left.score;
    if (left.pick.length !== right.pick.length)
        return right.pick.length - left.pick.length;
    const a = selectionKey(left.pick, rows), b = selectionKey(right.pick, rows);
    for (let i = 0; i < a.length; i++)
        for (let j = 0; j < 4; j++)
            if (a[i][j] !== b[i][j])
                return a[i][j] - b[i][j];
    return 0;
}
export function locateSpans(text, words, localSpans, wordOffset) {
    return localSpans.map(span => {
        const startWord = span.start + wordOffset, endWord = span.end + wordOffset;
        invariant(startWord >= 0 && endWord <= words.length, 'Model span is outside the encoded words');
        const start = words[startWord].start, end = words[endWord - 1].end;
        return { ...span, label: span.label, start, end, text: cps(text).slice(start, end).join(''), score: span.score };
    });
}
export function documentCoverage(text, words, uncovered) {
    const length = cps(text).length;
    if (!uncovered.length)
        return { status: 'complete', coverage: [[0, length]] };
    const skip = new Set(uncovered), ranges = [];
    let current = null;
    for (let i = 0; i < words.length; i++) {
        if (skip.has(i)) {
            if (current)
                ranges.push(current);
            current = null;
            continue;
        }
        current = current ? [current[0], words[i].end] : [words[i].start, words[i].end];
    }
    if (current)
        ranges.push(current);
    return { status: 'partial', coverage: ranges };
}
export function spansToRecords(doc, schema, spans) {
    const map = new OffsetMap(doc.text), { byLabel } = schemaEntityLabels(schema);
    return spans.map(span => {
        const family = byLabel.get(span.label);
        invariant(family, 'Prediction label is not a schema family');
        const fields = { concept: map.slice(span.start, span.end) };
        const def = schema.families[family];
        for (const [name, value] of Object.entries(span.attributes ?? {})) {
            const field = def.fields[name];
            if (field?.type === 'enum' && field.values.includes(value))
                fields[name] = value;
        }
        return { id: uuid(), documentId: doc.id, family, anchor: [map.span(span.start, span.end)], fields, score: span.score, origin: { kind: 'model', codec: span.attributes ? GLINER_STRUCTURED : GLINER_CODEC } };
    });
}
