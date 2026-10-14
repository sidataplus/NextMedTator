// A dedicated non-isolated page carries no notes and imports no application code.
// BroadcastChannel crosses browsing-context groups without an opener reference.
const origin='https://nmt-models.sidata.plus',nonce=location.hash.slice(1);
const status=document.querySelector('#status'),frame=document.querySelector('iframe');
const close=document.querySelector('#close');
if(!/^[a-f0-9-]{36}$/.test(nonce)||!globalThis.BroadcastChannel){
    status.textContent='Open this check using the download button in NextMedTator.';frame.remove();
    close.addEventListener('click',()=>window.close());
}else{
    const channel=new BroadcastChannel('nmt-download-'+nonce);let timer,timeout,closed=false;
    const cleanup=()=>{if(closed)return;closed=true;clearInterval(timer);clearTimeout(timeout);channel.close();window.removeEventListener('message',forward);};
    close.addEventListener('click',()=>{if(closed){window.close();return;}channel.postMessage({nonce,cancelled:true});status.textContent='Cancelling download…';setTimeout(()=>window.close(),500);});
    const forward=event=>{
        if(event.origin!==origin||event.source!==frame.contentWindow||event.data?.nonce!==nonce||typeof event.data.token!=='string'||event.data.token.length>2048)return;
        window.removeEventListener('message',forward);frame.hidden=true;
        const message={nonce,token:event.data.token};
        status.textContent='Verified. Connecting to your download…';
        channel.postMessage(message);timer=setInterval(()=>channel.postMessage(message),500);
        clearTimeout(timeout);timeout=setTimeout(()=>{cleanup();status.textContent='The download tab is no longer waiting. Return there and start the download again.';},15000);
    };
    channel.onmessage=event=>{if(event.data?.nonce!==nonce)return;if(event.data.received===true||event.data.cancelled===true){cleanup();status.textContent=event.data.cancelled?'Download cancelled. You can close this tab.':'Verification complete. Return to NextMedTator; your download is continuing.';frame.remove();window.close();}};
    window.addEventListener('message',forward);window.addEventListener('pagehide',()=>{if(!closed)channel.postMessage({nonce,cancelled:true});cleanup();},{once:true});
    frame.src=`${origin}/verify?parent=${encodeURIComponent(location.origin)}&nonce=${nonce}`;
    status.textContent='Complete the check above if prompted.';
    timeout=setTimeout(()=>{cleanup();window.removeEventListener('message',forward);frame.remove();status.textContent='This check expired. Return to NextMedTator and retry the download.';},180000);
}
