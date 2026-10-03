import { validateModelManifest, compareTensors, CODECS } from './model-package.mjs';
import { invariant, jsonParse, sha256 } from './integrity.mjs';
import { GLINER_CODEC, GLINER_LIMITS, SPAN_NOTICE, GlinerTokenizer, readGlinerConfig, prepareWindow, planWindows, decodeBoundary, locateSpans, documentCoverage, resolveFlat, splitWords } from './gliner.mjs';
// ORT and its WASM files are copied locally by the build. No fallback URL or API.
self.onmessage = async ({ data }) => {
    const sessions = [];
    try {
        const manifest = validateModelManifest(data.manifest), files = new Map(data.files), variant = manifest.variants.find(v => v.id === data.variantId);
        invariant(variant, 'Unknown model variant');
        for (const file of manifest.files) {
            const bytes = files.get(file.path);
            invariant(bytes?.length === file.bytes && await sha256(bytes) === file.sha256, 'Worker model-integrity failure');
        }
        const ort = await import('../../vendor/ort/ort.webgpu.min.mjs');
        invariant(ort.env.versions.web === manifest.runtimeVersion, 'Package/runtime version mismatch');
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;
        ort.env.wasm.wasmPaths = new URL('../../vendor/ort/', import.meta.url).href;
        if (variant.backend === 'webgpu') {
            invariant(!!navigator.gpu, 'WebGPU unavailable');
            invariant(!!await navigator.gpu.requestAdapter(), 'No usable GPU adapter');
        }
        const codec = CODECS[variant.codec];
        const result = codec.coverage === 'entity-span'
            ? await runBoundary(ort, files, manifest, variant, data, sessions)
            : await runFixtures(ort, files, manifest, variant, data, sessions);
        self.postMessage({ result });
    }
    catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : 'Local model worker failed' });
    }
    finally {
        for (const session of sessions)
            await session.release();
    }
};
async function openSession(ort, files, variant, graph, sessions) {
    const session = await ort.InferenceSession.create(files.get(graph), { executionProviders: [variant.backend], externalData: (variant.externalData ?? []).map(f => ({ path: f.name, data: files.get(f.path) })), logSeverityLevel: 4 });
    sessions.push(session);
    return session;
}
async function runFixtures(ort, files, manifest, variant, data, sessions) {
    const session = await openSession(ort, files, variant, variant.graph, sessions);
    const results = [];
    for (const path of variant.fixtures) {
        const fixture = jsonParse(new TextDecoder().decode(files.get(path)));
        const feeds = {};
        for (const [name, t] of Object.entries(fixture.inputs)) {
            invariant(['float32', 'int32', 'int64', 'bool'].includes(t.type), 'Unsupported fixture tensor type');
            const values = t.type === 'int64' ? BigInt64Array.from(t.data, BigInt) : t.type === 'int32' ? Int32Array.from(t.data) : t.type === 'bool' ? Uint8Array.from(t.data) : Float32Array.from(t.data);
            feeds[name] = new ort.Tensor(t.type, values, t.dims);
        }
        const start = performance.now();
        const outputs = await session.run(feeds);
        const checks = {};
        for (const [name, expected] of Object.entries(fixture.outputs)) {
            const actual = outputs[name];
            invariant(actual, 'Missing expected graph output');
            invariant(JSON.stringify(actual.dims) === JSON.stringify(expected.dims), 'Output shape mismatch');
            checks[name] = compareTensors(actual.data, expected.data, expected.tolerance ?? {});
        }
        results.push({ fixture: path, durationMs: performance.now() - start, checks, pass: Object.values(checks).every(x => x.pass) });
    }
    return { kind: 'graph-conformance-not-clinical-validation', manifestHash: data.manifestHash, variantId: variant.id, backend: variant.backend, precision: variant.precision, runtime: ort.env.versions, results, pass: results.every(r => r.pass) };
}
async function runBoundary(ort, files, manifest, variant, data, sessions) {
    invariant(variant.codec === GLINER_CODEC, 'Unsupported span codec');
    const tokenizer = GlinerTokenizer.fromJson(new TextDecoder('utf-8', { fatal: true }).decode(files.get(variant.tokenizer)));
    const special = readGlinerConfig(new TextDecoder('utf-8', { fatal: true }).decode(files.get(variant.modelConfig)));
    for (const name of ['[E]', '[P]', '[SEP_TEXT]', '[SEP_STRUCT]'])
        invariant(tokenizer.idFor(name) === special[name], 'Tokenizer and GLiNER config special-token ids disagree');
    const encoder = await openSession(ort, files, variant, variant.graphs.encoder, sessions);
    const boundary = await openSession(ort, files, variant, variant.graphs.boundary, sessions);
    const threshold = data.threshold ?? variant.threshold ?? GLINER_LIMITS.threshold;
    if (data.task === 'analyze')
        return analyzeText(ort, encoder, boundary, tokenizer, data.text, data.labels, { threshold, manifest, variant, manifestHash: data.manifestHash });
    const results = [];
    for (const path of variant.fixtures) {
        const fixture = jsonParse(new TextDecoder().decode(files.get(path)));
        invariant(fixture.kind === GLINER_CODEC && typeof fixture.text === 'string' && Array.isArray(fixture.labels) && Array.isArray(fixture.expected), 'Span fixture must name text, labels and expected spans');
        const actual = await analyzeText(ort, encoder, boundary, tokenizer, fixture.text, fixture.labels, { threshold: fixture.threshold ?? threshold, manifest, variant, manifestHash: data.manifestHash });
        const got = new Set(actual.spans.map(span => `${span.label}\t${span.text}`));
        const missing = fixture.expected.filter(span => !got.has(`${span.label}\t${span.text}`));
        results.push({ fixture: path, pass: missing.length === 0 && actual.status === 'complete', missing, spans: actual.spans.map(span => ({ label: span.label, text: span.text, score: span.score })) });
    }
    return { kind: GLINER_CODEC, manifestHash: data.manifestHash, variantId: variant.id, backend: variant.backend, precision: variant.precision, runtime: ort.env.versions, notice: SPAN_NOTICE, results, pass: results.every(r => r.pass) };
}
async function analyzeText(ort, encoder, boundary, tokenizer, text, labels, { threshold, manifest, variant, manifestHash }) {
    invariant(typeof text === 'string' && Array.isArray(labels) && labels.length > 0 && labels.length <= GLINER_LIMITS.labels && labels.every(label => typeof label === 'string'), 'Analysis labels required');
    const words = splitWords(text);
    const plan = planWindows(tokenizer, labels, words);
    const spans = [];
    for (const [from, to] of plan.windows) {
        const slice = words.slice(from, to);
        const prepared = prepareWindow(tokenizer, labels, slice);
        const ids = BigInt64Array.from(prepared.inputIds, BigInt);
        const hidden = await encoder.run({ input_ids: new ort.Tensor('int64', ids, [1, ids.length]), attention_mask: new ort.Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]) });
        const states = hidden.hidden_states ?? hidden[Object.keys(hidden)[0]];
        invariant(states?.dims?.[2] === 768, 'Encoder hidden size is not the GLiNER2.5-base width');
        const queries = gather(states, prepared.queryPositions);
        const tokens = gather(states, prepared.wordFirst);
        const outputs = await boundary.run({
            token_states: new ort.Tensor('float32', tokens, [1, slice.length, 768]),
            text_mask: new ort.Tensor('bool', new Uint8Array(slice.length).fill(1), [1, slice.length]),
            query_states: new ort.Tensor('float32', queries, [1, labels.length, 768]),
            query_mask: new ort.Tensor('bool', new Uint8Array(labels.length).fill(1), [1, labels.length])
        });
        const pair = outputs.pair_logits, indices = outputs.candidate_indices, valid = outputs.candidate_valid, absent = outputs.null_logits;
        invariant(pair && indices && valid && absent, 'Boundary graph outputs do not match the GLiNER2.5 contract');
        const decoded = decodeBoundary({ pairLogits: pair.data, pairDims: pair.dims, candidateIndices: indices.data, indexDims: indices.dims, candidateValid: valid.data, nullLogits: absentRow(absent, labels.length), labels, threshold });
        spans.push(...locateSpans(text, words, decoded, from));
    }
    const merged = mergeSpans(spans);
    const coverage = documentCoverage(text, words, plan.uncovered);
    return { kind: GLINER_CODEC, manifestHash, variantId: variant.id, backend: variant.backend, precision: variant.precision, runtime: { web: manifest.runtimeVersion }, notice: SPAN_NOTICE, threshold, status: coverage.status, coverage: coverage.coverage, windows: plan.windows.length, spans: merged };
}
function absentRow(tensor, labels) {
    const row = [];
    const width = tensor.dims.at(-1);
    invariant(width === labels, 'Boundary abstention width does not match the label count');
    for (let q = 0; q < labels; q++)
        row.push(Number(tensor.data[q]));
    return row;
}
function gather(states, positions) {
    const width = states.dims[2], out = new Float32Array(positions.length * width), data = states.data;
    positions.forEach((position, row) => { invariant(position >= 0 && position < states.dims[1], 'Gather position is outside the encoder sequence'); out.set(data.subarray(position * width, (position + 1) * width), row * width); });
    return out;
}
function mergeSpans(spans) {
    const groups = new Map();
    for (const span of spans) {
        if (!groups.has(span.label))
            groups.set(span.label, []);
        groups.get(span.label).push(span);
    }
    return [...groups.values()].flatMap(group => resolveFlat(group));
}
