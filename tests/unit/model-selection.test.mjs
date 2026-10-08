import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
    MODEL_PRESETS, DEFAULT_MODEL_SELECTION, MODEL_SELECTION_STORAGE_KEY,
    createModelSelectionState, saveModelSelectionState, setModelSelection,
    modelSelectionKey, modelSelectionMatchesManifest, matchingInstalledModels,
    selectionFromManifest, selectionThresholdOverride, setSelectionThresholdOverride, restoreSelectionThresholdOverride,
    localAdapterSelection, adapterExportCommands
} from '../../src/nextmedtator/model-selection.mjs';
import {ModelStore} from '../../src/nextmedtator/model-store.mjs';

const smallBase = {model: 'fastino/gliner2.5-small-v1', revision: '7132dc4561c3f94563c6147e75ffa8ef34c4964a'};
const baseBase = {model: 'fastino/gliner2.5-base-v1', revision: 'ca906247640776a07753514055be9726f9080ead'};
const manifest = (base, adapter) => ({lineage: {base, ...(adapter ? {adapter} : {})}});

test('clinical small LoRA v3 is the default and source matching requires pinned lineage', () => {
    assert.equal(DEFAULT_MODEL_SELECTION.id, 'clinical-v3-small');
    assert.equal(DEFAULT_MODEL_SELECTION.repository, 'na399/clinical-evidence-gliner2.5-small-lora-v3-act-sol');
    assert.equal(DEFAULT_MODEL_SELECTION.revision, '82386c7a9776d3c14ed73d6310273a1c9d354d55');
    const small = manifest(smallBase, {repository: DEFAULT_MODEL_SELECTION.repository, revision: DEFAULT_MODEL_SELECTION.revision});
    const wrongBase = manifest(baseBase, {...small.lineage.adapter});
    assert.equal(modelSelectionMatchesManifest(DEFAULT_MODEL_SELECTION, small), true);
    assert.equal(modelSelectionMatchesManifest(DEFAULT_MODEL_SELECTION, wrongBase), false);
    assert.equal(modelSelectionMatchesManifest(DEFAULT_MODEL_SELECTION, manifest(smallBase, {...small.lineage.adapter, revision: 'f'.repeat(40)})), false);
});

test('original checkpoints and adapter sources match only their exact base or adapter lineage', () => {
    const originalSmall = MODEL_PRESETS.find(item => item.id === 'original-small');
    const originalBase = MODEL_PRESETS.find(item => item.id === 'original-base');
    assert.equal(originalSmall.revision, smallBase.revision);
    assert.equal(originalBase.revision, baseBase.revision);
    assert.equal(modelSelectionMatchesManifest(originalSmall, manifest(smallBase)), true);
    assert.equal(modelSelectionMatchesManifest(originalBase, manifest(baseBase)), true);
    assert.equal(modelSelectionMatchesManifest(originalSmall, manifest(smallBase, {sha256: 'a'.repeat(64)})), false);
    const installed = [
        {manifest: manifest(smallBase)},
        {manifest: manifest(baseBase)},
        {manifest: manifest(smallBase, {repository: DEFAULT_MODEL_SELECTION.repository, revision: DEFAULT_MODEL_SELECTION.revision})}
    ];
    assert.deepEqual(matchingInstalledModels(originalSmall, installed), [installed[0]]);
    const inferred = selectionFromManifest(installed[2].manifest);
    assert.equal(inferred.id, DEFAULT_MODEL_SELECTION.id);
    const customManifest = manifest(smallBase, {repository: 'owner/custom-adapter', revision: 'c'.repeat(40)});
    const custom = selectionFromManifest(customManifest);
    assert.equal(custom.baseModel, smallBase.model);
    assert.equal(custom.baseRevision, smallBase.revision);
    assert.equal(modelSelectionMatchesManifest(custom, customManifest), true);
    assert.equal(modelSelectionMatchesManifest(custom, manifest(baseBase, customManifest.lineage.adapter)), false);
});

test('imported packages preserve non-Hub base identities and 40- or 64-character lineage hashes', () => {
    for (const revision of ['d'.repeat(40), 'e'.repeat(64)]) {
        const source = manifest({model: 'synthetic-test-not-gliner', revision});
        const selection = selectionFromManifest(source);
        assert.equal(selection.kind, 'imported-package');
        assert.equal(modelSelectionMatchesManifest(selection, source), true);
        assert.equal(modelSelectionMatchesManifest(selection, manifest({model: 'different-synthetic-model', revision})), false);
        assert.throws(() => adapterExportCommands(selection), /do not need adapter export/);
    }
});

test('selection thresholds persist by exact source and startup restoration is read-only', () => {
    const writes = [];
    const storage = {
        getItem(key) { assert.equal(key, MODEL_SELECTION_STORAGE_KEY); return null; },
        setItem(key, value) { writes.push([key, value]); }
    };
    const state = createModelSelectionState(storage);
    assert.equal(state.selection.id, 'clinical-v3-small');
    assert.deepEqual(writes, []);
    assert.equal(selectionThresholdOverride(state), null);
    setSelectionThresholdOverride(state, 0.73);
    assert.equal(selectionThresholdOverride(state), 0.73);
    const smallKey = modelSelectionKey(state.selection);
    setModelSelection(state, MODEL_PRESETS.find(item => item.id === 'clinical-v3-base'));
    assert.equal(selectionThresholdOverride(state), null);
    setSelectionThresholdOverride(state, 0.62);
    setModelSelection(state, MODEL_PRESETS[0]);
    assert.equal(selectionThresholdOverride(state), 0.73);
    saveModelSelectionState(state, storage);
    assert.equal(writes.length, 1);
    assert.equal(JSON.parse(writes[0][1]).thresholds[smallKey], 0.73);
    assert.throws(() => setSelectionThresholdOverride(state, 1.1), /between 0 and 1/);
});

test('corpus threshold recovery is bound to the selected source', () => {
    const state = createModelSelectionState({getItem: () => null});
    const smallKey = modelSelectionKey(state.selection);
    setSelectionThresholdOverride(state, 0.73);
    setModelSelection(state, MODEL_PRESETS.find(item => item.id === 'original-base'));
    const baseKey = modelSelectionKey(state.selection);
    setSelectionThresholdOverride(state, 0.61);

    assert.equal(restoreSelectionThresholdOverride(state, smallKey, 0.48), 0.61);
    assert.equal(restoreSelectionThresholdOverride(state, undefined, 0.42), 0.61);
    assert.equal(restoreSelectionThresholdOverride(state, baseKey, 0.55), 0.55);
    setModelSelection(state, MODEL_PRESETS[0]);
    assert.equal(selectionThresholdOverride(state), 0.73);
});

test('local adapter identity matches exporter byte ordering and infers a full cached base path', async () => {
    const revision = 'd'.repeat(40);
    const configBytes = Buffer.from(JSON.stringify({
        peft_type: 'LORA', r: 8, target_modules: ['query_proj'],
        base_model_name_or_path: `/home/user/.cache/huggingface/hub/models--fastino--gliner2.5-small-v1/snapshots/${smallBase.revision}`
    }));
    const weightBytes = Buffer.from('synthetic adapter bytes');
    const file = (name, bytes) => ({name, webkitRelativePath: `adapter/${name}`, size: bytes.length,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)});
    const selection = await localAdapterSelection([
        file('adapter_model.safetensors', weightBytes), file('adapter_config.json', configBytes)
    ]);
    const identity = createHash('sha256').update('adapter_config.json\0').update(configBytes)
        .update('adapter_model.safetensors\0').update(weightBytes).digest('hex');
    assert.equal(selection.adapterSha256, identity);
    assert.equal(selection.baseModel, smallBase.model);
    assert.equal(selection.baseRevision, smallBase.revision);
    assert.match(revision, /^[a-f0-9]{40}$/);
    await assert.rejects(localAdapterSelection([], {baseModel: 'owner/base'}), /both the base model repository/);
    const unknownBaseConfig = Buffer.from(JSON.stringify({peft_type: 'LORA', r: 8, target_modules: ['query_proj'], base_model_name_or_path: 'owner/base'}));
    await assert.rejects(localAdapterSelection([
        file('adapter_config.json', unknownBaseConfig), file('adapter_model.safetensors', weightBytes)
    ]), /immutable 40-character revision/);
});

test('export commands use the ONNX exporter resolver option contract', () => {
    const selections = [
        ...MODEL_PRESETS,
        {kind: 'hub-adapter', repository: 'owner/custom-adapter', revision: 'a'.repeat(40), baseModel: smallBase.model, baseRevision: smallBase.revision},
        {kind: 'local-adapter', adapterSha256: 'b'.repeat(64), baseModel: smallBase.model, baseRevision: smallBase.revision}
    ];
    const value = (command, name) => command.match(new RegExp(`(?:^|\\s)${name} '([^']*)'`))?.[1];
    for (const source of selections) {
        const command = adapterExportCommands(source)[0];
        const isPreset = MODEL_PRESETS.some(preset => preset.id === source.id);
        const expectedId = isPreset ? source.exportSelection : source.kind === 'hub-adapter' ? 'huggingface-adapter' : 'local-adapter';
        assert.equal(value(command, '--selection'), expectedId);
        assert.equal(value(command, '--out'), 'work/selected-model.nmt-model.zip');
        assert.equal(value(command, '--report'), 'work/selected-model-export.json');
        if (isPreset) {
            assert.doesNotMatch(command, /--base-model|--base-revision/);
        } else {
            assert.equal(value(command, '--base-model'), smallBase.model);
            assert.equal(value(command, '--base-revision'), smallBase.revision);
        }
        if (source.kind === 'hub-adapter' && !isPreset) {
            assert.equal(value(command, '--adapter-repository'), source.repository);
            assert.equal(value(command, '--adapter-revision'), source.revision);
            assert.equal(value(command, '--adapter'), undefined);
        }
        if (source.kind === 'local-adapter') {
            assert.equal(value(command, '--adapter'), '/path/to/adapter-directory');
            assert.equal(value(command, '--adapter-repository'), undefined);
        }
    }
});

test('startup installed-model probe does not create IndexedDB', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    let opens = 0;
    Object.defineProperty(globalThis, 'indexedDB', {configurable: true, value: {
        databases: async () => [],
        open() { opens++; throw new Error('unexpected database creation'); }
    }});
    try {
        assert.deepEqual(await new ModelStore().listExisting(), []);
        assert.equal(opens, 0);
    } finally {
        if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
        else delete globalThis.indexedDB;
    }
});
