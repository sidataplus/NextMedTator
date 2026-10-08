import {canonical, sha256} from './integrity.mjs';

export const MODEL_PRESETS = Object.freeze([
    Object.freeze({
        id: 'clinical-v3-small',
        label: 'ClinicalEvidence GLiNER2.5 small LoRA v3 ACT/Sol',
        kind: 'hub-adapter',
        repository: 'na399/clinical-evidence-gliner2.5-small-lora-v3-act-sol',
        revision: '82386c7a9776d3c14ed73d6310273a1c9d354d55',
        baseModel: 'fastino/gliner2.5-small-v1',
        baseRevision: '7132dc4561c3f94563c6147e75ffa8ef34c4964a',
        exportSelection: 'clinical-v3-small'
    }),
    Object.freeze({
        id: 'clinical-v3-base',
        label: 'ClinicalEvidence GLiNER2.5 base LoRA v3 ACT/Sol',
        kind: 'hub-adapter',
        repository: 'na399/clinical-evidence-gliner2.5-base-lora-v3-act-sol',
        revision: 'b5db08ccd2581690f30a448428ba7659e1469eeb',
        baseModel: 'fastino/gliner2.5-base-v1',
        baseRevision: 'ca906247640776a07753514055be9726f9080ead',
        exportSelection: 'clinical-v3-base'
    }),
    Object.freeze({
        id: 'original-small',
        label: 'Original GLiNER2.5 small',
        kind: 'base-model',
        model: 'fastino/gliner2.5-small-v1',
        revision: '7132dc4561c3f94563c6147e75ffa8ef34c4964a',
        exportSelection: 'original-small'
    }),
    Object.freeze({
        id: 'original-base',
        label: 'Original GLiNER2.5 base',
        kind: 'base-model',
        model: 'fastino/gliner2.5-base-v1',
        revision: 'ca906247640776a07753514055be9726f9080ead',
        exportSelection: 'original-base'
    })
]);

export const DEFAULT_MODEL_SELECTION = MODEL_PRESETS[0];
export const MODEL_SELECTION_STORAGE_KEY = 'nextmedtator-model-selection-v1';

const clone = value => JSON.parse(JSON.stringify(value));
const repoPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const revisionPattern = /^[a-f0-9]{40}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const lineageRevisionPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function optionalBase(selection) {
    if (!selection.baseModel && !selection.baseRevision)
        return true;
    return repoPattern.test(selection.baseModel ?? '') && revisionPattern.test(selection.baseRevision ?? '');
}

export function normalizeModelSelection(selection) {
    if (typeof selection?.id === 'string') {
        const preset = MODEL_PRESETS.find(item => item.id === selection.id);
        if (preset)
            return clone(preset);
    }
    if (selection?.kind === 'hub-adapter' && repoPattern.test(selection.repository ?? '') && revisionPattern.test(selection.revision ?? '') && optionalBase(selection)) {
        return {
            id: 'custom-huggingface', kind: 'hub-adapter', repository: selection.repository,
            revision: selection.revision,
            ...(selection.baseModel ? {baseModel: selection.baseModel, baseRevision: selection.baseRevision} : {})
        };
    }
    if (selection?.kind === 'local-adapter' && hashPattern.test(selection.adapterSha256 ?? '') && optionalBase(selection)) {
        return {
            id: 'local-adapter', kind: 'local-adapter', adapterSha256: selection.adapterSha256,
            ...(selection.baseModel ? {baseModel: selection.baseModel, baseRevision: selection.baseRevision} : {})
        };
    }
    if (selection?.kind === 'base-model' && repoPattern.test(selection.model ?? '') && revisionPattern.test(selection.revision ?? '')) {
        return {id: 'custom-base', kind: 'base-model', model: selection.model, revision: selection.revision};
    }
    if (selection?.kind === 'imported-package' && typeof selection.lineage?.base?.model === 'string' &&
        selection.lineage.base.model.length > 0 && lineageRevisionPattern.test(selection.lineage.base.revision ?? '')) {
        return {id: 'imported-package', kind: 'imported-package', lineage: clone(selection.lineage)};
    }
    throw new Error('Choose a model preset or provide a repository and immutable revision.');
}

export function modelSelectionControlValue(selection) {
    if (MODEL_PRESETS.some(item => item.id === selection?.id))
        return selection.id;
    if (selection?.kind === 'hub-adapter')
        return 'custom-huggingface';
    if (selection?.kind === 'local-adapter')
        return 'local-adapter';
    if (selection?.kind === 'imported-package')
        return 'imported-package';
    return 'custom-base';
}

export function modelSelectionKey(selection) {
    const source = normalizeModelSelection(selection);
    if (source.kind === 'hub-adapter')
        return `adapter:${source.repository}@${source.revision}#${source.baseModel ?? ''}@${source.baseRevision ?? ''}`;
    if (source.kind === 'local-adapter')
        return `local:${source.adapterSha256}#${source.baseModel ?? ''}@${source.baseRevision ?? ''}`;
    if (source.kind === 'imported-package')
        return `imported:${canonical(source.lineage)}`;
    return `base:${source.model}@${source.revision}`;
}

export function modelSelectionLabel(selection) {
    const source = normalizeModelSelection(selection);
    const preset = MODEL_PRESETS.find(item => item.id === source.id);
    if (preset)
        return preset.label;
    if (source.kind === 'hub-adapter')
        return `${source.repository}@${source.revision}`;
    if (source.kind === 'local-adapter')
        return `Local adapter ${source.adapterSha256.slice(0, 12)}`;
    if (source.kind === 'imported-package')
        return `Imported ONNX package (${source.lineage.base.model})`;
    return `${source.model}@${source.revision}`;
}

export function modelSelectionMatchesManifest(selection, manifest) {
    let source;
    try {
        source = normalizeModelSelection(selection);
    } catch {
        return false;
    }
    const base = manifest?.lineage?.base;
    const adapter = manifest?.lineage?.adapter;
    if (!base || !lineageRevisionPattern.test(base.revision ?? ''))
        return false;
    if (source.kind === 'imported-package')
        return canonical(source.lineage) === canonical(manifest?.lineage);
    if (source.kind === 'hub-adapter') {
        return adapter?.repository === source.repository && adapter?.revision === source.revision &&
            (!source.baseModel || (base.model === source.baseModel && base.revision === source.baseRevision));
    }
    if (source.kind === 'local-adapter') {
        return adapter?.sha256 === source.adapterSha256 &&
            (!source.baseModel || (base.model === source.baseModel && base.revision === source.baseRevision));
    }
    return !adapter && base.model === source.model && base.revision === source.revision;
}

export function matchingInstalledModels(selection, installed) {
    return (installed ?? []).filter(item => modelSelectionMatchesManifest(selection, item.manifest));
}

export function selectionFromManifest(manifest) {
    const adapter = manifest?.lineage?.adapter;
    const base = manifest?.lineage?.base;
    const baseIdentity = base?.model && revisionPattern.test(base.revision ?? '')
        ? {baseModel: base.model, baseRevision: base.revision} : {};
    if (adapter?.repository && adapter?.revision) {
        const preset = MODEL_PRESETS.find(item => item.kind === 'hub-adapter' && item.repository === adapter.repository && item.revision === adapter.revision);
        if (preset && modelSelectionMatchesManifest(preset, manifest))
            return clone(preset);
        if (!repoPattern.test(base?.model ?? '') || !revisionPattern.test(base?.revision ?? ''))
            return normalizeModelSelection({kind: 'imported-package', lineage: manifest.lineage});
        return normalizeModelSelection({kind: 'hub-adapter', repository: adapter.repository, revision: adapter.revision, ...baseIdentity});
    }
    if (adapter?.sha256) {
        if (!repoPattern.test(base?.model ?? '') || !revisionPattern.test(base?.revision ?? ''))
            return normalizeModelSelection({kind: 'imported-package', lineage: manifest.lineage});
        return normalizeModelSelection({kind: 'local-adapter', adapterSha256: adapter.sha256, ...baseIdentity});
    }
    const preset = MODEL_PRESETS.find(item => item.kind === 'base-model' && item.model === base?.model && item.revision === base?.revision);
    if (preset)
        return clone(preset);
    return normalizeModelSelection({kind: 'imported-package', lineage: manifest.lineage});
}

export function createModelSelectionState(storage) {
    try {
        const saved = JSON.parse((storage ?? globalThis.localStorage)?.getItem(MODEL_SELECTION_STORAGE_KEY) ?? 'null');
        const selection = normalizeModelSelection(saved?.selection);
        const thresholds = {};
        for (const [key, value] of Object.entries(saved?.thresholds ?? {})) {
            const number = Number(value);
            if (Number.isFinite(number) && number >= 0 && number <= 1)
                thresholds[key] = number;
        }
        return {selection, thresholds};
    } catch {
        return {selection: clone(DEFAULT_MODEL_SELECTION), thresholds: {}};
    }
}

export function saveModelSelectionState(state, storage) {
    try {
        (storage ?? globalThis.localStorage)?.setItem(MODEL_SELECTION_STORAGE_KEY, JSON.stringify({selection: state.selection, thresholds: state.thresholds}));
    } catch {
        // Selection remains valid for the current page when browser storage is unavailable.
    }
}

export function setModelSelection(state, selection) {
    state.selection = normalizeModelSelection(selection);
    return state.selection;
}

export function selectionThresholdOverride(state) {
    return state.thresholds[modelSelectionKey(state.selection)] ?? null;
}

export function setSelectionThresholdOverride(state, value) {
    const key = modelSelectionKey(state.selection);
    if (value == null) {
        delete state.thresholds[key];
        return null;
    }
    const threshold = Number(value);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
        throw new Error('Suggestion threshold must be a number between 0 and 1.');
    state.thresholds[key] = threshold;
    return threshold;
}

export function restoreSelectionThresholdOverride(state, savedSelectionKey, savedValue) {
    if (savedSelectionKey !== modelSelectionKey(state.selection))
        return selectionThresholdOverride(state);
    return setSelectionThresholdOverride(state, savedValue ?? null);
}

export async function localAdapterSelection(files, {baseModel, baseRevision} = {}) {
    if (!!baseModel !== !!baseRevision)
        throw new Error('Provide both the base model repository and its immutable revision.');
    const byName = new Map();
    for (const file of files ?? []) {
        const name = String(file.webkitRelativePath || file.name).split('/').at(-1);
        if (name === 'adapter_config.json' || name === 'adapter_model.safetensors') {
            if (byName.has(name))
                throw new Error(`Select one adapter directory containing a single ${name}.`);
            byName.set(name, file);
        }
    }
    const configFile = byName.get('adapter_config.json'), weightsFile = byName.get('adapter_model.safetensors');
    if (!configFile || !weightsFile)
        throw new Error('Select a local adapter directory containing adapter_config.json and adapter_model.safetensors.');
    if (configFile.size > 1024 * 1024 || weightsFile.size > 512 * 1024 * 1024)
        throw new Error('Local adapter files exceed the exporter limits.');
    const configBytes = new Uint8Array(await configFile.arrayBuffer());
    const weightsBytes = new Uint8Array(await weightsFile.arrayBuffer());
    let config;
    try {
        config = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(configBytes));
    } catch {
        throw new Error('adapter_config.json is not valid UTF-8 JSON.');
    }
    if (config.peft_type !== 'LORA' || !(config.r > 0) || !config.target_modules)
        throw new Error('The exporter accepts PEFT LoRA adapter files with rank and target_modules.');
    if (config.alora_invocation_tokens || config.layer_replication)
        throw new Error('This local adapter uses PEFT features that the static exporter does not support.');
    const names = ['adapter_config.json', 'adapter_model.safetensors'];
    const values = [configBytes, weightsBytes];
    const parts = [];
    for (let index = 0; index < names.length; index++) {
        parts.push(new TextEncoder().encode(`${names[index]}\0`), values[index]);
    }
    const combined = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        combined.set(part, offset);
        offset += part.length;
    }
    const configuredBase = baseModel ? {baseModel, baseRevision} : configuredBaseIdentity(config);
    if (!configuredBase.baseModel)
        throw new Error('Could not identify the adapter base. Enter its repository and immutable 40-character revision.');
    return normalizeModelSelection({kind: 'local-adapter', adapterSha256: await sha256(combined), ...configuredBase});
}

function configuredBaseIdentity(config) {
    const declared = config.base_model_name_or_path;
    const cached = /(?:^|[\\/])models--([^/\\]+)--([^/\\]+)[\\/]snapshots[\\/]([a-f0-9]{40})(?:[\\/]|$)/.exec(String(declared ?? ''));
    if (cached)
        return {baseModel: `${cached[1]}/${cached[2]}`, baseRevision: cached[3]};
    if (repoPattern.test(declared ?? '') && revisionPattern.test(config.revision ?? ''))
        return {baseModel: declared, baseRevision: config.revision};
    return {};
}

const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

export function adapterExportCommands(selection, {adapterPath = '/path/to/adapter-directory', output = 'work/selected-model.nmt-model.zip', report = 'work/selected-model-export.json'} = {}) {
    const source = normalizeModelSelection(selection);
    if (source.kind === 'imported-package')
        throw new Error('Imported ONNX packages do not need adapter export.');
    if (source.kind === 'base-model' && !source.exportSelection)
        throw new Error('No local exporter preset is available for this base revision.');
    if (source.kind === 'base-model')
        return [`uv run --locked --project tools/gliner-onnx gliner-onnx --selection ${shellQuote(source.exportSelection ?? source.id)} --out ${shellQuote(output)} --report ${shellQuote(report)}`];
    const selectionId = MODEL_PRESETS.find(item => modelSelectionKey(item) === modelSelectionKey(source))?.exportSelection;
    const args = [
        'uv run --locked --project tools/gliner-onnx gliner-onnx',
        `--selection ${shellQuote(selectionId ?? (source.kind === 'hub-adapter' ? 'huggingface-adapter' : 'local-adapter'))}`,
        ...(source.kind === 'local-adapter' ? [`--adapter ${shellQuote(adapterPath)}`] : []),
        ...(source.kind === 'hub-adapter' && !selectionId ? [`--adapter-repository ${shellQuote(source.repository)}`, `--adapter-revision ${shellQuote(source.revision)}`] : []),
        ...(!selectionId && source.baseModel ? [`--base-model ${shellQuote(source.baseModel)}`, `--base-revision ${shellQuote(source.baseRevision)}`] : []),
        `--out ${shellQuote(output)}`,
        `--report ${shellQuote(report)}`
    ].join(' \\\n  ');
    return [args];
}

export function renderModelSelectionControls({selection, draftMode, activeModel, onSelect, onDraftMode, onUseHub, onUseLocal, prefix = 'model-selection', disabled = false}) {
    const root = document.createElement('section');
    root.className = 'model-selection';
    const heading = document.createElement('h3');
    heading.textContent = 'Auto annotation model';
    root.append(heading);

    const label = document.createElement('label');
    label.textContent = 'Model source';
    label.htmlFor = `${prefix}-source`;
    const select = document.createElement('select');
    select.id = `${prefix}-source`;
    select.dataset.testid = `${prefix}-source`;
    select.disabled = disabled;
    for (const preset of MODEL_PRESETS)
        select.append(new Option(preset.label, preset.id));
    const imported = new Option('Imported ONNX package', 'imported-package');
    imported.disabled = true;
    select.append(imported);
    select.append(new Option('Custom Hugging Face adapter', 'custom-huggingface'), new Option('Local adapter files', 'local-adapter'));
    select.value = draftMode ?? modelSelectionControlValue(selection);
    select.addEventListener('change', () => {
        const preset = MODEL_PRESETS.find(item => item.id === select.value);
        if (preset)
            onSelect?.(preset);
        else
            onDraftMode?.(select.value);
    });
    label.append(select);
    root.append(label);

    const mode = draftMode ?? modelSelectionControlValue(selection);
    const sourcePending = mode !== modelSelectionControlValue(selection);
    const activeMatches = !sourcePending && activeModel && modelSelectionMatchesManifest(selection, activeModel.manifest);
    const status = document.createElement('p');
    status.className = 'muted';
    status.setAttribute('role', 'status');
    status.dataset.testid = `${prefix}-status`;
    status.textContent = sourcePending
        ? `Complete and apply the ${mode === 'custom-huggingface' ? 'Hugging Face' : 'local adapter'} source before analysis. Current source remains ${modelSelectionLabel(selection)}.`
        : activeMatches
        ? `Active package: ${activeModel.manifest.id}. Package hashes were verified; public conformance runs before analysis.`
        : `Selected: ${modelSelectionLabel(selection)}. ${activeModel ? 'The loaded package does not match this source and cannot run.' : 'No matching ONNX package is active.'} ${selection.kind === 'imported-package' ? 'Import or install a matching package.' : 'Convert or install a matching package to analyze.'}`;
    root.append(status);

    if (mode === 'custom-huggingface') {
        const current = selection?.kind === 'hub-adapter' && selection.id === 'custom-huggingface' ? selection : {};
        const fields = {};
        for (const [name, text, value, placeholder] of [
            ['repository', 'Hugging Face adapter repository', current.repository ?? '', 'owner/model'],
            ['revision', 'Immutable adapter revision', current.revision ?? '', '40-character commit'],
            ['baseModel', 'Base model repository (optional)', current.baseModel ?? '', 'owner/model'],
            ['baseRevision', 'Immutable base revision (optional)', current.baseRevision ?? '', '40-character commit']
        ]) {
            const field = document.createElement('label');
            field.textContent = text;
            const input = document.createElement('input');
            input.type = 'text';
            input.autocomplete = 'off';
            input.placeholder = placeholder;
            input.value = value;
            input.disabled = disabled;
            input.dataset.testid = `${prefix}-${name}`;
            field.append(input);
            fields[name] = input;
            root.append(field);
        }
        const use = document.createElement('button');
        use.type = 'button';
        use.textContent = 'Use this Hugging Face adapter';
        use.disabled = disabled;
        use.addEventListener('click', () => onUseHub?.({repository: fields.repository.value.trim(), revision: fields.revision.value.trim(), baseModel: fields.baseModel.value.trim(), baseRevision: fields.baseRevision.value.trim()}));
        root.append(use);
    } else if (mode === 'local-adapter') {
        const label = document.createElement('label');
        label.textContent = 'Local adapter directory';
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.setAttribute('webkitdirectory', '');
        input.setAttribute('directory', '');
        input.setAttribute('accept', '.json,.safetensors');
        input.disabled = disabled;
        input.dataset.testid = `${prefix}-local-files`;
        let files = [];
        input.addEventListener('change', () => { files = [...input.files]; });
        label.append(input);
        root.append(label);
        const baseFields = {};
        for (const [name, text, placeholder] of [
            ['baseModel', 'Base model repository (optional)', 'owner/model'],
            ['baseRevision', 'Immutable base revision (optional)', '40-character commit']
        ]) {
            const field = document.createElement('label');
            field.textContent = text;
            const control = document.createElement('input');
            control.type = 'text';
            control.autocomplete = 'off';
            control.placeholder = placeholder;
            control.disabled = disabled;
            control.dataset.testid = `${prefix}-${name}`;
            field.append(control);
            baseFields[name] = control;
            root.append(field);
        }
        const use = document.createElement('button');
        use.type = 'button';
        use.textContent = 'Use local adapter files';
        use.disabled = disabled;
        use.addEventListener('click', () => onUseLocal?.(files, {baseModel:baseFields.baseModel.value.trim(),baseRevision:baseFields.baseRevision.value.trim()}));
        root.append(use);
        const note = document.createElement('p');
        note.className = 'muted';
        note.textContent = 'The browser checks these files locally and keeps only their hash. The adapter config must identify an immutable base, or provide both base fields. Run the ONNX exporter separately on your machine.';
        root.append(note);
    }

    try {
        const commands = adapterExportCommands(selection);
        const details = document.createElement('details');
        const title = document.createElement('summary');
        title.textContent = 'Local export command';
        const command = document.createElement('pre');
        command.dataset.testid = `${prefix}-export-command`;
        command.textContent = commands.join('\n');
        details.append(title, command);
        root.append(details);
    } catch {
        // Incomplete custom selections do not have a valid export command yet.
    }
    return root;
}
