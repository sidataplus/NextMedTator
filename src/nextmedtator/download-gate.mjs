const ORIGIN='https://nmt-models.sidata.plus';
const grants=new Map();
export function clearDownloadGrants(){grants.clear();}
/** The verification dialog exists only during a user-requested public download. */
export async function authorizeDownload(entry,{signal,onStage}={}){
    if(!entry.delivery?.verification)return {};
    if(entry.delivery.origin!==ORIGIN)throw new Error('Unapproved download verification origin');
    const separateTab=globalThis.crossOriginIsolated&&!('credentialless' in HTMLIFrameElement.prototype);
    const cached=grants.get(entry.revision);
    if(cached&&cached.expires>Date.now()+60000)return {Authorization:`Bearer ${cached.token}`};
    onStage?.({phase:'Verify to download',detail:'Complete the Cloudflare check. Your notes and device profile are not sent.'});
    const token=await new Promise((resolve,reject)=>{
        if(signal?.aborted){reject(new Error('Download cancelled'));return;}
        const previous=document.activeElement,dialog=document.createElement('dialog'),title=document.createElement('h2'),help=document.createElement('p'),frame=document.createElement('iframe'),cancel=document.createElement('button');
        dialog.setAttribute('aria-label','Verify model download');dialog.style.cssText='max-width:420px;width:calc(100% - 48px);border:1px solid #c5d7dd;border-radius:2px;padding:24px;font:14px/1.5 system-ui;color:#173b49;';
        title.textContent='Verify to download';help.textContent='A quick Cloudflare check helps protect public model downloads. Notes stay on your device.';
        frame.title='Cloudflare download verification';frame.setAttribute('credentialless','');frame.style.cssText='border:0;width:100%;height:170px';
        const nonce=crypto.randomUUID();if(!separateTab)frame.src=`${ORIGIN}/verify?parent=${encodeURIComponent(location.origin)}&nonce=${nonce}`;
        cancel.textContent='Cancel download';cancel.type='button';
        let settled=false;const channel=globalThis.BroadcastChannel?new BroadcastChannel('nmt-download-'+nonce):null;
        const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)channel?.postMessage({nonce,cancelled:true});channel?.close();window.removeEventListener('message',message);signal?.removeEventListener('abort',abort);dialog.close();dialog.remove();previous?.focus();error?reject(error):resolve(value);};
        const abort=()=>finish(new Error('Download cancelled'));
        const message=event=>{if(event.origin!==ORIGIN||event.source!==frame.contentWindow||event.data?.nonce!==nonce)return;if(typeof event.data.token==='string'&&event.data.token.length<=2048)finish(null,event.data.token);};
        const timer=setTimeout(()=>finish(new Error('This check expired. Click Download to try again.')),180000);
        const open=document.createElement('button');open.type='button';open.textContent='Open verification tab';open.style.cssText='padding:8px 12px;margin:0 8px 12px 0;background:#0078d7;color:white;border:0';
        open.addEventListener('click',()=>{window.open(new URL('../../download-verification.html#'+nonce,import.meta.url),'_blank','noopener');help.textContent='Complete the check in the new tab, then return here. Your download will continue automatically. If no tab opened, allow pop-ups for this site and try again.';});
        if(channel)channel.onmessage=event=>{if(event.data?.nonce!==nonce)return;if(event.data.cancelled===true){abort();return;}if(typeof event.data.token!=='string'||event.data.token.length>2048)return;channel.postMessage({nonce,received:true});finish(null,event.data.token);};
        if(separateTab){help.textContent='Complete a quick check in a new tab, then your download will continue here. Your notes stay in this tab.';frame.hidden=true;}
        cancel.onclick=abort;dialog.addEventListener('cancel',event=>{event.preventDefault();abort();});signal?.addEventListener('abort',abort,{once:true});window.addEventListener('message',message);
        dialog.append(title,help,frame,...(channel?[open]:[]),cancel);document.body.append(dialog);dialog.showModal();
    });
    onStage?.({phase:'Authorizing download',detail:'Checking the one-time verification token…'});
    const response=await fetch(`${ORIGIN}/grant`,{method:'POST',credentials:'omit',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({token,revision:entry.revision})});
    if(!response.ok)throw new Error(response.status===429?'Too many download requests. Wait a minute, then retry.':'Download verification failed or expired. Please retry.');
    const grant=await response.json();
    if(typeof grant.token!=='string'||!Number.isFinite(grant.expires))throw new Error('Invalid download authorization');
    for(const revision of grant.revisions??[entry.revision])grants.set(revision,grant);
    return {Authorization:`Bearer ${grant.token}`};
}
