import { invariant, canonical, fingerprint, csvCell } from './integrity.mjs';
function unionLength(spans) { return spans.reduce((n, s) => n + s.end - s.start, 0); }
function intersection(a, b) { let total = 0, i = 0, j = 0; while (i < a.length && j < b.length) {
    total += Math.max(0, Math.min(a[i].end, b[j].end) - Math.max(a[i].start, b[j].start));
    if (a[i].end <= b[j].end)
        i++;
    else
        j++;
} return total; }
export function anchorIoU(a, b) { const both = intersection(a, b), total = unionLength(a) + unionLength(b) - both; return total ? both / total : (a.length === 0 && b.length === 0 ? 1 : 0); }
export function sameAnchor(a, b) { return a.length === b.length && a.every((span, i) => span.start === b[i].start && span.end === b[i].end); }
/** Deterministic maximum-cardinality matching, not greedy and not maximum-weight. */
export function matchRecords(reference, candidate, { mode = 'exact', iou = 0.5 } = {}) {
    invariant(['exact', 'overlap'].includes(mode) && iou > 0 && iou <= 1, 'Invalid matching policy');
    const left = [...reference].sort((a, b) => a.id.localeCompare(b.id, 'en'));
    const right = [...candidate].sort((a, b) => a.id.localeCompare(b.id, 'en'));
    const edges = left.map(a => right.map((b, j) => ({ j, score: anchorIoU(a.anchor, b.anchor), compatible: a.documentId === b.documentId && a.family === b.family && (mode === 'exact' ? sameAnchor(a.anchor, b.anchor) : anchorIoU(a.anchor, b.anchor) >= iou) })).filter(e => e.compatible).sort((a, b) => b.score - a.score || a.j - b.j).map(e => e.j));
    const assigned = new Map();
    function augment(i, seen) { for (const j of edges[i]) {
        if (seen.has(j))
            continue;
        seen.add(j);
        if (!assigned.has(j) || augment(assigned.get(j), seen)) {
            assigned.set(j, i);
            return true;
        }
    } return false; }
    for (let i = 0; i < left.length; i++)
        augment(i, new Set());
    const pairs = [...assigned].map(([j, i]) => ({ reference: left[i], candidate: right[j] })).sort((a, b) => a.reference.id.localeCompare(b.reference.id, 'en'));
    const matchedLeft = new Set(pairs.map(p => p.reference.id)), matchedRight = new Set(pairs.map(p => p.candidate.id));
    return { pairs, missing: left.filter(r => !matchedLeft.has(r.id)), extra: right.filter(r => !matchedRight.has(r.id)) };
}
export function counts(tp, fp, fn) { return { tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null, f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null }; }
export async function compareSnapshots(reference, candidate, { mode = 'exact', iou = 0.5, referenceDeclared = false, requireComplete = true } = {}) {
    invariant(reference.schemaHash === candidate.schemaHash, 'Cannot compare different schemas');
    invariant(canonical(reference.sources) === canonical(candidate.sources), 'Cannot compare different source revisions');
    const sourceIds = Object.keys(reference.sources).sort();
    const evaluated = sourceIds.filter(id => (!requireComplete || reference.completeness?.[id]?.full === true) && (candidate.kind !== 'machine' || candidate.completeness?.[id]?.full === true));
    const allowed = new Set(evaluated);
    const refs = reference.records.filter(r => allowed.has(r.documentId)), cands = candidate.records.filter(r => allowed.has(r.documentId));
    const matched = matchRecords(refs, cands, { mode, iou });
    const fields = {};
    let tuples = 0, completeRecords = 0;const completeIds=new Set();
    const disagreements = [];
    for (const { reference: a, candidate: b } of matched.pairs) {
        let tuple = true;
        let eligible = 0;
        for (const [key, value] of Object.entries(a.fields)) {
            if (value === null)
                continue;
            eligible++;
            const correct = canonical(value) === canonical(b.fields[key] ?? null);
            fields[key] ??= { correct: 0, evaluated: 0 };
            fields[key].evaluated++;
            fields[key].correct += Number(correct);
            if (!correct) {
                tuple = false;
                disagreements.push({ kind: 'field-mismatch', referenceId: a.id, candidateId: b.id, field: key, documentId: a.documentId });
            }
        }
        if (tuple) tuples++;
        const sameEvidence = canonical(a.evidence ?? []) === canonical(b.evidence ?? []);
        if (!sameEvidence) disagreements.push({kind:'evidence-mismatch',referenceId:a.id,candidateId:b.id,documentId:a.documentId});
        if (tuple && sameEvidence && sameAnchor(a.anchor,b.anchor))completeIds.add(a.id);

        if (!sameAnchor(a.anchor, b.anchor))
            disagreements.push({ kind: 'boundary-mismatch', referenceId: a.id, candidateId: b.id, documentId: a.documentId });
    }
    for (const r of matched.missing)
        disagreements.push({ kind: 'missing-record', referenceId: r.id, documentId: r.documentId });
    for (const r of matched.extra)
        disagreements.push({ kind: 'extra-record', candidateId: r.id, documentId: r.documentId });
    const mapped = new Map(matched.pairs.map(({reference,candidate})=>[reference.id,candidate.id]));
    const expectedEdges=refs.flatMap(r=>(r.relations??[]).map(rel=>({head:r.id,tail:rel.targetId,type:rel.type,documentId:r.documentId})));
    const actualEdges=cands.flatMap(r=>(r.relations??[]).map(rel=>({head:r.id,tail:rel.targetId,type:rel.type,documentId:r.documentId})));
    const remaining=[...actualEdges];let relationTP=0;
    const relationCovered=evaluated.length>0&&evaluated.every(id=>reference.completeness[id]?.relationsChecked===true && candidate.completeness[id]?.relationsChecked===true);
    if(relationCovered){
        for(const edge of expectedEdges){const at=remaining.findIndex(e=>e.head===mapped.get(edge.head)&&e.tail===mapped.get(edge.tail)&&e.type===edge.type);if(at>=0){relationTP++;remaining.splice(at,1);}else disagreements.push({kind:'wrong-linkage',documentId:edge.documentId,referenceId:edge.head,field:edge.type});}
        for(const edge of remaining)disagreements.push({kind:'extra-linkage',documentId:edge.documentId,candidateId:edge.head,field:edge.type});
    }
    for(const {reference:a,candidate:b} of matched.pairs)if(completeIds.has(a.id)){const expected=(a.relations??[]).map(r=>({type:r.type,targetId:mapped.get(r.targetId)??null})).map(canonical).sort(),actual=(b.relations??[]).map(r=>({type:r.type,targetId:r.targetId})).map(canonical).sort();if(!relationCovered||canonical(expected)===canonical(actual))completeRecords++;}
    const report = { format: 'nextmedtator-comparison-v1', referenceHash: reference.hash ?? await fingerprint(reference), candidateHash: candidate.hash ?? await fingerprint(candidate), schemaHash: reference.schemaHash, interpretation: referenceDeclared ? 'comparison-to-declared-reference' : 'disagreement-analysis-not-accuracy', matching: { algorithm: 'deterministic-maximum-cardinality-v1', mode, iou: mode === 'overlap' ? iou : null }, coverage: { evaluated, excluded: sourceIds.filter(id => !allowed.has(id)), policy: requireComplete ? 'complete-reference-documents' : 'explicit-partial-comparison' }, anchors: counts(matched.pairs.length, matched.extra.length, matched.missing.length), evaluatedFieldTuples: counts(tuples, cands.length - tuples, refs.length - tuples), fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { ...v, accuracy: v.evaluated ? v.correct / v.evaluated : null }])), disagreements, recordCompleteness: {...counts(completeRecords, cands.length-completeRecords, refs.length-completeRecords),definition:relationCovered?'exact-anchor+evaluated-fields+evidence+outgoing-relations':'exact-anchor+evaluated-fields+evidence; relation coverage not declared'}, relationMetrics: relationCovered ? counts(relationTP, actualEdges.length-relationTP, expectedEdges.length-relationTP) : {status:'not-applicable',reason:'Relation coverage must be declared for both inputs'}, support: {documents:evaluated.length,referenceRecords:refs.length,candidateRecords:cands.length,referenceRelations:expectedEdges.length,candidateRelations:actualEdges.length}, goldStandardClaim: false };
    return { ...report, hash: await fingerprint(report) };
}
export function comparisonCSV(report) { const rows = [['kind', 'documentId', 'referenceId', 'candidateId', 'field'], ...report.disagreements.map(d => [d.kind, d.documentId, d.referenceId, d.candidateId, d.field])]; return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
/** Kappa requires explicit fixed units, never an invented universe of all text spans. */
export function categoricalKappa(left, right, labels) {
    invariant(left.length === right.length && labels.length > 1 && new Set(labels).size === labels.length, 'Invalid fixed-unit comparison');
    invariant([...left, ...right].every(x => labels.includes(x)), 'Unknown categorical label');
    if (!left.length)
        return null;
    const n = left.length, observed = left.reduce((s, v, i) => s + Number(v === right[i]), 0) / n;
    const expected = labels.reduce((s, label) => s + left.filter(x => x === label).length * right.filter(x => x === label).length / (n * n), 0);
    return expected === 1 ? null : (observed - expected) / (1 - expected);
}
