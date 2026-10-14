export function downloadStatus({received,total,started,now=performance.now()}){
    const elapsed=(now-started)/1000;
    const speed=elapsed>0?received/elapsed:0;
    const seconds=elapsed>=2&&speed>0?Math.max(0,Math.ceil((total-received)/speed)):null;
    const size=value=>`${(value/1048576).toFixed(1)} MB`;
    const eta=seconds===null?'Estimating time remaining…':seconds<60?`About ${seconds}s remaining`:`About ${Math.ceil(seconds/60)} min remaining`;
    return {percent:Math.min(100,Math.floor(received/total*100)),detail:`${size(received)} / ${size(total)} · ${eta}`};
}

export function batchStatus({completed,total,failed=0,started,now=performance.now()}){
    const seconds=completed>0?Math.ceil(Math.max(0,now-started)/1000/completed*(total-completed)):null;
    const eta=seconds===null?'Estimating time remaining…':seconds<60?`About ${seconds}s remaining`:`About ${Math.ceil(seconds/60)} min remaining`;
    return {percent:Math.min(100,Math.floor(completed/total*100)),detail:`${completed} / ${total} notes ${failed?'processed':'completed'}${failed?` · ${failed} failed`:''} · ${eta}`};
}

/** Visible in the original assistance dock and the portable evidence workspace. */
export function renderLoadingProgress(root,state){
    let box=root.querySelector('[data-testid=loading-progress]');
    if(!state){box?.remove();return;}
    if(!box){
        box=document.createElement('section');box.dataset.testid='loading-progress';box.className='loading-progress';
        const style=document.createElement('style');style.textContent='.loading-progress{margin:0 8px 8px;padding:10px;border:1px solid #d7e1e7;border-radius:6px;background:#fff;flex-shrink:0;font:12px/1.5 system-ui,sans-serif;color:#1a3041}.loading-progress progress{display:block;width:100%;height:12px;margin:6px 0;accent-color:#076b74}.loading-progress strong,.loading-progress small{display:block}.loading-progress small{color:#536976;font-variant-numeric:tabular-nums}';
        const label=document.createElement('strong'),bar=document.createElement('progress'),detail=document.createElement('small');
        label.dataset.part='label';bar.max=100;bar.setAttribute('aria-label','Model loading progress');detail.dataset.part='detail';
        box.append(style,label,bar,detail);
        const message=root.querySelector('[data-testid=assist-message],[data-testid=message]');
        if(message)message.after(box);else (root.querySelector('.dock,.app')??root).append(box);
    }
    const bar=box.querySelector('progress');
    const downloading=state.phase==='Downloading model';
    const batch=Number.isFinite(state.completed);
    const status=state.total?(batch?batchStatus(state):downloading?downloadStatus(state):null):null;
    bar.setAttribute('aria-label',batch?(state.phase==='Analyzing notes'?'Batch analysis progress':'Collection progress'):'Model loading progress');
    box.querySelector('[data-part=label]').textContent=status?`${state.phase} · ${status.percent}%`:state.phase;
    box.querySelector('[data-part=detail]').textContent=status?.detail??'Working on this device. Time depends on model size and available memory.';
    if(status)bar.value=status.percent;else bar.removeAttribute('value');
}
