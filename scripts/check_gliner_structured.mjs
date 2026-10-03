/** Compare the structured codec with the native span-attribute labels for one synthetic note. */
import { readFileSync } from 'node:fs';
import * as ort from '../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs';
import { GlinerTokenizer, readGlinerConfig, splitWords, schemaPrompt, prepareWindow, planWindows, decodeBoundary, locateSpans, GLINER_LIMITS, attributeFields } from '../src/nextmedtator/gliner.mjs';
import { DEMO_SCHEMA } from '../src/nextmedtator/contracts.mjs';
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
const prompt = schemaPrompt(DEMO_SCHEMA);
const text = 'Her mother has diabetes. The patient denies diabetes.';
const words = splitWords(text);
const [from, to] = planWindows(tokenizer, prompt.labels, words).windows[0];
const slice = words.slice(from, to);
const prepared = prepareWindow(tokenizer, prompt.labels, slice);
const encoder = await ort.InferenceSession.create(readFileSync(`${root}/onnx/encoder.onnx`), { executionProviders: ['wasm'], graphOptimizationLevel: 'disabled' });
const boundary = await ort.InferenceSession.create(readFileSync(`${root}/onnx/boundary.onnx`), { executionProviders: ['wasm'], graphOptimizationLevel: 'disabled' });
const explicit = await ort.InferenceSession.create(readFileSync(`${root}/onnx/explicit.onnx`), { executionProviders: ['wasm'], graphOptimizationLevel: 'disabled' });
const ids = BigInt64Array.from(prepared.inputIds, BigInt);
const hidden = await encoder.run({ input_ids: new ort.Tensor('int64', ids, [1, ids.length]), attention_mask: new ort.Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]) });
const states = hidden.hidden_states;
const width = states.dims[2];
const take = positions => { const out = new Float32Array(positions.length * width); positions.forEach((position, row) => out.set(states.data.subarray(position * width, (position + 1) * width), row * width)); return out; };
const queries = take(prepared.queryPositions);
const tokens = take(prepared.wordFirst);
const outputs = await boundary.run({
    token_states: new ort.Tensor('float32', tokens, [1, slice.length, width]),
    text_mask: new ort.Tensor('bool', new Uint8Array(slice.length).fill(1), [1, slice.length]),
    query_states: new ort.Tensor('float32', queries, [1, prompt.labels.length, width]),
    query_mask: new ort.Tensor('bool', new Uint8Array(prompt.labels.length).fill(1), [1, prompt.labels.length])
});
const content = prompt.contentCount;
const pair = outputs.pair_logits, indices = outputs.candidate_indices;
const decoded = decodeBoundary({
    pairLogits: pair.data, pairDims: [pair.dims[0], content, pair.dims[2]],
    candidateIndices: indices.data, indexDims: [indices.dims[0], content, indices.dims[2], indices.dims[3]],
    candidateValid: outputs.candidate_valid.data, nullLogits: [...outputs.null_logits.data].slice(0, content),
    labels: prompt.labels.slice(0, content)
});
const attributes = prompt.labels.length - content;
const padded = new Float32Array(GLINER_LIMITS.explicitWords * width);
padded.set(tokens);
const mask = new Uint8Array(GLINER_LIMITS.explicitWords);
mask.fill(1, 0, slice.length);
const explicitIndex = new BigInt64Array(attributes * decoded.length * 2);
decoded.forEach((span, column) => { for (let row = 0; row < attributes; row++) { const at = (row * decoded.length + column) * 2; explicitIndex[at] = BigInt(span.start); explicitIndex[at + 1] = BigInt(span.end); } });
const scored = await explicit.run({
    token_states: new ort.Tensor('float32', padded, [1, GLINER_LIMITS.explicitWords, width]),
    text_mask: new ort.Tensor('bool', mask, [1, GLINER_LIMITS.explicitWords]),
    query_states: new ort.Tensor('float32', queries.slice(content * width), [1, attributes, width]),
    query_mask: new ort.Tensor('bool', new Uint8Array(attributes).fill(1), [1, attributes]),
    indices: new ort.Tensor('int64', explicitIndex, [1, attributes, decoded.length, 2])
});
decoded.forEach((span, column) => { span.attributes = attributeFields(scored.logits.data, scored.logits.dims, column, prompt.groups); });
const spans = locateSpans(text, words, decoded, from).filter(span => span.label === 'condition occurrence');
const got = spans.map(span => ({ text: span.text, start: span.start, assertion: span.attributes.assertion, temporality: span.attributes.temporality, experiencer: span.attributes.experiencer }));
console.log(JSON.stringify(got, null, 2));
const expected = [
    { text: 'diabetes', start: 15, assertion: 'negated', temporality: 'unknown', experiencer: 'patient' },
    { text: 'diabetes', start: 44, assertion: 'negated', temporality: 'unknown', experiencer: 'patient' }
];
if (JSON.stringify(got) !== JSON.stringify(expected))
    throw new Error(`Attribute choices diverged from the native GLiNER2.5 head: ${JSON.stringify(got)}`);
await encoder.release();
await boundary.release();
await explicit.release();
console.log('structured attribute head matched the native enum choices');
