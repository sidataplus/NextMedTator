import { clone, freeze, invariant, fingerprint, uuid, now, OffsetMap } from './integrity.mjs';
import { VERSION, validateProject, validateSchema, validateRecords, validateRun, runIdentity } from './contracts.mjs';
export class ReviewProject {
    constructor(data) { this.data = freeze(clone(data)); }
    static async create(documents, schema, { mode = 'assisted', actor = 'annotator', id = uuid() } = {}) {
        validateSchema(schema);
        invariant(actor.trim().length > 0 && actor.length <= 100, 'Annotator identifier required');
        const data = { format: VERSION, id, createdAt: now(), schema: clone(schema), schemaHash: await fingerprint(schema), documents: clone(documents), mode, phase: 'annotation', actor, runs: [], snapshots: [], events: [], exposure: [], draft: { records: [], decisions: {}, completeness: {} }, extensions: {} };
        await validateProject(data);
        return new ReviewProject(data);
    }
    static async open(data) { await validateProject(data); return new ReviewProject(data); }
    get current() { return this.data; }
    get canSeeMachine() { return this.data.mode === 'assisted' || this.data.phase === 'revealed'; }
    #commit(action, details, update) { const next = clone(this.data); update(next); next.events.push({ id: uuid(), at: now(), actor: next.actor, action, details: clone(details) }); this.data = freeze(next); return this.data; }
    #editable() { invariant(this.data.phase !== 'frozen', 'Independent snapshot is frozen. Reveal/compare or start a new assignment.'); }
    async addRun(input) {
        invariant(this.data.mode !== 'blind' || this.data.phase !== 'annotation', 'Freeze independent human annotations before importing or running predictions', 'BLIND_LOCK');
        const run = clone(input);
        await validateRun(run, this.data);
        invariant(!this.data.runs.some(r => r.id === run.id), 'Duplicate run');
        this.#commit('run-imported', { runId: run.id, status: run.status }, p => { p.runs.push(run); if (p.mode === 'assisted')
            p.exposure.push({ at: now(), documentId: run.documentId, runId: run.id, kind: run.producer.kind }); });
    }
    record(input) { this.#editable(); const record = clone(input); validateRecords([record], this.data.documents, this.data.schema); const before = clone(this.data.draft); this.#commit('human-record', { before }, p => { p.draft.records = p.draft.records.filter(r => r.id !== record.id); p.draft.records.push({ ...record, origin: { kind: 'human', actor: p.actor, assistance: p.exposure.length > 0 } }); delete p.draft.completeness[record.documentId]; }); }
    review(runId, recordId, action, replacement = null, reason = '') {
        this.#editable();
        invariant(this.canSeeMachine, 'Machine suggestions remain hidden', 'BLIND_LOCK');
        invariant(['accepted', 'modified', 'rejected', 'deferred'].includes(action), 'Unknown review action');
        const run = this.data.runs.find(r => r.id === runId);
        const prediction = run?.records.find(r => r.id === recordId);
        invariant(prediction, 'Prediction not found');
        // Native relation review is preserved by imports; single-record actions must not create dangling links.
        invariant(!(prediction.relations?.length), 'Review linked records as a complete imported/adjudicated set');
        const key = `${runId}/${recordId}`;
        const before = clone(this.data.draft);
        let reviewed = null;
        if (['accepted', 'modified'].includes(action)) {
            reviewed = clone(replacement ?? prediction);
            reviewed.id = this.data.draft.decisions[key]?.humanId ?? uuid();
            reviewed.origin = { kind: 'human-review', actor: this.data.actor, runId, recordId, action };
            validateRecords([reviewed], this.data.documents, this.data.schema);
        }
        this.#commit('review', { before, runId, recordId, decision: action }, p => { const old = p.draft.decisions[key]?.humanId; p.draft.records = p.draft.records.filter(r => r.id !== old); if (reviewed)
            p.draft.records.push(reviewed); p.draft.decisions[key] = { status: action, humanId: reviewed?.id ?? null, reason: String(reason).slice(0, 10000) }; delete p.draft.completeness[prediction.documentId]; });
    }
    remove(id) { this.#editable(); invariant(this.data.draft.records.some(r => r.id === id), 'Record not found'); invariant(!this.data.draft.records.some(r => r.relations?.some(rel => rel.targetId === id)), 'Remove incoming relations before this record'); const before = clone(this.data.draft); this.#commit('human-delete', { before, id }, p => { const doc = p.draft.records.find(r => r.id === id).documentId; p.draft.records = p.draft.records.filter(r => r.id !== id); for (const key of Object.keys(p.draft.decisions))
        if (p.draft.decisions[key].humanId === id)
            delete p.draft.decisions[key]; delete p.draft.completeness[doc]; }); }
    completeness(documentId, { families, ranges, omissionsChecked, unresolved = false }) {
        this.#editable();
        const doc = this.data.documents.find(d => d.id === documentId);
        invariant(doc, 'Document not found');
        invariant(Array.isArray(families) && families.length > 0 && families.every(f => this.data.schema.families[f]), 'Invalid reviewed families');
        const n = new OffsetMap(doc.text).length;
        invariant(Array.isArray(ranges) && ranges.every(([a, b]) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= a && b <= n), 'Invalid reviewed ranges');
        const full = ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === n && Object.keys(this.data.schema.families).every(f => families.includes(f)) && omissionsChecked === true && !unresolved;
        const before = clone(this.data.draft);
        this.#commit('completeness', { before, documentId }, p => { p.draft.completeness[documentId] = { families: [...new Set(families)], ranges, omissionsChecked: omissionsChecked === true, unresolved: !!unresolved, full }; });
    }
    undo() { this.#editable(); const event = this.data.events.at(-1); invariant(event?.details?.before, 'There is no immediately reversible annotation action'); const before = clone(this.data.draft); this.#commit('undo', { before, undoes: event.id }, p => { p.draft = clone(event.details.before); }); }
    async snapshot({ kind = 'human', parents = [], rationale = '' } = {}) {
        invariant(this.data.phase !== 'frozen', 'Snapshot already frozen');
        invariant(['human', 'adjudicated'].includes(kind), 'Invalid snapshot kind');
        const snapshot = { id: uuid(), kind, createdAt: now(), actor: this.data.actor, schemaHash: this.data.schemaHash, sources: Object.fromEntries(this.data.documents.map(d => [d.id, d.textSha256])), records: clone(this.data.draft.records), completeness: clone(this.data.draft.completeness), independent: this.data.exposure.length === 0 && kind === 'human', exposure: clone(this.data.exposure), parents: clone(parents), rationale: String(rationale).slice(0, 10000) };
        snapshot.hash = await fingerprint(snapshot);
        this.#commit('snapshot-frozen', { snapshotId: snapshot.id, hash: snapshot.hash }, p => { p.snapshots.push(snapshot); if (p.mode === 'blind' && p.phase === 'annotation')
            p.phase = 'frozen'; });
        return freeze(snapshot);
    }
    reveal() { invariant(this.data.mode === 'blind' && this.data.phase === 'frozen', 'Freeze independent annotation before revealing'); invariant(this.data.runs.length > 0, 'Import or run a machine layer before revealing'); this.#commit('machine-revealed', {}, p => { p.phase = 'revealed'; for (const run of p.runs)
        p.exposure.push({ at: now(), documentId: run.documentId, runId: run.id, kind: run.producer.kind }); }); }
    async importSnapshot(snapshot) { invariant(this.data.mode !== 'blind' || this.data.phase !== 'annotation', 'Freeze independent work before importing another layer'); const candidate = clone(this.data); invariant(!candidate.snapshots.some(s => s.id === snapshot.id), 'Snapshot already present'); candidate.snapshots.push(clone(snapshot)); await validateProject(candidate); this.#commit('snapshot-imported', { snapshotId: snapshot.id }, p => { p.snapshots.push(clone(snapshot)); }); }
    async adjudicate(leftId, rightId, records, { rationale, unresolved = [] } = {}) {
        this.#editable();
        const inputs = [leftId, rightId].map(id => this.data.snapshots.find(s => s.id === id));
        invariant(inputs.every(Boolean) && leftId !== rightId, 'Two distinct snapshots required');
        invariant(typeof rationale === 'string' && rationale.trim().length > 0, 'Adjudication rationale required');
        validateRecords(records, this.data.documents, this.data.schema);
        const before = clone(this.data.draft);
        this.#commit('adjudication-draft', { before, inputIds: [leftId, rightId], unresolved }, p => { p.draft = { records: clone(records), decisions: {}, completeness: {} }; p.exposure.push({ at: now(), kind: 'adjudication', snapshotIds: [leftId, rightId] }); });
        return this.snapshot({ kind: 'adjudicated', parents: inputs.map(s => s.hash), rationale });
    }
    async blindAssignment(actor) {
        const assignment = await ReviewProject.create(this.data.documents, this.data.schema, { mode: 'blind', actor });
        assignment.#commit('assignment-created', { parentProject: this.data.id }, p => { p.extensions.assignment = { parentProject: this.data.id, schemaHash: this.data.schemaHash, priorExposureMustBeDeclared: true }; });
        return assignment;
    }
    trainingCandidates(snapshotId) {
        const snapshot = this.data.snapshots.find(s => s.id === snapshotId);
        invariant(snapshot, 'Snapshot not found');
        return this.data.documents.filter(doc => doc.split === 'train' && snapshot.completeness[doc.id]?.full).map(doc => ({ documentId: doc.id, text: doc.text, sourceHash: doc.textSha256, schemaHash: this.data.schemaHash, split: doc.split, groupId: doc.groupId, records: snapshot.records.filter(r => r.documentId === doc.id), completeness: snapshot.completeness[doc.id], exposure: snapshot.exposure, referenceStatus: snapshot.kind, snapshotHash: snapshot.hash }));
    }
}
export async function makeRun(project, doc, records, { producer, status = 'complete', coverage, settings = {}, runtime = { backend: 'recorded', precision: 'not-applicable', version: '1' } }) {
    const run = { id: uuid(), createdAt: now(), documentId: doc.id, sourceHash: doc.textSha256, schemaHash: project.current.schemaHash, producer: clone(producer), runtime: clone(runtime), settings: clone(settings), status, coverage: coverage ?? [[0, new OffsetMap(doc.text).length]], records: clone(records) };
    run.fingerprint = await fingerprint(runIdentity(run));
    return run;
}
/** Materialize an explicit, same-configuration machine layer for human/machine comparison. */
export async function machineSnapshot(project, runIds) {
    invariant(Array.isArray(runIds) && runIds.length > 0, 'Select machine runs explicitly');
    const p = project.current ?? project, runs = runIds.map(id => p.runs.find(r => r.id === id));
    invariant(runs.every(Boolean), 'Unknown machine run');
    invariant(new Set(runs.map(r => r.documentId)).size === runs.length, 'Choose only one run per document');
    const config = r => fingerprint({ producer: r.producer, runtime: r.runtime, settings: r.settings });
    const identities = await Promise.all(runs.map(config));
    invariant(new Set(identities).size === 1, 'Machine comparison layer mixes model/runtime/settings');
    const snap = { id: uuid(), kind: 'machine', createdAt: now(), actor: runs[0].producer.name ?? 'machine', schemaHash: p.schemaHash, sources: Object.fromEntries(p.documents.map(d => [d.id, d.textSha256])), records: runs.flatMap(r => clone(r.records)), completeness: Object.fromEntries(runs.map(r => [r.documentId, { full: r.status === 'complete', coverage: r.coverage, status: r.status }])), independent: false, exposure: [], parents: [], rationale: 'Explicit machine comparison layer, not a human reference', runIds: [...runIds] };
    snap.hash = await fingerprint(snap);
    return freeze(snap);
}
