import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = process.argv[2] ?? 'dist';
const manifest = JSON.parse(await readFile(`${root}/asset-manifest.json`, 'utf8'));
for (const asset of manifest.assets) {
    const bytes = await readFile(`${root}/${asset.path}`);
    assert.ok(bytes.length <= 25 * 1024 * 1024, asset.path);
    assert.equal(bytes.length, asset.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
}
const html = await readFile(`${root}/index.html`, 'utf8');
assert.ok(!/<script[^>]+src=["']https?:/i.test(html), 'Remote executable asset');
assert.ok(!/<script(?![^>]*src=)[^>]*>\s*\S/i.test(html), 'Inline executable script');
const headers = await readFile(`${root}/_headers`, 'utf8');
assert.ok(!headers.includes("'unsafe-eval'"), 'Unrestricted eval forbidden');
console.log(`Static asset inventory passed: ${manifest.assets.length} files; not a full legacy XSS/egress audit.`);
