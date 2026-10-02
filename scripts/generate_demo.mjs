/** Regenerate original synthetic walkthrough files; never downloads clinical corpora. */
import { mkdir, writeFile } from 'node:fs/promises';
import { demoProject, authoredReference, DEMO_NOTICE } from '../src/nextmedtator/samples.mjs';
const out = 'samples/nextmedtator';
await mkdir(out, { recursive: true });
const project = await demoProject();
await writeFile(`${out}/schema.json`, JSON.stringify(project.current.schema, null, 2) + '\n');
await writeFile(`${out}/documents.jsonl`, project.current.documents.map(d => JSON.stringify({ id: d.id, text: d.text, split: d.split, provenance: d.provenance })).join('\n') + '\n');
await writeFile(`${out}/authored-reference.jsonl`, project.current.documents.map(d => JSON.stringify({ documentId: d.id, sourceHash: d.textSha256, records: authoredReference(d).map((r, i) => ({ ...r, id: `${d.id}-reference-${i + 1}` })), referenceStatus: 'author-reviewed-synthetic-not-independent-gold' })).join('\n') + '\n');
await writeFile(`${out}/manifest.json`, JSON.stringify({ id: 'nextmedtator-synthetic-v1', license: 'Apache-2.0', source: 'Original synthetic examples created for NextMedTator', notice: DEMO_NOTICE, documents: project.current.documents.map(d => ({ id: d.id, sha256: d.textSha256 })), externalDatasetsBundled: false }, null, 2) + '\n');
