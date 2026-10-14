import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{signGrant,verifyGrant,verifyTurnstile} from '../../deployment/download-worker/worker.mjs';
import {PACKAGES} from '../../deployment/download-worker/packages.mjs';
const secret='unit-test-only-secret',ip='192.0.2.1',revision=Object.keys(PACKAGES)[0];
async function token(expires=Date.now()+60000){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const hash=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ip))).toString('base64url');return signGrant({ip:hash,revisions:[revision],expires},secret);}
test('grants reject tampering, expired tokens, different IPs and packages',async()=>{
    const t=await token();assert.equal(await verifyGrant(t,secret,ip,revision),true);
    for(const [value,address,rev] of [[t+'x',ip,revision],[t,'192.0.2.2',revision],[t,ip,'other'],[await token(Date.now()-1),ip,revision]])assert.equal(await verifyGrant(value,secret,address,rev),false);
});
test('Turnstile requires exact hostname, action and success; failures close access',async()=>{
    const env={TURNSTILE_SECRET:secret},good={success:true,action:'model_download',hostname:'nmt-models.sidata.plus'};
    assert.equal(await verifyTurnstile('fresh',ip,env,async()=>Response.json(good)),true);
    for(const result of [{...good,success:false},{...good,success:1},{...good,action:'other'},{...good,hostname:'localhost'}])assert.equal(await verifyTurnstile('x',ip,env,async()=>Response.json(result)),false);
    assert.equal(await verifyTurnstile('',ip,env),false);
    assert.equal(await verifyTurnstile('x',ip,env,async()=>{throw Error('offline');}),false);
    assert.equal(await verifyTurnstile('x',ip,env,async()=>new Response('invalid')),false);
});
test('artifact access is fail-closed and authenticated ranges are bounded and streamed',async()=>{
    let reads=0;const env={GRANT_SECRET:secret,ARTIFACT_LIMIT:{limit:async()=>({success:true})},MODELS:{get:async(path,{range})=>{reads++;assert.deepEqual(range,{offset:0,length:4});return {body:new Uint8Array(4),httpEtag:'"test"'};}}};
    const url=`https://nmt-models.sidata.plus/nextmedtator-models/${revision}/model.onnx`;
    const request=headers=>new Request(url,{headers:{'CF-Connecting-IP':ip,...headers}});
    assert.equal((await worker.fetch(request({Range:'bytes=0-3'}),env)).status,403);assert.equal(reads,0);
    const auth={Authorization:'Bearer '+await token()};
    assert.equal((await worker.fetch(request(auth),env)).status,416);
    assert.equal((await worker.fetch(request({...auth,Range:'bytes=0-8388608'}),env)).status,416);
    const r=await worker.fetch(request({...auth,Range:'bytes=0-3'}),env);assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,4);assert.equal(reads,1);
    env.ARTIFACT_LIMIT.limit=async()=>({success:false});assert.equal((await worker.fetch(request({...auth,Range:'bytes=0-3'}),env)).status,429);
});
test('grant endpoint honors single-use verification, bounds requests, and never grants an unknown revision',async()=>{
    const realFetch=globalThis.fetch;let used=false;
    globalThis.fetch=async()=>{const success=!used;used=true;return Response.json({success,action:'model_download',hostname:'nmt-models.sidata.plus'});};
    try{
        const env={TURNSTILE_SECRET:secret,GRANT_SECRET:secret,GRANT_LIMIT:{limit:async()=>({success:true})}};
        const req=body=>new Request('https://nmt-models.sidata.plus/grant',{method:'POST',headers:{'CF-Connecting-IP':ip},body});
        const body=JSON.stringify({token:'single-use-test-token',revision});
        const first=await worker.fetch(req(body),env);assert.equal(first.status,200);
        const grant=await first.json();assert.equal(await verifyGrant(grant.token,secret,ip,revision),true);
        assert.equal((await worker.fetch(req(body),env)).status,403);
        assert.equal((await worker.fetch(req('x'.repeat(4097)),env)).status,413);
        assert.equal((await worker.fetch(req(JSON.stringify({token:'x',revision:'__proto__'})),env)).status,403);
    }finally{globalThis.fetch=realFetch;}
});
