import { invariant, validId, validHash, uniqueIds, fingerprint, sha256, freeze, clone, jsonParse } from './integrity.mjs';
import { safePath, unzipBounded } from './zip.mjs';
export const PACKAGE_FORMAT = 'nextmedtator-model-v1';
// The published fp32 GLiNER2.5-base encoder is about 702 MiB, above the earlier 512 MiB member cap and under 1 GiB.
export const MODEL_LIMITS = Object.freeze({ files: 128, file: 768 * 1024 * 1024, total: 1024 * 1024 * 1024, archive: 1024 * 1024 * 1024 });
// Every executable preprocessor/decoder is shipped with the application, not with a model.
export const CODECS = Object.freeze({
    'tensor-conformance-v1': { purpose: 'graph-conformance-only', clinicalInference: false, coverage: 'tensor-fixture' },
    'gliner25-boundary-span-v1': { purpose: 'gliner25-boundary-span-extraction', clinicalInference: true, coverage: 'entity-span' },
    'gliner25-boundary-structured-v1': { purpose: 'gliner25-boundary-span-and-attributes', clinicalInference: true, coverage: 'structured-span' }
});
export function validateModelManifest(m) {
    invariant(m.format === PACKAGE_FORMAT, 'Unsupported model-package format');
    validId(m.id);
    invariant(typeof m.version === 'string' && m.version.length < 100, 'Model version required');
    invariant(m.runtime === 'onnxruntime-web', 'Unsupported runtime');
    invariant(typeof m.runtimeVersion === 'string', 'Pinned runtime version required');
    invariant(m.lineage && m.lineage.base && typeof m.lineage.base.model === 'string', 'Base model lineage required');
    invariant(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(m.lineage.base.revision), 'Base revision must be an immutable commit/content hash');
    if (m.lineage.adapter) {
        validHash(m.lineage.adapter.sha256);
        invariant(m.lineage.adapter.baseRevision === m.lineage.base.revision, 'LoRA adapter base mismatch');
        invariant(m.lineage.merge === 'merged-export' || m.lineage.merge === 'equivalent-graph', 'LoRA package must specify exported adapter application');
        invariant(m.lineage.trainedHeads === 'unchanged' || /^[a-f0-9]{64}$/.test(m.lineage.trainedHeads), 'Declare separately trained heads');
    }
    invariant(m.license && typeof m.license.id === 'string' && typeof m.license.notice === 'string', 'Package license/notice required');
    invariant(Array.isArray(m.files) && m.files.length > 0 && m.files.length <= 128, 'Model file count limit');
    const paths = new Set();
    let total = 0;
    for (const f of m.files) {
        safePath(f.path);
        invariant(!paths.has(f.path), 'Duplicate model file');
        paths.add(f.path);
        validHash(f.sha256);
        invariant(Number.isSafeInteger(f.bytes) && f.bytes > 0 && f.bytes <= MODEL_LIMITS.file, 'Model file-size limit');
        total += f.bytes;
        invariant(total <= MODEL_LIMITS.total, 'Model package size limit');
        invariant(['graph', 'weights', 'tokenizer', 'schema', 'fixture'].includes(f.role), 'Executable model plugins are forbidden');
        invariant(!/\.(?:[cm]?js|wasm|html)$/i.test(f.path), 'Executable artifact is not a model package');
    }
    invariant(Array.isArray(m.variants) && m.variants.length > 0, 'Model variants required');
    uniqueIds(m.variants);
    for (const v of m.variants) {
        invariant(['wasm', 'webgpu'].includes(v.backend), 'Unsupported execution provider');
        invariant(typeof v.precision === 'string', 'Precision required');
        invariant(CODECS[v.codec], 'Unsupported tokenizer/decoder contract; needs an application release');
        invariant(m.files.some(f => f.path === v.graph && f.role === 'graph'), 'Variant graph missing');
        if (v.threshold != null)
            invariant(typeof v.threshold === 'number' && v.threshold >= 0 && v.threshold <= 1, 'Invalid span threshold');
        if (CODECS[v.codec].coverage === 'entity-span' || CODECS[v.codec].coverage === 'structured-span') {
            invariant(v.graphs?.encoder === v.graph && typeof v.graphs.boundary === 'string', 'Boundary package needs encoder and boundary graphs');
            invariant(m.files.some(f => f.path === v.graphs.boundary && f.role === 'graph'), 'Boundary graph missing');
            invariant(typeof v.tokenizer === 'string' && m.files.some(f => f.path === v.tokenizer && f.role === 'tokenizer'), 'GLiNER tokenizer missing');
            invariant(typeof v.modelConfig === 'string' && m.files.some(f => f.path === v.modelConfig && f.role === 'schema'), 'GLiNER config missing');
            if (CODECS[v.codec].coverage === 'structured-span') {
                invariant(typeof v.graphs.explicit === 'string' && m.files.some(f => f.path === v.graphs.explicit && f.role === 'graph'), 'Span-attribute graph missing');
            }
        }
        invariant(Array.isArray(v.fixtures) && v.fixtures.length > 0 && v.fixtures.every(p => m.files.some(f => f.path === p && f.role === 'fixture')), 'Reference fixtures required');
        for (const f of v.externalData ?? [])
            invariant(m.files.some(x => x.path === f.path && x.role === 'weights') && typeof f.name === 'string', 'External weight reference invalid');
    }
    invariant(Array.isArray(m.capabilities) && m.capabilities.every(c => typeof c === 'string'), 'Capabilities required');
    return m;
}
export async function importModelPackage(bytes) {
    const entries = await unzipBounded(bytes, MODEL_LIMITS), raw = entries.get('manifest.json');
    invariant(raw, 'Model manifest missing');
    const manifest = validateModelManifest(jsonParse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
    invariant(entries.size === manifest.files.length + 1, 'Unlisted model artifacts');
    for (const file of manifest.files) {
        const content = entries.get(file.path);
        invariant(content && content.length === file.bytes && await sha256(content) === file.sha256, 'Model artifact integrity mismatch');
    }
    return { manifest: freeze(clone(manifest)), manifestHash: await fingerprint(manifest), files: entries };
}
export function qualifyForSchema(packageData, schema) {
    validateModelManifest(packageData.manifest);
    const codecs = packageData.manifest.variants.map(v => CODECS[v.codec]).filter(c => c.clinicalInference);
    invariant(codecs.length, 'Package is graph-conformance only. A qualified Clinical-Evidence tokenizer, schema encoder, heads and decoder are not installed.', 'CLINICAL_RUNTIME_UNQUALIFIED');
    const open = packageData.manifest.capabilities.includes('*');
    if (!open)
        for (const family of Object.keys(schema.families))
            invariant(packageData.manifest.capabilities.includes(family), 'Unsupported schema family');
    const structured = codecs.some(c => c.coverage === 'structured-span');
    if (structured)
        return { level: 'structured-span', unpredicted: ['value', 'unit', 'relations'] };
    return { level: 'entity-span', unpredicted: ['assertion', 'temporality', 'experiencer', 'value', 'unit', 'relations'] };
}
export function compareTensors(actual, expected, { atol = 0, rtol = 0 } = {}) {
    invariant(Number.isFinite(atol) && Number.isFinite(rtol) && atol >= 0 && rtol >= 0, 'Invalid numerical tolerance');
    invariant(actual.length === expected.length, 'Tensor length mismatch');
    let mismatches = 0, maxAbsoluteError = 0;
    for (let i = 0; i < expected.length; i++) {
        const a = Number(actual[i]), b = Number(expected[i]);
        invariant(Number.isFinite(a) && Number.isFinite(b), 'Non-finite conformance tensor');
        const error = Math.abs(a - b);
        maxAbsoluteError = Math.max(error, maxAbsoluteError);
        if (error > atol + rtol * Math.abs(b))
            mismatches++;
    }
    return { pass: mismatches === 0, mismatches, elements: expected.length, maxAbsoluteError, atol, rtol };
}
/** Dedicated worker owns ORT sessions. Force stop disposes the worker, never human state. */
export class ConformanceWorker {
    constructor(url = new URL('./onnx-worker.mjs', import.meta.url)) { this.url = url; this.worker = null; this.pending = new Map(); }
    async run(packageData, variantId, options) { return this.#request(packageData, variantId, { task: 'fixtures' }, options); }
    async analyze(packageData, variantId, { text, labels, threshold, contentCount, groups }, options) { return this.#request(packageData, variantId, { task: 'analyze', text, labels, threshold, contentCount, groups }, { timeoutMs: 600000, ...options }); }
    #request(packageData, variantId, message, { timeoutMs = 120000 } = {}) {
        invariant(!this.worker, 'One model worker at a time');
        const variant = packageData.manifest.variants.find(v => v.id === variantId);
        invariant(variant, 'Variant not found');
        const worker = new Worker(this.url, { type: 'module' });
        this.worker = worker;
        return new Promise((resolve, reject) => { let finished = false; const finish = (error, result) => { if (finished)
            return; finished = true; clearTimeout(timer); worker.terminate(); this.worker = null; this.reject = null; error ? reject(error) : resolve(result); }; const timer = setTimeout(() => finish(new Error('Local model worker timed out and was stopped')), timeoutMs); this.reject = error => finish(error); worker.onerror = () => finish(new Error('Local ONNX worker failed. Check installed runtime assets.')); worker.onmessage = ({ data }) => { if (data.error)
            finish(new Error(data.error));
        else if (data.result)
            finish(null, data.result); }; worker.postMessage({ ...message, manifest: packageData.manifest, manifestHash: packageData.manifestHash, variantId, files: [...packageData.files] }); });
    }
    cancel() { this.reject?.(new Error('Cancelled: conformance worker stopped')); }
}
