/** Run the application span codec against a local GLiNER2.5 ONNX directory. Exits absence skips. */
import { readFileSync } from 'node:fs';
import * as ort from '../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs';
import { GlinerTokenizer, readGlinerConfig, splitWords, prepareWindow, planWindows, decodeBoundary, locateSpans } from '../src/nextmedtator/gliner.mjs';
const root = process.argv[2];
if (!root) {
    console.log('skip: no model directory');
    process.exit(0);
}
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
const wasmDir = new URL('../node_modules/onnxruntime-web/dist/', import.meta.url);
ort.env.wasm.wasmPaths = wasmDir.href.endsWith('/') ? wasmDir.href : `${wasmDir.href}/`;
const tokenizer = GlinerTokenizer.fromJson(readFileSync(`${root}/tokenizer.json`, 'utf8'));
const special = readGlinerConfig(readFileSync(`${root}/gliner2_config.json`, 'utf8'));
for (const name of ['[E]', '[P]', '[SEP_TEXT]']) {
    if (tokenizer.idFor(name) !== special[name])
        throw new Error(`special token mismatch ${name}`);
}
const encoder = await ort.InferenceSession.create(readFileSync(`${root}/onnx/encoder.onnx`), { executionProviders: ['wasm'], graphOptimizationLevel: 'disabled' });
const boundary = await ort.InferenceSession.create(readFileSync(`${root}/onnx/boundary.onnx`), { executionProviders: ['wasm'], graphOptimizationLevel: 'disabled' });
const cases = [
    ['Her mother has diabetes. The patient denies diabetes.', ['condition', 'medication', 'procedure'], ['condition\tdiabetes']],
    ['John works at Google in Seattle.', ['person', 'organization', 'location'], ['person\tJohn', 'organization\tGoogle', 'location\tSeattle']]
];
for (const [text, labels, required] of cases) {
    const words = splitWords(text);
    const [from, to] = planWindows(tokenizer, labels, words).windows[0];
    const prepared = prepareWindow(tokenizer, labels, words.slice(from, to));
    const ids = BigInt64Array.from(prepared.inputIds, BigInt);
    const hidden = await encoder.run({ input_ids: new ort.Tensor('int64', ids, [1, ids.length]), attention_mask: new ort.Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]) });
    const states = hidden.hidden_states;
    const width = states.dims[2];
    const take = positions => { const out = new Float32Array(positions.length * width); positions.forEach((position, row) => out.set(states.data.subarray(position * width, (position + 1) * width), row * width)); return out; };
    const outputs = await boundary.run({
        token_states: new ort.Tensor('float32', take(prepared.wordFirst), [1, to - from, width]),
        text_mask: new ort.Tensor('bool', new Uint8Array(to - from).fill(1), [1, to - from]),
        query_states: new ort.Tensor('float32', take(prepared.queryPositions), [1, labels.length, width]),
        query_mask: new ort.Tensor('bool', new Uint8Array(labels.length).fill(1), [1, labels.length])
    });
    const absent = [...outputs.null_logits.data].slice(0, labels.length);
    const decoded = decodeBoundary({ pairLogits: outputs.pair_logits.data, pairDims: outputs.pair_logits.dims, candidateIndices: outputs.candidate_indices.data, indexDims: outputs.candidate_indices.dims, candidateValid: outputs.candidate_valid.data, nullLogits: absent, labels });
    const spans = locateSpans(text, words, decoded, from);
    const got = [...new Set(spans.map(span => `${span.label}\t${span.text}`))].sort();
    console.log(JSON.stringify({ text, got, scores: spans.map(span => [span.label, span.text, Number(span.score.toFixed(3))]) }));
    for (const item of required)
        if (!got.includes(item))
            throw new Error(`Missing ${item} in ${got.join(', ')}`);
}
await encoder.release();
await boundary.release();
console.log('gliner span codec matched the expected synthetic mentions');
