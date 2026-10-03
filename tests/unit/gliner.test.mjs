import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { GlinerTokenizer, splitWords, resolveFlat, decodeBoundary, compareSpanOccurrences, schemaEntityLabels, schemaPrompt, softmaxChoice, attributeFields, spansToRecords, prepareWindow, planWindows, documentCoverage } from '../../src/nextmedtator/gliner.mjs';
import { qualifyForSchema, validateModelManifest } from '../../src/nextmedtator/model-package.mjs';
import { DEMO_SCHEMA } from '../../src/nextmedtator/contracts.mjs';
import { sha256, sourceDocument } from '../../src/nextmedtator/integrity.mjs';
import { demoProject, authoredSuggestionRun } from '../../src/nextmedtator/samples.mjs';
const enc = new TextEncoder();
test('unigram viterbi matches the tokenizers crate example', () => {
    const vocab = [['<unk>', 0], ['a', 0], ['b', 0], ['c', 0], ['d', 0], ['cd', 1], ['ab', 2], ['abc', 5], ['abcd', 10]];
    const model = new GlinerTokenizer(vocab, 0, new Map());
    assert.deepEqual(model.unigramPieces('abcdacdxx'), ['abcd', 'a', 'cd', 'xx']);
});
test('whitespace splitter keeps original code-point offsets', () => {
    const note = 'Her mother has diabetes. The patient denies diabetes.';
    assert.deepEqual(splitWords(note).map(word => [word.text, word.start, word.end]), [['her', 0, 3], ['mother', 4, 10], ['has', 11, 14], ['diabetes', 15, 23], ['.', 23, 24], ['the', 25, 28], ['patient', 29, 36], ['denies', 37, 43], ['diabetes', 44, 52], ['.', 52, 53]]);
    const mixed = 'ไทย 👩‍⚕️ café İstanbul type-2 a.b@ex.com https://ex.com/a';
    const words = splitWords(mixed);
    assert.deepEqual(words.map(word => word.text), ['ไทย', '👩', '\u200d', '⚕', '️', 'café', 'i̇stanbul', 'type-2', 'a.b@ex.com', 'https://ex.com/a']);
    assert.equal([...mixed].slice(words[6].start, words[6].end).join(''), 'İstanbul');
});
test('flat overlap keeps the higher total rather than only the longest span', () => {
    const kept = resolveFlat([{ start: 0, end: 5, score: 0.9 }, { start: 0, end: 2, score: 0.6 }, { start: 3, end: 5, score: 0.6 }]);
    assert.deepEqual(kept.map(span => [span.start, span.end]), [[0, 2], [3, 5]]);
});
test('boundary flat policy resolves identical and overlapping spans across families together', () => {
    const spans = decodeBoundary({
        pairLogits: [2, 1, 1, 1], pairDims: [1, 2, 2], candidateIndices: [0, 5, 0, 2, 0, 5, 3, 5],
        indexDims: [1, 2, 2, 2], candidateValid: [1, 1, 1, 1], nullLogits: [-10, -10],
        labels: ['condition', 'finding']
    });
    assert.deepEqual(spans.map(({ label, start, end }) => ({ label, start, end })), [
        { label: 'condition', start: 0, end: 2 }, { label: 'finding', start: 3, end: 5 }
    ]);
    const identical = decodeBoundary({
        pairLogits: [1, 2], pairDims: [1, 2, 1], candidateIndices: [0, 2, 0, 2],
        indexDims: [1, 2, 1, 2], candidateValid: [1, 1], nullLogits: [-10, -10], labels: ['condition', 'finding']
    });
    assert.equal(identical.length, 1);
    assert.equal(identical[0].label, 'finding');
});
test('occurrence conformance rejects extras, missing duplicates, and wrong locations', () => {
    const text = '👩 diabetes diabetes';
    const first = { label: 'condition', start: 2, end: 10, text: 'diabetes' };
    const second = { ...first, start: 11, end: 19 };
    const expected = [first, second];
    assert.equal(compareSpanOccurrences([second, first], expected, text).pass, true);
    assert.deepEqual(compareSpanOccurrences([first], expected, text).missing, [second]);
    assert.equal(compareSpanOccurrences([first, first], expected, text).pass, false);
    assert.deepEqual(compareSpanOccurrences([first, second, first], expected, text).unexpected, [first]);
    assert.equal(compareSpanOccurrences([second], [first], text).pass, false);
    assert.equal(compareSpanOccurrences([], [], text).pass, true);
    assert.throws(() => compareSpanOccurrences([first], [{ label: 'condition', text: 'diabetes' }], text), /exact code-point/);
    assert.throws(() => compareSpanOccurrences([{ ...first, start: 3 }], [first], text), /does not match/);
});
test('conformance package still cannot qualify and a span package can', async () => {
    const graph = new Uint8Array([1]), boundary = new Uint8Array([2]), tokenizer = enc.encode('{}'), config = enc.encode('{}'), fixture = enc.encode('{}');
    const files = await Promise.all([graph, boundary, tokenizer, config, fixture].map(async (bytes, i) => ({ path: ['encoder.onnx', 'boundary.onnx', 'tokenizer.json', 'gliner2_config.json', 'fixture.json'][i], bytes: bytes.length, sha256: await sha256(bytes), role: ['graph', 'graph', 'tokenizer', 'schema', 'fixture'][i] })));
    const manifest = { format: 'nextmedtator-model-v1', id: 'gliner-span', version: '0', runtime: 'onnxruntime-web', runtimeVersion: '1.23.2', lineage: { base: { model: 'fastino/gliner2.5-base-v1', revision: '72ac19b486cd4557424c8d61114e7530c243e9b0' } }, license: { id: 'Apache-2.0', notice: 'Test manifest, not redistributed weights' }, files, variants: [{ id: 'wasm', backend: 'wasm', precision: 'fp32', codec: 'gliner25-boundary-span-v1', graph: 'encoder.onnx', graphs: { encoder: 'encoder.onnx', boundary: 'boundary.onnx' }, tokenizer: 'tokenizer.json', modelConfig: 'gliner2_config.json', fixtures: ['fixture.json'], threshold: 0.5 }], capabilities: ['*'] };
    validateModelManifest(manifest);
    const qualification = qualifyForSchema({ manifest }, DEMO_SCHEMA);
    assert.equal(qualification.level, 'entity-span');
    assert.ok(qualification.unpredicted.includes('assertion'));
    manifest.capabilities = ['condition_occurrence'];
    assert.throws(() => qualifyForSchema({ manifest }, DEMO_SCHEMA), /Unsupported schema family/);
    const conformance = { manifest: { ...manifest, capabilities: [], variants: [{ id: 'cpu', backend: 'wasm', precision: 'fp32', codec: 'tensor-conformance-v1', graph: 'encoder.onnx', fixtures: ['fixture.json'] }], files: [files[0], files[4]] } };
    conformance.manifest.files = [files[0], files[4]];
    assert.throws(() => qualifyForSchema(conformance, DEMO_SCHEMA), e => e.code === 'CLINICAL_RUNTIME_UNQUALIFIED');
});
test('span records use source offsets and leave context fields empty', async () => {
    const doc = await sourceDocument('note', enc.encode('Her mother has diabetes.'));
    const [span] = spansToRecords(doc, DEMO_SCHEMA, [{ label: 'condition occurrence', start: 15, end: 23, score: 0.5 }]);
    assert.equal(span.anchor[0].text, 'diabetes');
    assert.equal(span.family, 'condition_occurrence');
    assert.deepEqual(span.fields, { concept: 'diabetes' });
    const prompt = schemaPrompt(DEMO_SCHEMA);
    assert.deepEqual(prompt.labels.slice(0, 5), schemaEntityLabels(DEMO_SCHEMA).labels);
    assert.equal(prompt.labels[5], 'assertion: conditional');
    assert.equal(prompt.groups[0].field, 'assertion');
    const choice = softmaxChoice([0, 2]);
    assert.equal(choice.index, 1);
    assert.ok(Math.abs(choice.score - Math.exp(2) / (1 + Math.exp(2))) < 1e-12);
    const fields = attributeFields(new Float32Array([0, 3]), [1, 2, 1], 0, [{ field: 'assertion', choices: [{ value: 'present', index: 0 }, { value: 'negated', index: 1 }] }]);
    assert.equal(fields.assertion, 'negated');
    const attributed = spansToRecords(doc, DEMO_SCHEMA, [{ label: 'condition occurrence', start: 15, end: 23, score: 0.5, attributes: { assertion: 'negated', experiencer: 'family', value: '38.2' } }])[0];
    assert.equal(attributed.fields.assertion, 'negated');
    assert.equal(attributed.fields.experiencer, 'family');
    assert.equal(attributed.fields.value, undefined);
    assert.equal(span.score, 0.5);
    const project = await demoProject();
    const authored = await authoredSuggestionRun(project, project.current.documents[0]);
    assert.equal(authored.producer.kind, 'author-demo');
    assert.equal(schemaEntityLabels(DEMO_SCHEMA).labels[0], 'condition occurrence');
    const tokenizer = new GlinerTokenizer([['▁(', 0], ['[P]', 0], ['▁entities', 0], ['[E]', 0], ['▁condition', 0], ['▁occurrence', 0], [')', 0], ['[SEP_TEXT]', 0], ['▁her', 0], ['<unk>', -1]], 8, new Map([['[P]', 3], ['[E]', 4], ['[SEP_TEXT]', 7]]));
    const words = splitWords('her');
    const prepared = prepareWindow(tokenizer, ['condition occurrence'], words);
    assert.equal(prepared.queryPositions.length, 1);
    assert.equal(prepared.wordFirst.length, 1);
    assert.deepEqual(planWindows(tokenizer, ['condition occurrence'], words).windows, [[0, 1]]);
    assert.equal(documentCoverage('her', words, []).status, 'complete');
});
test('real GLiNER tokenizer matches Hugging Face token ids when the file is present', { skip: !process.env.GLINER_TOKENIZER }, () => {
    const path = process.env.GLINER_TOKENIZER;
    if (!path)
        return;
    const samples = ['(', ')', '[E]', '[SEP_TEXT]', 'entities', 'diabetes', 'condition occurrence', 'Her', 'patient\'s', '10mg', 'nonexistentxyzabc', 'ไทย'];
    const model = GlinerTokenizer.fromJson(readFileSync(path, 'utf8'));
    const probe = spawnSync('python3', ['-c', `from tokenizers import Tokenizer\nimport json,sys\ntok=Tokenizer.from_file(sys.argv[1])\nsamples=json.loads(sys.argv[2])\nprint(json.dumps([tok.encode(s, add_special_tokens=False).ids for s in samples]))`, path, JSON.stringify(samples)], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    const expected = JSON.parse(probe.stdout);
    samples.forEach((text, i) => assert.deepEqual(model.encodeIds(text), expected[i], text));
});
