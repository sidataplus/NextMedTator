import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelRunProvenance, validateModelManifest } from '../../src/nextmedtator/model-package.mjs';
import { makeRun, machineSnapshot } from '../../src/nextmedtator/project.mjs';
import { demoProject } from '../../src/nextmedtator/samples.mjs';
import { clone, fingerprint } from '../../src/nextmedtator/integrity.mjs';
import { exportBundle, importBundle } from '../../src/nextmedtator/bundle.mjs';

async function packageFixture(change = () => {}) {
    const manifest = {
        format: 'nextmedtator-model-v1', id: 'synthetic-model', version: '1',
        runtime: 'onnxruntime-web', runtimeVersion: '1.23.2',
        lineage: { base: { model: 'same-model-name', revision: 'a'.repeat(40) } },
        license: { id: 'Apache-2.0', notice: 'Synthetic metadata fixture; not clinical weights' },
        files: [{ path: 'graph.onnx', bytes: 1, sha256: 'b'.repeat(64), role: 'graph' },
            { path: 'reference.json', bytes: 1, sha256: 'c'.repeat(64), role: 'fixture' }],
        variants: [{ id: 'wasm', backend: 'wasm', precision: 'fp32', codec: 'tensor-conformance-v1', graph: 'graph.onnx', fixtures: ['reference.json'] }],
        capabilities: []
    };
    change(manifest);
    validateModelManifest(manifest);
    return { manifest, manifestHash: await fingerprint(manifest) };
}
function provenance(packageData, variantId = packageData.manifest.variants[0].id) {
    const variant = packageData.manifest.variants.find(v => v.id === variantId);
    return modelRunProvenance(packageData, variant.id, { manifestHash: packageData.manifestHash,
        variantId: variant.id, kind: variant.codec, backend: variant.backend, precision: variant.precision });
}
const changes = {
    'base revision': m => { m.lineage.base.revision = 'd'.repeat(40); },
    'LoRA adapter': m => { m.lineage.adapter = { sha256: 'e'.repeat(64), baseRevision: m.lineage.base.revision }; m.lineage.merge = 'merged-export'; m.lineage.trainedHeads = 'unchanged'; },
    'variant': m => { m.variants[0].id = 'other-wasm'; },
    'artifact': m => { m.files[0].sha256 = 'f'.repeat(64); }
};
for (const [name, change] of Object.entries(changes)) {
    test(`same model name/version cannot conceal a different ${name} in run fingerprints or comparisons`, async () => {
        const project = await demoProject(), [first, second] = project.current.documents;
        const original = provenance(await packageFixture()), different = provenance(await packageFixture(change));
        const base = await makeRun(project, first, [], original);
        const altered = await makeRun(project, first, [], different);
        assert.notEqual(base.fingerprint, altered.fingerprint);
        const other = await makeRun(project, second, [], different);
        await project.addRun(base); await project.addRun(other);
        await assert.rejects(machineSnapshot(project, [base.id, other.id]), /mixes model/);
        const compatible = await makeRun(project, second, [], original);
        await project.addRun(compatible);
        assert.equal((await machineSnapshot(project, [base.id, compatible.id])).runIds.length, 2);
    });
}
test('different variants in one package remain distinct even with the same backend and precision', async () => {
    const packageData = await packageFixture(m => {
        m.variants.push({ ...clone(m.variants[0]), id: 'alternate-wasm' });
    });
    const firstVariant = provenance(packageData), alternate = provenance(packageData, 'alternate-wasm');
    assert.deepEqual(firstVariant.producer, alternate.producer);
    assert.equal(firstVariant.runtime.backend, alternate.runtime.backend);
    assert.equal(firstVariant.runtime.precision, alternate.runtime.precision);
    const project = await demoProject(), [first, second] = project.current.documents;
    const base = await makeRun(project, first, [], firstVariant);
    assert.notEqual(base.fingerprint, (await makeRun(project, first, [], alternate)).fingerprint);
    const other = await makeRun(project, second, [], alternate);
    await project.addRun(base); await project.addRun(other);
    await assert.rejects(machineSnapshot(project, [base.id, other.id]), /mixes model/);
});
test('portable model runs retain package hashes, full adapter lineage, artifacts and variant declarations', async () => {
    const project = await demoProject(), packageData = await packageFixture(changes['LoRA adapter']);
    const identity = provenance(packageData);
    await project.addRun(await makeRun(project, project.current.documents[0], [], identity));
    const restored = await importBundle(await exportBundle(project));
    const [run] = restored.runs;
    assert.equal(run.producer.manifestHash, packageData.manifestHash);
    assert.equal(run.producer.packageId, packageData.manifest.id);
    assert.deepEqual(run.producer.lineage, packageData.manifest.lineage);
    assert.deepEqual(run.producer.artifacts, packageData.manifest.files);
    assert.equal(run.runtime.variantId, packageData.manifest.variants[0].id);
    assert.deepEqual(run.runtime.variant, packageData.manifest.variants[0]);
    const bad = clone(run); bad.producer.lineage.adapter.sha256 = '0'.repeat(64);
    await assert.rejects(project.addRun(bad), /fingerprint/);
});
test('worker results from a different package or variant cannot be attributed to the selected model', async () => {
    const packageData = await packageFixture(), variant = packageData.manifest.variants[0];
    const result = { manifestHash: packageData.manifestHash, variantId: variant.id, kind: variant.codec,
        backend: variant.backend, precision: variant.precision };
    for (const patch of [{ manifestHash: '0'.repeat(64) }, { variantId: 'other' }, { backend: 'webgpu' }, { precision: 'fp16' }])
        assert.throws(() => modelRunProvenance(packageData, variant.id, { ...result, ...patch }), /different|does not match/);
});
