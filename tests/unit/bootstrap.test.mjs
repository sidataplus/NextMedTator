import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('direct dependencies use exact pins and Vue stays on the compatible API', async () => { const p = JSON.parse(await readFile('package.json', 'utf8')); for (const v of Object.values({ ...p.dependencies, ...p.devDependencies }))
    assert.match(v, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/); assert.equal(p.dependencies.vue, '2.7.16'); });
test('Cloudflare Pages and optional Workers deployments contain static assets without an inference handler', async () => {
    const pages = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
    assert.equal(pages.pages_build_output_dir, './dist');
    assert.equal(pages.main, undefined);
    assert.equal(pages.assets, undefined);
    const workers = JSON.parse(await readFile('deployment/workers-static/wrangler.jsonc', 'utf8'));
    assert.equal(workers.assets.directory, '../../dist');
    assert.equal(workers.main, undefined);
});
