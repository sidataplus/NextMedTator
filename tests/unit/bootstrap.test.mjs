import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('direct dependencies use exact pins and Vue stays on the compatible API', async () => { const p = JSON.parse(await readFile('package.json', 'utf8')); for (const v of Object.values({ ...p.dependencies, ...p.devDependencies }))
    assert.match(v, /^\d+\.\d+\.\d+$/); assert.equal(p.dependencies.vue, '2.7.16'); });
test('Cloudflare deployment contains static assets, not an inference handler', async () => { const w = JSON.parse(await readFile('wrangler.jsonc', 'utf8')); assert.equal(w.assets.directory, './dist'); assert.equal(w.main, undefined); });
