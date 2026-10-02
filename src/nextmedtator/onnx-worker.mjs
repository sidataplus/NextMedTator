import { validateModelManifest, compareTensors } from './model-package.mjs';
import { invariant, jsonParse, sha256 } from './integrity.mjs';
// ORT and its WASM files are copied locally by the build. No fallback URL or API.
self.onmessage = async ({ data }) => {
    let session;
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
        session = await ort.InferenceSession.create(files.get(variant.graph), { executionProviders: [variant.backend], externalData: (variant.externalData ?? []).map(f => ({ path: f.name, data: files.get(f.path) })), logSeverityLevel: 4 });
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
        self.postMessage({ result: { kind: 'graph-conformance-not-clinical-validation', manifestHash: data.manifestHash, variantId: variant.id, backend: variant.backend, precision: variant.precision, runtime: ort.env.versions, results, pass: results.every(r => r.pass) } });
    }
    catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : 'Local conformance failed' });
    }
    finally {
        await session?.release();
    }
};
