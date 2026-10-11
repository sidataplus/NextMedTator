import { clone, freeze, invariant, fingerprint, uuid, now, OffsetMap, canonical, unionSpans } from './integrity.mjs';
import { VERSION, validateProject, validateSchema, validateRecords, validateRun, runIdentity } from './contracts.mjs';
function undoDelta(before, after) {
    const changes = [];
    const old = new Map(before.records.map((r, index) => [r.id, {r, index}]));
    const current = new Map(after.records.map(r => [r.id, r]));
    for (const id of new Set([...old.keys(), ...current.keys()])) {
        const a = old.get(id), b = current.get(id);
        if (canonical(a?.r ?? null) !== canonical(b ?? null)) changes.push({id, index: a?.index ?? -1, record: a?.r ?? null});
    }
    const maps = {};
    for (const key of ['decisions', 'completeness']) {
        maps[key] = Object.fromEntries([...new Set([...Object.keys(before[key]), ...Object.keys(after[key])])]
            .filter(id => canonical(before[key][id] ?? null) !== canonical(after[key][id] ?? null))
            .map(id => [id, before[key][id] ?? null]));
    }
    return {records: changes, ...maps};
}
function applyUndo(draft, delta) {
    const ids = new Set(delta.records.map(r => r.id));
    draft.records = draft.records.filter(r => !ids.has(r.id));
    for (const row of delta.records.filter(r => r.record).sort((a,b) => a.index-b.index)) draft.records.splice(row.index, 0, clone(row.record));
    for (const key of ['decisions', 'completeness']) for (const [id, value] of Object.entries(delta[key])) {
        if (value === null) delete draft[key][id]; else draft[key][id] = clone(value);
    }
}
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
    #commit(action, details, update) { const next = clone(this.data); update(next); details = clone(details); if (details.before) { details.undo = undoDelta(details.before, next.draft); delete details.before; } next.events.push({ id: uuid(), at: now(), actor: next.actor, action, details: clone(details) }); this.data = freeze(next); return this.data; }
    #editable() { invariant(this.data.phase !== 'frozen', 'Independent snapshot is frozen. Reveal/compare or start a new assignment.'); }
    async addRun(input) {
        invariant(this.data.mode !== 'blind' || this.data.phase !== 'annotation', 'Freeze independent human annotations before importing or running predictions', 'BLIND_LOCK');
        const run = clone(input);
        await validateRun(run, this.data);
        invariant(!this.data.runs.some(r => r.id === run.id), 'Duplicate run');
        this.#commit('run-imported', { runId: run.id, status: run.status }, p => { p.runs.push(run); if (p.mode === 'assisted')
            p.exposure.push({ at: now(), documentId: run.documentId, runId: run.id, kind: run.producer.kind }); });
    }
    record(input) { this.#editable(); const record = clone(input); validateRecords([...this.data.draft.records.filter(r => r.id !== record.id), record], this.data.documents, this.data.schema); const before = clone(this.data.draft); this.#commit('human-record', { before }, p => { p.draft.records = p.draft.records.filter(r => r.id !== record.id); p.draft.records.push({ ...record, origin: { kind: 'human', actor: p.actor, assistance: p.exposure.length > 0 } }); delete p.draft.completeness[record.documentId]; }); }
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
    completeness(documentId, { families, ranges, omissionsChecked, unresolved = false, relationsChecked = false }) {
        this.#editable();
        const doc = this.data.documents.find(d => d.id === documentId);
        invariant(doc, 'Document not found');
        invariant(Array.isArray(families) && families.length > 0 && families.every(f => this.data.schema.families[f]), 'Invalid reviewed families');
        const n = new OffsetMap(doc.text).length;
        invariant(Array.isArray(ranges) && ranges.every(([a, b]) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= a && b <= n), 'Invalid reviewed ranges');
        const full = ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === n && Object.keys(this.data.schema.families).every(f => families.includes(f)) && omissionsChecked === true && !unresolved;
        const before = clone(this.data.draft);
        this.#commit('completeness', { before, documentId }, p => { p.draft.completeness[documentId] = { families: [...new Set(families)], ranges, omissionsChecked: omissionsChecked === true, unresolved: !!unresolved, relationsChecked: !!relationsChecked, full }; });
    }
    undo() {
        this.#editable();
        const undone = new Set(this.data.events.filter(e => e.action === 'undo').map(e => e.details.undoes));
        const event = [...this.data.events].reverse().find(e => e.action !== 'undo' && !undone.has(e.id) && (e.details.undo || e.details.before));
        invariant(event, 'There is no reversible annotation action');
        this.#commit('undo', {undoes: event.id}, p => { if (event.details.undo) applyUndo(p.draft, event.details.undo); else p.draft = clone(event.details.before); });
    }
    expose(kind, snapshotIds = []) { this.#commit('assistance-exposed', {kind, snapshotIds}, p => p.exposure.push({at: now(), kind, snapshotIds: clone(snapshotIds)})); }
    setSuggestionScope(profile) { this.#commit('suggestion-scope-configured', {schemaHash:profile?.semanticSchema.schema_hash??null}, p => {if(profile)p.extensions.suggestionScope=clone(profile);else delete p.extensions.suggestionScope;}); }
    async addComparison(report) {
        const snapshots = this.data.snapshots;
        invariant(snapshots.some(s => s.hash === report.referenceHash) && snapshots.some(s => s.hash === report.candidateHash), 'Comparison input missing');
        const {hash, ...body} = report;
        invariant(await fingerprint(body) === hash, 'Comparison hash mismatch');
        this.#commit('comparison-created', {hash}, p => { p.extensions.comparisons ??= []; p.extensions.comparisons.push(clone(report)); p.exposure.push({at:now(), kind:'comparison', snapshotHashes:[report.referenceHash,report.candidateHash]}); });
    }
    transformRecords(ids, replacements, action = 'split-merge', reason = '') {
        this.#editable();
        invariant((ids.length > 0 || replacements.length > 0) && new Set(ids).size === ids.length && ids.every(id => this.data.draft.records.some(r => r.id === id)), 'Select existing records');
        const removed = new Set(ids);
        const records = [...this.data.draft.records.filter(r => !removed.has(r.id)), ...clone(replacements)];
        validateRecords(records, this.data.documents, this.data.schema);
        const before = clone(this.data.draft);
        this.#commit(action, {before, ids, reason}, p => { p.draft.records = records; for (const r of replacements) delete p.draft.completeness[r.documentId]; for (const id of ids) { const r=before.records.find(r=>r.id===id); delete p.draft.completeness[r.documentId]; } });
    }
    mergeRecords(firstId,secondId){
        this.#editable();
        const first=this.data.draft.records.find(r=>r.id===firstId),second=this.data.draft.records.find(r=>r.id===secondId);
        invariant(first&&second&&firstId!==secondId&&first.documentId===second.documentId&&first.family===second.family,'Merge two occurrences of the same document and family');
        const before=clone(this.data.draft),parents=new Set([firstId,secondId]),text=this.data.documents.find(d=>d.id===first.documentId).text;
        const merged={...clone(first),id:uuid(),anchor:unionSpans([...first.anchor,...second.anchor],text,{adjacent:true}),evidence:unionSpans([...(first.evidence??[]),...(second.evidence??[])],text),relations:[...clone(first.relations??[]),...clone(second.relations??[])],origin:{kind:'human-merge',actor:this.data.actor,parents:[firstId,secondId]}};
        const records=[...clone(this.data.draft.records.filter(r=>!parents.has(r.id))),merged];let removedSelfRelations=0;
        for(const record of records){const seen=new Set();record.relations=(record.relations??[]).flatMap(relation=>{
            const edge={...relation,targetId:parents.has(relation.targetId)?merged.id:relation.targetId};
            // An edge between the merged occurrences no longer connects two occurrences.
            if(record.id===merged.id&&edge.targetId===merged.id){removedSelfRelations++;return [];}
            const key=canonical(edge);if(seen.has(key))return [];seen.add(key);return [edge];
        });}
        validateRecords(records,this.data.documents,this.data.schema);
        this.#commit('merge',{before,ids:[firstId,secondId],mergedId:merged.id,removedSelfRelations,reason:'Retained first occurrence fields; combined evidence and external links; removed internal links. Reviewer must resolve field differences.'},p=>{
            p.draft.records=records;delete p.draft.completeness[first.documentId];
            for(const decision of Object.values(p.draft.decisions))if(parents.has(decision.humanId))decision.humanId=merged.id;
        });
        return merged.id;
    }
    copyAdjudicationGroup(snapshotId,recordId){
        this.#editable();const snapshot=this.data.snapshots.find(s=>s.id===snapshotId);invariant(snapshot?.records.some(r=>r.id===recordId),'Unknown adjudication candidate');const ids=new Set([recordId]);let changed=true;while(changed){changed=false;for(const r of snapshot.records)for(const rel of r.relations??[])if(ids.has(r.id)||ids.has(rel.targetId)){if(!ids.has(r.id)||!ids.has(rel.targetId))changed=true;ids.add(r.id);ids.add(rel.targetId);}}
        const selected=snapshot.records.filter(r=>ids.has(r.id)),mapping=new Map(selected.map(r=>[r.id,uuid()]));const copies=selected.map(r=>({...clone(r),id:mapping.get(r.id),relations:(r.relations??[]).map(rel=>({...rel,targetId:mapping.get(rel.targetId)})),origin:{kind:'human-adjudication',actor:this.data.actor,snapshotHash:snapshot.hash,sourceRecordId:r.id}}));this.expose('adjudication-candidate',[snapshotId]);this.transformRecords([],copies,'adjudication-candidates','Explicit selection of a linked candidate group');
    }
    reviewGroup(runId, recordIds, reason = '') {
        this.#editable(); invariant(this.canSeeMachine, 'Machine suggestions remain hidden');
        const run = this.data.runs.find(r => r.id === runId);
        invariant(run && recordIds.length && new Set(recordIds).size === recordIds.length, 'Select an explicit record set');
        const selected = recordIds.map(id => run.records.find(r=>r.id===id)); invariant(selected.every(Boolean), 'Unknown prediction');
        const mapping = new Map(selected.map(r=>[r.id, this.data.draft.decisions[`${runId}/${r.id}`]?.humanId ?? uuid()]));
        const copies = selected.map(r=>({...clone(r), id:mapping.get(r.id), relations:(r.relations??[]).map(rel=>({...rel,targetId:mapping.get(rel.targetId)??this.data.draft.decisions[`${runId}/${rel.targetId}`]?.humanId})), origin:{kind:'human-review',actor:this.data.actor,runId,recordId:r.id,action:'accepted'}}));
        const oldIds = new Set(copies.map(r=>r.id)), records=[...this.data.draft.records.filter(r=>!oldIds.has(r.id)), ...copies];
        validateRecords(records,this.data.documents,this.data.schema);
        const before=clone(this.data.draft);
        this.#commit('review-group',{before,runId,recordIds,reason},p=>{p.draft.records=records;for(const r of selected){p.draft.decisions[`${runId}/${r.id}`]={status:'accepted',humanId:mapping.get(r.id),reason};delete p.draft.completeness[r.documentId];}});
    }
    applyMachineGroup(runId, replacements) {
        this.#editable();
        invariant(this.canSeeMachine, 'Machine suggestions remain hidden', 'BLIND_LOCK');
        const run = this.data.runs.find(r => r.id === runId);
        invariant(run?.status === 'complete', 'Auto apply requires a complete run');
        invariant(replacements.length && new Set(replacements.map(r => r.id)).size === replacements.length, 'Select distinct predictions');
        const copies = replacements.map(replacement => {
            const prediction = run.records.find(r => r.id === replacement.id);
            invariant(prediction && !this.data.draft.decisions[`${runId}/${prediction.id}`], 'Prediction already decided or missing');
            invariant(replacement.documentId === prediction.documentId && replacement.family === prediction.family && canonical(replacement.anchor) === canonical(prediction.anchor), 'Auto apply must retain the source occurrence');
            invariant(!prediction.relations?.length && !replacement.relations?.length, 'Automatic relation application is not supported');
            return {...clone(replacement), id:uuid(), origin:{kind:'machine-applied',actor:this.data.actor,runId,recordId:prediction.id,reviewStatus:'unreviewed',...(typeof replacement.origin?.legacyTagId==='string'?{legacyTagId:replacement.origin.legacyTagId}:{})}};
        });
        const records = [...this.data.draft.records, ...copies];
        validateRecords(records, this.data.documents, this.data.schema);
        const before = clone(this.data.draft);
        this.#commit('machine-applied-group', {before,runId,recordIds:replacements.map(r=>r.id),reviewStatus:'unreviewed'}, p => {
            p.draft.records = records;
            for (const copy of copies) {
                p.draft.decisions[`${runId}/${copy.origin.recordId}`] = {status:'applied',humanId:copy.id,reviewStatus:'unreviewed'};
                delete p.draft.completeness[copy.documentId];
            }
            p.exposure.push({at:now(),kind:'auto-apply',runId});
        });
    }
    async snapshot({ kind = 'human', parents = [], rationale = '', unresolved = [], reasonCodes = {} } = {}) {
        invariant(this.data.phase !== 'frozen', 'Snapshot already frozen');
        invariant(['human', 'adjudicated'].includes(kind), 'Invalid snapshot kind');
        const snapshot = { id: uuid(), kind, createdAt: now(), actor: this.data.actor, schemaHash: this.data.schemaHash, sources: Object.fromEntries(this.data.documents.map(d => [d.id, d.textSha256])), records: clone(this.data.draft.records), completeness: clone(this.data.draft.completeness), independent: this.data.exposure.length === 0 && kind === 'human' && this.data.draft.records.every(r=>r.origin?.kind!=='imported'), exposure: clone(this.data.exposure), parents: clone(parents), unresolved: clone(unresolved), reasonCodes: clone(reasonCodes), rationale: String(rationale).slice(0, 10000) };
        snapshot.hash = await fingerprint(snapshot);
        this.#commit('snapshot-frozen', { snapshotId: snapshot.id, hash: snapshot.hash }, p => { p.snapshots.push(snapshot); if (p.mode === 'blind' && p.phase === 'annotation')
            p.phase = 'frozen'; });
        return freeze(snapshot);
    }
    reveal() { invariant(this.data.mode === 'blind' && this.data.phase === 'frozen', 'Freeze independent annotation before revealing'); invariant(this.data.runs.length > 0, 'Import or run a machine layer before revealing'); this.#commit('machine-revealed', {}, p => { p.phase = 'revealed'; for (const run of p.runs)
        p.exposure.push({ at: now(), documentId: run.documentId, runId: run.id, kind: run.producer.kind }); }); }
    async importSnapshot(snapshot) { invariant(this.data.mode !== 'blind' || this.data.phase !== 'annotation', 'Freeze independent work before importing another layer'); const candidate = clone(this.data); invariant(!candidate.snapshots.some(s => s.id === snapshot.id), 'Snapshot already present'); candidate.snapshots.push(clone(snapshot)); await validateProject(candidate); this.#commit('snapshot-imported', { snapshotId: snapshot.id }, p => { p.snapshots.push(clone(snapshot)); p.exposure.push({at:now(),kind:'snapshot-import',snapshotIds:[snapshot.id]}); }); }
    async adjudicate(leftId, rightId, records, { rationale, unresolved = [], reasonCodes = {} } = {}) {
        this.#editable();
        const inputs = [leftId, rightId].map(id => this.data.snapshots.find(s => s.id === id));
        invariant(inputs.every(Boolean) && leftId !== rightId, 'Two distinct snapshots required');
        invariant(typeof rationale === 'string' && rationale.trim().length > 0, 'Adjudication rationale required');
        validateRecords(records, this.data.documents, this.data.schema);
        const before = clone(this.data.draft);
        this.#commit('adjudication-draft', { before, inputIds: [leftId, rightId], unresolved }, p => { p.draft = { records: clone(records), decisions: {}, completeness: {} }; p.exposure.push({ at: now(), kind: 'adjudication', snapshotIds: [leftId, rightId] }); });
        return this.snapshot({ kind: 'adjudicated', parents: inputs.map(s => s.hash), rationale, unresolved, reasonCodes });
    }
    async blindAssignment(actor) {
        const assignment = await ReviewProject.create(this.data.documents, this.data.schema, { mode: 'blind', actor });
        assignment.#commit('assignment-created', { parentProject: this.data.id }, p => { p.extensions.assignment = { parentProject: this.data.id, schemaHash: this.data.schemaHash, priorExposureMustBeDeclared: true, orderedDocumentIds: p.documents.map(d=>d.id) }; });
        return assignment;
    }
    trainingCandidates(snapshotId) {
        const snapshot = this.data.snapshots.find(s => s.id === snapshotId);
        invariant(snapshot, 'Snapshot not found');
        return this.data.documents.filter(doc => doc.split === 'train' && snapshot.completeness[doc.id]?.full).map(doc => ({ documentId: doc.id, text: doc.text, sourceHash: doc.textSha256, schemaHash: this.data.schemaHash, split: doc.split, groupId: doc.groupId, records: snapshot.records.filter(r => r.documentId === doc.id), modelRuns: clone(this.data.runs.filter(r=>r.documentId===doc.id).map(r=>({id:r.id,fingerprint:r.fingerprint,producer:r.producer,runtime:r.runtime,settings:r.settings,status:r.status,coverage:r.coverage,windows:r.windows,timing:r.timing,failures:r.failures}))), unresolved: snapshot.unresolved ?? [], completeness: snapshot.completeness[doc.id], exposure: snapshot.exposure, referenceStatus: snapshot.kind, snapshotHash: snapshot.hash }));
    }
}
export async function makeRun(project, doc, records, { producer, status = 'complete', coverage, settings = {}, windows = [], timing = {}, failures = [], runtime = { backend: 'recorded', precision: 'not-applicable', version: '1' } }) {
    const run = { id: uuid(), createdAt: now(), documentId: doc.id, sourceHash: doc.textSha256, schemaHash: project.current.schemaHash, producer: clone(producer), runtime: clone(runtime), settings: clone(settings), windows: clone(windows), timing: clone(timing), failures: clone(failures), status, coverage: coverage ?? [[0, new OffsetMap(doc.text).length]], records: clone(records) };
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
