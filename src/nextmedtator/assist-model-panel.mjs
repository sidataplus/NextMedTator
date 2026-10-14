/** Steps 2 and 3: model source, then load the model, Model Options and Installed Models. */
import { node, button, labeled, disclosure, icon } from './assist-dom.mjs';
import { conformanceMessage } from './conformance-report.mjs';
import { deviceRecommendation } from './device-profile.mjs';
import { localDownload } from './bundle.mjs';
import { isRecordsCodec, recordsNotice } from './gliner-small.mjs';
import { supportsWebGPU } from './execution-policy.mjs';
import { modelSelectionLabel, modelSelectionMatchesManifest, matchingInstalledModels, localAdapterSelection, renderModelSelectionControls } from './model-selection.mjs';

export function firstManifestPrecision(manifest) {
    if (!Array.isArray(manifest?.variants) || manifest.variants.length === 0) return null;
    const precision = manifest.variants[0]?.precision;
    return typeof precision === 'string' && precision.length ? precision : null;
}

export function renderModelSource(assist) {
    const section = node('section', null, { class: 'section', 'aria-label': 'Model source', 'data-testid': 'assist-step-model' });
    section.append(renderModelSelectionControls({
        selection: assist.modelSelection,
        draftMode: assist.selectionDraftMode,
        draft: assist.selectionDraft,
        activeModel: assist.model,
        onSelect: selection => assist.setSelectedModel(selection),
        onDraftMode: mode => {
            assist.beginModelSelectionAction();
            assist.selectionDraftMode = mode;
            assist.selectionDraft = null;
            assist.render();
        },
        onDraftChange: draft => {
            assist.beginModelSelectionAction();
            assist.selectionDraft = draft;
            // An unapplied source edit must not analyze with the previous model.
            for (const control of assist.root.querySelectorAll('[data-testid=analyze],#analyze,#assist-analyze,#assist-analyze-selected'))
                control.disabled = true;
        },
        onUseHub: selection => assist.perform(async () => {
            assist.setSelectedModel({ kind: 'hub-adapter', ...selection }, { render: false });
            assist.message = `Selected ${modelSelectionLabel(assist.modelSelection)}. Export the pinned adapter locally, then import its verified ONNX package.`;
        }),
        onUseLocal: (files, base) => assist.perform(async () => {
            const selection = await localAdapterSelection(files, base);
            assist.setSelectedModel(selection, { render: false });
            assist.message = `Selected local adapter ${selection.adapterSha256.slice(0, 12)}. Export it locally, then import its verified ONNX package.`;
        }),
        prefix: 'assist-model',
        disabled: assist.busy,
        compact: true,
    }));
    section.querySelector('h3').prepend(icon('packages'));
    return section;
}

export function renderModelPanel(assist) {
    const packages = disclosure(assist, 'packages', assist.model ? '3. Model Ready' : '3. Load the Model', !assist.model);
    const status = node('div', null, { class: 'row' });
    status.append(node('span', assist.structured() ? 'Structured Model' : assist.model ? 'Span Model' : 'Not Loaded', { class: `badge ${assist.model ? 'ready' : 'pending'}`, 'data-testid': 'model-status' }));
    packages.append(status);
    const recommended = deviceRecommendation(assist.deviceProfile, { execution: assist.executionPreference });
    const deviceCard = node('section', null, { class: 'setup-hint', 'data-testid': 'assist-device' });
    deviceCard.append(node('strong', recommended.title));
    if (recommended.caution) deviceCard.append(node('p', recommended.caution));
    packages.append(deviceCard);
    const precisionValue = assist.downloadPrecision ?? recommended.precision ?? 'fp32';
    if (!assist.model && ['clinical-p10', 'bpsd-base'].includes(assist.modelSelection.id))
        packages.append(...loadModelControls(assist, precisionValue));
    const downloadOptions = modelOptions(assist, recommended, precisionValue);
    if (precisionValue === 'fp16') packages.append(node('p', 'About 370 MiB. If the GPU cannot run it, Analyze downloads the FP32 model (about 725 MiB) as a fallback.', { class: 'muted' }));
    if (precisionValue === 'fp32') packages.append(node('p', 'About 725 MiB. Runs on CPU or GPU.', { class: 'muted' }));
    packages.append(downloadOptions, installedModels(assist));
    if (assist.deviceProfile) downloadOptions.append(deviceDetails(assist, recommended));
    if (assist.busy)
        for (const control of packages.querySelectorAll('button,input,select'))
            control.disabled = true;
    if (assist.model) downloadOptions.append(...modelIdentity(assist));
    return packages;
}

// Label and hint for the one-click P10/BPSD action, including repair of unusable installed copies.
function loadModelControls(assist, precisionValue) {
    const matchingInstalled = matchingInstalledModels(assist.modelSelection, assist.installedModels ?? []);
    const installedCandidates = matchingInstalled.filter(item => firstManifestPrecision(item.manifest) === precisionValue);
    const installed = installedCandidates.find(item => !assist.unavailableInstalledModels.has(item.manifestHash)) ?? installedCandidates[0];
    const malformedInstalled = installedCandidates.length ? null : matchingInstalled.find(item => firstManifestPrecision(item.manifest) === null);
    const actionableInstalled = installed ?? malformedInstalled;
    const modelName = assist.modelSelection.id === 'clinical-p10' ? 'P10' : 'BPSD';
    const format = precisionValue.toUpperCase();
    const unavailableReason = actionableInstalled && (assist.unavailableInstalledModels.get(actionableInstalled.manifestHash) ?? (malformedInstalled ? 'corrupt' : undefined));
    const loadLabel = unavailableReason === 'corrupt' ? `Repair ${modelName} (${format})` :
        unavailableReason === 'missing' ? `Re-download ${modelName} (${format})` :
        installed ? `Load Installed ${modelName}` : malformedInstalled ? `Repair ${modelName} (${format})` : `Download ${modelName} (${format})`;
    const loadHint = unavailableReason === 'corrupt' ? `The installed ${modelName} ${format} failed local integrity checks. Repair downloads a replacement and verifies it before installation.` :
        unavailableReason === 'missing' ? `The installed ${modelName} ${format} is missing from local storage. Download it again to continue.` :
        installed ? 'Saved on this device. No download needed.' :
        malformedInstalled ? `The installed ${modelName} package metadata is incomplete. Repair downloads the matching catalog package and verifies it before installation.` :
        'Runs on this device; your files are not uploaded. Nothing downloads until you click, and a short verification check may open in a new tab.';
    return [
        button(loadLabel, () => assist.perform(() => assist.loadSelectedPackage()), { id: 'assist-load-model', primary: true, disabled: assist.busy || !assist.deviceProfile }),
        node('p', loadHint, { class: 'muted' }),
    ];
}

function modelOptions(assist, recommended, precisionValue) {
    const options = disclosure(assist, 'download-options', 'Model Options');
    const precision = node('select', null, { 'aria-label': 'Download format', 'data-testid': 'assist-precision', disabled: assist.busy });
    for (const [value, label] of [['fp32', 'FP32 (CPU compatible)'], ['fp16', 'FP16 (smaller, for GPU)']])
        precision.append(node('option', label, { value }));
    precision.value = precisionValue;
    precision.addEventListener('change', () => { assist.downloadPrecision = precision.value; assist.render(); });
    const execution = node('select', null, { 'aria-label': 'Run on', 'data-testid': 'assist-execution', disabled: assist.busy });
    for (const [value, label] of [['auto', 'Automatic (GPU, CPU fallback)'], ['wasm', 'CPU Only']])
        execution.append(node('option', label, { value }));
    execution.value = assist.executionPreference ?? 'auto';
    execution.addEventListener('change', () => {
        assist.executionPreference = execution.value;
        assist.executionStatus = null;
        assist.qualifiedManifest = null;
        assist.render();
    });
    options.append(labeled('Download Format', precision), labeled('Run On', execution));
    if (recommended.precision)
        options.append(button('Use Recommended ' + recommended.precision.toUpperCase(), () => { assist.downloadPrecision = undefined; assist.render(); }, { disabled: assist.busy }));
    const model = assist.model;
    const mib = bytes => (bytes / 1048576).toFixed(0);
    const memory = model ? `Model in memory: ${mib(model.manifest.files.reduce((n, f) => n + f.bytes, 0))} MiB, plus runtime memory.` : 'No model in memory.';
    options.append(node('p', memory, { class: 'muted', 'data-testid': 'assist-model-memory' }));
    if (assist.storageEstimate)
        options.append(node('p', `Browser storage: ${mib(assist.storageEstimate.usage)} MiB used of about ${mib(assist.storageEstimate.quota)} MiB.`, { class: 'muted' }));
    if (model && supportsWebGPU(model.manifest, model.manifest.variants[0]))
        options.append(button('Check GPU Compatibility', () => assist.perform(() => assist.checkGPU()), {
            disabled: assist.busy,
            id: 'assist-check-gpu',
            title: 'Check the loaded model on this GPU with public examples; nothing is downloaded',
        }));
    if (assist.gpuCheck) {
        options.append(node('p', conformanceMessage(assist.gpuCheck), { class: 'muted', 'data-testid': 'assist-gpu-check-result' }),
            button('Save GPU Report', () => {
                const report = new TextEncoder().encode(JSON.stringify(assist.gpuCheck, null, 2) + '\n');
                localDownload(report, 'nextmedtator-gpu-check.json', 'application/json');
            }, { id: 'assist-save-gpu-check' }),
            node('p', 'Report includes public reference-check measurements, model identity and browser version. It excludes your files and annotations.', { class: 'muted' }));
    }
    if (model) {
        options.append(button('Unload Model', () => assist.unloadModel(), { disabled: assist.busy, id: 'assist-unload-model' }));
        options.append(button('Install for Offline Use', () => assist.perform(async () => {
            const installed = await assist.modelStore.install(assist.model);
            assist.unavailableInstalledModels.delete(installed.manifestHash);
            assist.adoptModel(installed);
            assist.modelStorageNotice = null;
            await assist.inspectStorage();
            assist.message = 'Model package installed and read-back verified';
        })));
    }
    return options;
}

function installedModels(assist) {
    const section = disclosure(assist, 'local-packages', 'Installed Models');
    const file = node('input', null, { type: 'file', accept: '.zip', disabled: assist.busy, 'aria-label': 'Import model package into the annotation assistance panel' });
    file.addEventListener('change', () => { const picked = file.files?.[0]; if (picked) assist.perform(() => assist.importPackage(picked)); });
    section.append(labeled('Import Model Package (.zip)', file), button('List Installed Models', () => assist.perform(() => assist.inspectStorage())));
    for (const item of assist.installedModels ?? []) {
        const matches = modelSelectionMatchesManifest(assist.modelSelection, item.manifest);
        const unavailableReason = assist.unavailableInstalledModels.get(item.manifestHash);
        const sizeLabel = Number.isSafeInteger(item.bytes) ? `${(item.bytes / 1048576).toFixed(1)} MiB` : 'size unavailable';
        const health = unavailableReason === 'corrupt' ? ' · failed local integrity checks' : unavailableReason === 'missing' ? ' · missing from local storage' : '';
        section.append(node('p', `${item.manifest.id} · ${sizeLabel} · ${matches ? 'matches selected source' : 'different source'}${health}`, { class: 'muted' }));
        if (unavailableReason)
            section.append(node('p', 'Use the main download button to replace it. This copy has not been removed.', { class: 'muted' }));
        else
            section.append(button('Use Installed ' + item.manifest.id, () => assist.perform(async () => {
                await assist.useInstalledModel(item.manifestHash);
                if (assist.model) assist.message = `Installed package loaded and hashes verified for ${modelSelectionLabel(assist.modelSelection)}.`;
            })));
    }
    for (const item of assist.installedModels ?? [])
        section.append(button('Remove Installed ' + item.manifest.id, () => assist.perform(async () => {
            if (!confirm('Remove this cached model from this browser? You can download or import it again.')) return;
            if (assist.model?.manifestHash === item.manifestHash) assist.unloadModel();
            await assist.modelStore.remove(item.manifestHash);
            await assist.inspectStorage();
        }), { disabled: assist.busy, id: 'assist-remove-model' }));
    section.append(packageDetails(assist));
    return section;
}

function packageDetails(assist) {
    const details = disclosure(assist, 'package-details', 'Package Details');
    const recordsVariant = assist.model?.manifest.variants.find(v => isRecordsCodec(v.codec));
    details.append(node('p', assist.structured()
        ? (recordsVariant ? recordsNotice(recordsVariant.codec) : 'Enum attributes come from the local span-attribute head. Value, unit, and relations stay empty.')
        : 'Import a local package to fill spans. Contextual fields stay empty until the package includes the span-attribute head.', { class: 'muted' }));
    return details;
}

function deviceDetails(assist, recommended) {
    const profile = assist.deviceProfile;
    const details = disclosure(assist, 'device-details', 'Device Details');
    const memory = profile.memory !== null ? ` · browser memory hint ${profile.memory} GiB` : '';
    details.append(node('p', `${profile.gpu ? 'WebGPU available' : 'CPU / WASM'} · ${profile.cores ?? 'Unknown'} logical cores${memory}. RAM and GPU memory are not measured.`, { class: 'muted' }));
    details.append(node('p', recommended.reason, { class: 'muted' }));
    return details;
}

// The selected source label and the active backend, shown at the end of Model Options.
function modelIdentity(assist) {
    const { manifest } = assist.model, status = assist.executionStatus;
    const execution = status
        ? `${status.backend === 'webgpu' ? 'WebGPU' : 'WASM'} · ${status.precision?.toUpperCase() ?? 'FP32'}${status.fallbackReason ? ' · automatic fallback' : ''}`
        : `${manifest.variants[0].precision.toUpperCase()} package · ${manifest.id}`;
    return [
        node('p', modelSelectionLabel(assist.modelSelection), { class: 'muted', 'data-testid': 'assist-model-identity', title: manifest.id }),
        node('p', execution, { class: 'muted', 'data-testid': 'assist-execution-status' }),
    ];
}
