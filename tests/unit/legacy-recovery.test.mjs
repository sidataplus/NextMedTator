import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LegacyRecoverySession} from '../../src/nextmedtator/backend/legacy-session.mjs';

test('failed corpus checkpoint stays unsaved without automatically retrying a quota fault',async()=>{
    let writes=0;const store={enabled:true,checkpoint:async()=>{writes++;throw Error('Quota');}};
    const session=new LegacyRecoverySession({store,capture:async()=>({id:'fixture'})});
    session.revision=2;
    await assert.rejects(session.save(),/Quota/);
    assert.equal(writes,1);assert.equal(session.savedRevision,0);assert.equal(session.pending,null);assert.equal(session.timer,null);
    assert.match(session.status,/Unsaved changes; recovery failed/);
});

test('locked recovery never replaces the current original-screen corpus',async()=>{
    let restored=false;const store={enabled:false,read:async()=>({data:{extensions:{legacyWorkspace:{version:1}}},hash:'fixture'}),enable:async()=>{throw Error('Tab conflict');}};
    const session=new LegacyRecoverySession({store,restore:async()=>{restored=true;}});
    await assert.rejects(session.recover('fixture','sqlite-opfs'),/Tab conflict/);
    assert.equal(restored,false);assert.equal(session.projectId,null);
});

test('an edit during initial capture remains pending until a new corpus checkpoint',async t=>{
    let finishCapture,value='before',captures=0;const writes=[];
    const captured=new Promise(resolve=>{finishCapture=resolve;});
    const store={enabled:false,enable:async()=>{store.enabled=true;},checkpoint:async project=>{writes.push(project.value);}};
    const session=new LegacyRecoverySession({store,capture:()=>captures++===0?captured:{id:'fixture',value}});
    t.after(()=>clearTimeout(session.timer));
    const enabling=session.enable();value='edited';session.touch();finishCapture({id:'fixture',value:'before'});
    await enabling;
    assert.deepEqual(writes,['before']);assert.equal(session.savedRevision,0);assert.equal(session.revision,1);
    assert.match(session.status,/another checkpoint pending/);
    await session.save();assert.deepEqual(writes,['before','edited']);assert.equal(session.savedRevision,session.revision);
    assert.match(session.status,/checkpoint verified/);
});
