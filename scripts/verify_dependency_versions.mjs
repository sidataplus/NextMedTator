/** Explicit developer-only registry verification. Not included in the static application. */
import { readFile, writeFile } from 'node:fs/promises';
const p = JSON.parse(await readFile('package.json', 'utf8')), report = [];
for (const [name, version] of Object.entries({ ...p.dependencies, ...p.devDependencies })) {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok)
        throw Error(`Registry did not resolve ${name}@${version}: ${response.status}`);
    const data = await response.json();
    if (data.version !== version || !data.dist?.integrity)
        throw Error(`Missing registry integrity for ${name}@${version}`);
    report.push({ name, version, integrity: data.dist.integrity, tarball: data.dist.tarball, license: data.license ?? null });
}
await writeFile('dependency-verification.json', JSON.stringify({ verifiedAt: new Date().toISOString(), packages: report }, null, 2));
console.log('Direct package versions verified. Resolve, review and commit pnpm-lock.yaml; then run frozen install and audits.');
