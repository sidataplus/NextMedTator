import { canonical, jsonParse, clone, sha256, invariant } from './integrity.mjs';
import { validateProject } from './contracts.mjs';
import { zipStore, unzipBounded } from './zip.mjs';
const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export async function exportBundle(project) {
    const state = clone(project.current ?? project);
    await validateProject(state);
    const files = new Map();
    files.set('schema.json', enc.encode(canonical(state.schema)));
    delete state.schema;
    for (const [i, doc] of state.documents.entries()) {
        doc.sourceFile = `documents/${String(i).padStart(6, '0')}.txt`;
        files.set(doc.sourceFile, enc.encode(doc.text));
        delete doc.text;
    }
    for (const [key, path] of [['runs', 'machine-runs/index.json'], ['snapshots', 'human-snapshots/index.json'], ['events', 'review-history/index.json']]) {
        files.set(path, enc.encode(canonical(state[key])));
        delete state[key];
    }
    files.set('project.json', enc.encode(canonical(state)));
    const manifest = { format: 'nextmedtator-bundle-v1', files: await Promise.all([...files].map(async ([path, bytes]) => ({ path, bytes: bytes.length, sha256: await sha256(bytes) }))) };
    files.set('manifest.json', enc.encode(canonical(manifest)));
    return zipStore(files);
}
export async function importBundle(bytes) {
    const files = await unzipBounded(bytes);
    invariant(files.has('manifest.json'), 'Bundle manifest missing');
    const manifest = jsonParse(dec.decode(files.get('manifest.json')));
    invariant(manifest.format === 'nextmedtator-bundle-v1' && Array.isArray(manifest.files), 'Unsupported bundle');
    const paths = new Set();
    for (const f of manifest.files) {
        invariant(typeof f.path === 'string' && f.path !== 'manifest.json' && !paths.has(f.path), 'Duplicate or invalid manifest member');
        paths.add(f.path);
        const data = files.get(f.path);
        invariant(data && data.length === f.bytes && await sha256(data) === f.sha256, 'Bundle member hash mismatch');
    }
    invariant(paths.size + 1 === files.size, 'Unexpected unmanifested bundle members');
    const read = path => { invariant(paths.has(path), 'Required member missing'); return jsonParse(dec.decode(files.get(path))); };
    const state = read('project.json');
    state.schema = read('schema.json');
    invariant(Array.isArray(state.documents), 'Missing source inventory');
    for (const doc of state.documents) {
        invariant(paths.has(doc.sourceFile) && doc.sourceFile.startsWith('documents/'), 'Invalid source reference');
        doc.text = dec.decode(files.get(doc.sourceFile));
        delete doc.sourceFile;
    }
    state.runs = read('machine-runs/index.json');
    state.snapshots = read('human-snapshots/index.json');
    state.events = read('review-history/index.json');
    await validateProject(state);
    return state;
}
export function localDownload(bytes, name, type = 'application/zip') {
    const blob = new Blob([bytes], { type }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    // A download request is not a verified durable backup.
}
