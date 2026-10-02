import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoProject } from '../../src/nextmedtator/samples.mjs';
import { ReviewProject } from '../../src/nextmedtator/project.mjs';
import { clone, sha256 } from '../../src/nextmedtator/integrity.mjs';
test('imported completeness cannot claim full review without covered ranges and omissions', async () => { const p = await demoProject(), d = clone(p.current); d.draft.completeness[d.documents[0].id] = { families: [], ranges: [], omissionsChecked: false, unresolved: false, full: true }; await assert.rejects(() => ReviewProject.open(d), /contradicts/); });
test('a JSON source with an unpaired surrogate is rejected even with its replacement-byte hash', async () => { const p = await demoProject(), d = clone(p.current); d.documents[0].text = '\ud800'; d.documents[0].textSha256 = await sha256('\ud800'); d.documents[0].bytesSha256 = d.documents[0].textSha256; await assert.rejects(() => ReviewProject.open(d), /surrogate/); });
test('blind annotations cannot import another reviewer snapshot before freezing', async () => { const p = await demoProject(); const s = await p.snapshot(); const b = await p.blindAssignment('second-reviewer'); await assert.rejects(() => b.importSnapshot(s), /Freeze independent/); });
