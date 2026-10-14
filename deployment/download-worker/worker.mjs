import {PACKAGES} from './packages.mjs';
const encoder=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const unb64=text=>Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const key=secret=>crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type, Range','Access-Control-Allow-Methods':'GET, HEAD, POST, OPTIONS','Access-Control-Expose-Headers':'Content-Range, ETag, Content-Length, Retry-After','Cross-Origin-Resource-Policy':'cross-origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(data,status=200)=>Response.json(data,{status,headers:{...cors,...(status===429?{'Retry-After':'60'}:{})}});
async function ipHash(ip,secret){return b64(await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(ip)));}
export async function signGrant(payload,secret){const body=b64(encoder.encode(JSON.stringify(payload)));return body+'.'+b64(await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(body)));}
export async function verifyGrant(token,secret,ip,revision,now=Date.now()){
    try{
        if(typeof token!=='string'||token.length>2048)return false;
        const parts=token.split('.');if(parts.length!==2)return false;
        if(!await crypto.subtle.verify('HMAC',await key(secret),unb64(parts[1]),encoder.encode(parts[0])))return false;
        const grant=JSON.parse(new TextDecoder().decode(unb64(parts[0])));
        return grant.expires>now&&grant.expires<=now+7200000&&grant.ip===await ipHash(ip,secret)&&grant.revisions.includes(revision);
    }catch{return false;}
}
export async function verifyTurnstile(token,ip,env,fetcher=fetch){
    if(typeof token!=='string'||!token.length||token.length>2048||!env.TURNSTILE_SECRET)return false;
    try{
        const response=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',signal:AbortSignal.timeout(10000),body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:token,remoteip:ip})});
        if(!response.ok)return false;
        const result=await response.json();
        return result.success===true&&result.action==='model_download'&&result.hostname==='nmt-models.sidata.plus';
    }catch{return false;}
}
function verificationPage(url,sitekey){
    const parent=url.searchParams.get('parent'),nonce=url.searchParams.get('nonce');let allowed=false;
    try{const p=new URL(parent);allowed=p.origin===parent&&(p.origin==='https://nmt.sidata.plus'||p.origin==='https://nextmedtator.pages.dev'||(['localhost','127.0.0.1'].includes(p.hostname)&&p.protocol==='http:'));}catch{}
    if(!allowed||! /^[a-f0-9-]{36}$/.test(nonce??''))return json({error:'Invalid verification request'},400);
    const cspNonce=crypto.randomUUID();
    const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Verify model download</title><style>body{margin:4px;font:13px/1.5 system-ui;color:#294955}#status{margin-top:12px}</style><div id="check"></div><p id="status" role="status">Loading verification…</p><script nonce="${cspNonce}">window.ready=()=>{const status=document.querySelector('#status');let widget=turnstile.render('#check',{sitekey:${JSON.stringify(sitekey)},action:'model_download',size:'flexible',callback:token=>{status.textContent='Verified. Returning to your download…';parent.postMessage({nonce:${JSON.stringify(nonce)},token},${JSON.stringify(parent)});},'expired-callback':()=>{status.textContent='Verification expired. Please try again.';turnstile.reset(widget);},'error-callback':()=>{status.textContent='Verification could not load. Cancel and retry, or check your connection.';}});status.textContent='Complete the check above if prompted.';};</script><script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=ready&amp;render=explicit" async defer></script></html>`;
    return new Response(html,{headers:{...cors,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${cspNonce}' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors https://nmt.sidata.plus https://nextmedtator.pages.dev http://localhost:* http://127.0.0.1:*`}});
}
export default {async fetch(request,env){
    try{
        const url=new URL(request.url),ip=request.headers.get('CF-Connecting-IP');
        if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Max-Age':'600'}});
        if(request.method==='GET'&&url.pathname==='/verify')return verificationPage(url,env.TURNSTILE_SITEKEY);
        if(!ip||!env.GRANT_SECRET)return json({error:'Download service unavailable'},503);
        if(url.pathname==='/grant'&&request.method==='POST'){
            if(!(await env.GRANT_LIMIT.limit({key:ip})).success)return json({error:'Wait one minute before retrying'},429);
            // Bound the body even when Content-Length is omitted or falsified.
            const reader=request.body?.getReader();if(!reader)return json({error:'Invalid request'},400);
            let length=0,chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>4096){await reader.cancel();return json({error:'Request too large'},413);}chunks.push(value);}
            const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
            let input;try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'Invalid JSON'},400);}
            const pkg=/^[a-f0-9]{64}$/.test(input.revision??'')&&PACKAGES[input.revision];if(!pkg||!await verifyTurnstile(input.token,ip,env))return json({error:'Verification required'},403);
            const revisions=[input.revision,...(pkg.fallback?[pkg.fallback]:[])],expires=Date.now()+7200000;
            const token=await signGrant({revisions,expires,ip:await ipHash(ip,env.GRANT_SECRET)},env.GRANT_SECRET);
            return json({token,revisions,expires});
        }
        if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed'},405);
        const match=/^\/nextmedtator-models\/([a-f0-9]{64})\/(.+)$/.exec(url.pathname);
        const pkg=match&&PACKAGES[match[1]],size=pkg?.files[match?.[2]];
        if(!Number.isSafeInteger(size)||size<=0||url.search)return json({error:'Unknown artifact'},404);
        if(!await verifyGrant(request.headers.get('Authorization')?.replace(/^Bearer /,''),env.GRANT_SECRET,ip,match[1]))return json({error:'Request this download in NextMedTator to verify access'},403);
        if(!(await env.ARTIFACT_LIMIT.limit({key:ip})).success)return json({error:'Download rate limit; retry shortly'},429);
        const range=request.headers.get('Range'),m=/^bytes=(\d+)-(\d+)$/.exec(range??'');
        // Every data response is bounded to 8 MiB, preventing repeated whole-model requests.
        if(request.method==='GET'&&size>8388608&&!m)return json({error:'Bounded byte range required'},416);
        let start=0,end=size-1;
        if(range){if(!m)return json({error:'Invalid range'},416);start=Number(m[1]);end=Number(m[2]);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=size||end-start+1>8388608)return json({error:'Invalid range'},416);}
        const object=request.method==='HEAD'?await env.MODELS.head(url.pathname.slice(1)):await env.MODELS.get(url.pathname.slice(1),m?{range:{offset:start,length:end-start+1}}:{});
        if(!object)return json({error:'Artifact unavailable'},404);
        const headers={...cors,'Content-Type':'application/octet-stream','Content-Length':String(end-start+1),'ETag':object.httpEtag,'Accept-Ranges':'bytes'};
        if(m)headers['Content-Range']=`bytes ${start}-${end}/${size}`;
        return new Response(request.method==='HEAD'?null:object.body,{status:m?206:200,headers});
    }catch{return json({error:'Download service unavailable. Please retry.'},503);}
}};
