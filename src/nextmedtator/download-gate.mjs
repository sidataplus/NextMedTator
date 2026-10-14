const ORIGIN='https://nmt-models.sidata.plus';
const grants=new Map();
export function clearDownloadGrants(){grants.clear();}
/** The verification dialog exists only during a user-requested public download. */
export async function authorizeDownload(entry,{signal,onStage}={}){
    if(!entry.delivery?.verification)return {};
    if(entry.delivery.origin!==ORIGIN)throw new Error('Unapproved download verification origin');
    if(globalThis.crossOriginIsolated&&!('credentialless' in HTMLIFrameElement.prototype))throw new Error('This browser cannot display verification inside an isolated app. Use current Chrome or Edge for public downloads, or import a local model package.');
    const cached=grants.get(entry.revision);
    if(cached&&cached.expires>Date.now()+60000)return {Authorization:`Bearer ${cached.token}`};
    onStage?.({phase:'Verify to download',detail:'Complete the Cloudflare check. Your notes and device profile are not sent.'});
    const token=await new Promise((resolve,reject)=>{
        if(signal?.aborted){reject(new Error('Download cancelled'));return;}
        const previous=document.activeElement,dialog=document.createElement('dialog'),title=document.createElement('h2'),help=document.createElement('p'),frame=document.createElement('iframe'),cancel=document.createElement('button');
        dialog.setAttribute('aria-label','Verify model download');dialog.style.cssText='max-width:420px;width:calc(100% - 48px);border:1px solid #c5d7dd;border-radius:12px;padding:24px;font:14px/1.5 system-ui;color:#173b49;';
        title.textContent='Verify to download';help.textContent='A quick Cloudflare check helps protect public model downloads. Notes stay on your device.';
        frame.title='Cloudflare download verification';frame.setAttribute('credentialless','');frame.style.cssText='border:0;width:100%;height:170px';
        const nonce=crypto.randomUUID();frame.src=`${ORIGIN}/verify?parent=${encodeURIComponent(location.origin)}&nonce=${nonce}`;
        cancel.textContent='Cancel download';cancel.type='button';
        const finish=(error,value)=>{clearTimeout(timer);window.removeEventListener('message',message);signal?.removeEventListener('abort',abort);dialog.close();dialog.remove();previous?.focus();error?reject(error):resolve(value);};
        const abort=()=>finish(new Error('Download cancelled'));
        const message=event=>{if(event.origin!==ORIGIN||event.source!==frame.contentWindow||event.data?.nonce!==nonce)return;if(typeof event.data.token==='string')finish(null,event.data.token);};
        const timer=setTimeout(()=>finish(new Error('Verification timed out. Retry the download, or import a local model package.')),180000);
        cancel.onclick=abort;dialog.addEventListener('cancel',event=>{event.preventDefault();abort();});signal?.addEventListener('abort',abort,{once:true});window.addEventListener('message',message);
        dialog.append(title,help,frame,cancel);document.body.append(dialog);dialog.showModal();
    });
    onStage?.({phase:'Authorizing download',detail:'Checking the one-time verification token…'});
    const response=await fetch(`${ORIGIN}/grant`,{method:'POST',credentials:'omit',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({token,revision:entry.revision})});
    if(!response.ok)throw new Error(response.status===429?'Too many download requests. Wait a minute, then retry.':'Download verification failed or expired. Please retry.');
    const grant=await response.json();
    if(typeof grant.token!=='string'||!Number.isFinite(grant.expires))throw new Error('Invalid download authorization');
    for(const revision of grant.revisions??[entry.revision])grants.set(revision,grant);
    return {Authorization:`Bearer ${grant.token}`};
}
