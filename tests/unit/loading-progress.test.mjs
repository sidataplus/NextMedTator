import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadStatus} from '../../src/nextmedtator/loading-progress.mjs';

test('download ETA waits for measurements, then reflects remaining bytes',()=>{
    assert.match(downloadStatus({received:0,total:104857600,started:0,now:100}).detail,/Estimating/);
    const measured=downloadStatus({received:26214400,total:104857600,started:0,now:10000});
    assert.equal(measured.percent,25);
    assert.match(measured.detail,/25.0 MiB \/ 100.0 MiB.*30s remaining/);
    assert.equal(downloadStatus({received:104857600,total:104857600,started:0,now:40000}).percent,100);
});
