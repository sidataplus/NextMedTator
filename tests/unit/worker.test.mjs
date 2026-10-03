import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConformanceWorker } from '../../src/nextmedtator/model-package.mjs';

const packageData = { manifest: { variants: [{ id: 'wasm' }] }, manifestHash: 'fixture', files: new Map([['graph', new Uint8Array([1])]]) };
const requests = [{ text: 'first' }, { text: 'second' }];

function fakeWorker(t, respond = message => message.task === 'load' ? { ready: true } : { text: message.text }) {
    const workers = [];
    class Worker {
        constructor() { this.messages = []; this.terminations = 0; workers.push(this); }
        postMessage(message) {
            this.messages.push(message);
            queueMicrotask(() => {
                const response = respond(message, this);
                if (response) this.onmessage?.({ data: response.error ? response : { result: response } });
            });
        }
        terminate() { this.terminations++; }
    }
    const original = globalThis.Worker;
    globalThis.Worker = Worker;
    t.after(() => { if (original === undefined) delete globalThis.Worker; else globalThis.Worker = original; });
    return workers;
}

// Node does not expose a browser Worker; restore the original after each case.
test('batch loads package once, reuses the worker, and publishes completed notes in order', async t => {
    const workers = fakeWorker(t);
    const runner = new ConformanceWorker();
    const seen = [];
    const results = await runner.analyzeBatch(packageData, 'wasm', requests, {
        onProgress: index => seen.push(`start ${index}`), onResult: (result, index) => seen.push(`${index}: ${result.text}`)
    });
    assert.deepEqual(results, [{ text: 'first' }, { text: 'second' }]);
    assert.deepEqual(seen, ['start 0', '0: first', 'start 1', '1: second']);
    assert.equal(workers.length, 1);
    assert.deepEqual(workers[0].messages.map(m => m.task), ['load', 'analyze', 'analyze']);
    assert.equal(workers[0].messages.filter(m => m.files).length, 1);
    assert.equal(workers[0].terminations, 1);
    assert.equal(runner.worker, null);
});
test('cancellation preserves finished notes, stops the batch, and allows retry', async t => {
    const workers = fakeWorker(t);
    const runner = new ConformanceWorker(), seen = [];
    await assert.rejects(runner.analyzeBatch(packageData, 'wasm', requests, {
        onResult: result => { seen.push(result.text); runner.cancel(); }
    }), /Cancelled/);
    assert.deepEqual(seen, ['first']);
    assert.equal(workers[0].messages.filter(m => m.task === 'analyze').length, 1);
    assert.equal(workers[0].terminations, 1);
    assert.deepEqual(await runner.analyze(packageData, 'wasm', requests[1]), { text: 'second' });
    assert.equal(workers.length, 2);
    assert.equal(workers[1].terminations, 1);
});
test('load errors, inference errors, timeout, and in-flight cancellation release the worker', async t => {
    for (const failure of ['load', 'analyze', 'timeout', 'cancel']) {
        await t.test(failure, async t => {
            let runner;
            const workers = fakeWorker(t, message => {
                if (message.task === failure) return { error: 'Fixture failure' };
                if (message.task === 'analyze' && failure === 'timeout') return null;
                if (message.task === 'analyze' && failure === 'cancel') { runner.cancel(); return null; }
                return { ready: true };
            });
            runner = new ConformanceWorker();
            await assert.rejects(runner.analyzeBatch(packageData, 'wasm', requests, { timeoutMs: 20 }), /failure|timed out|Cancelled/);
            assert.equal(workers[0].terminations, 1);
            assert.equal(runner.worker, null);
        });
    }
});
