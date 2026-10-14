import {invariant,OffsetMap,canonical} from './integrity.mjs';
import {resolveOverlapsFlat} from './vendor/gliner25/gliner-boundary.mjs';

export const LONG_CONTEXT_POLICY='gliner25-overlapping-windows-v1';
export const LONG_CONTEXT_SETTINGS=Object.freeze({contextPolicy:LONG_CONTEXT_POLICY,chunkWords:384,wordOverlap:64});

/** GLiNER2.5-style word windows, additionally bounded by the complete encoded prompt.
 * Store ranges only; at most one window's packed tensors are retained at a time.
 * The caller supplies the model's own splitter, so punctuation/Unicode stay exact.
 */
export function planLongContext(text,{split,pack,maxWords=384,chunkWords=384,wordOverlap=64}){
    invariant(Number.isInteger(chunkWords)&&chunkWords>0&&Number.isInteger(wordOverlap)&&wordOverlap>=0,'Invalid window settings');
    const words=split(text),windows=[];
    invariant(words.length,'The note must not be empty');
    if(words.length<=maxWords){const full=pack(text);if(full.supported)return [{start:0,end:text.length,wordStart:0,wordEnd:words.length,encodedTokens:full.encodedTokens}];}
    for(let start=0;start<words.length;){
        const begin=start===0?0:words[start].start;
        const endAt=n=>n===words.length?text.length:words[n].start;
        let lo=start+1,hi=Math.min(words.length,start+Math.min(chunkWords,maxWords)),best=start,encodedTokens=0;
        while(lo<=hi){const end=(lo+hi)>>1,plan=pack(text.slice(begin,endAt(end)));if(plan.supported){best=end;encodedTokens=plan.encodedTokens;lo=end+1;}else hi=end-1;}
        invariant(best>start,'A word plus the complete model prompt exceeds the encoded window; split that token before analysis');
        // Prefer a sentence or section boundary near the end, without making tiny windows.
        if(best<words.length){for(let end=best;end>start+Math.max(wordOverlap+1,Math.floor((best-start)*.75));end--){const gap=text.slice(words[end-1].end,words[end].start);if(/[\r\n]/.test(gap)||/[.!?]$/.test(words[end-1].text)){const plan=pack(text.slice(begin,endAt(end)));if(plan.supported){best=end;encodedTokens=plan.encodedTokens;break;}}}}
        windows.push({start:begin,end:endAt(best),wordStart:start,wordEnd:best,encodedTokens});
        if(best===words.length)break;
        start=Math.max(start+1,best-Math.min(wordOverlap,Math.floor((best-start)/2)));
    }
    return windows;
}

/** Keep attributes from the winning occurrence together; never mix conflicting heads. */
export function mergeWindowRecords(records,overlapPolicy){
    const distinct=new Map();
    for(const record of records){const key=canonical([record.family,record.anchor]);const old=distinct.get(key);if(!old||record.score>old.score)distinct.set(key,record);}
    let result=[...distinct.values()];
    if(overlapPolicy==='flat'){
        const families=new Map();for(const r of result){if(!families.has(r.family))families.set(r.family,[]);families.get(r.family).push({...r,start:r.anchor[0].start,end:r.anchor.at(-1).end});}
        result=[...families.values()].flatMap(rows=>resolveOverlapsFlat(rows).map(({start,end,...record})=>record));
    }
    return result.sort((a,b)=>a.anchor[0].start-b.anchor[0].start||a.anchor[0].end-b.anchor[0].end||a.family.localeCompare(b.family));
}

export async function scanLongContext(text,windows,analyze,{overlapPolicy,onProgress}={}){
    const source=new OffsetMap(text),records=[],receipt=[];
    for(const [index,window]of windows.entries()){
        onProgress?.({phase:'Analyzing note windows',completed:index,total:windows.length});
        const part=await analyze(text.slice(window.start,window.end));
        invariant(part.status==='complete','A planned window did not complete');
        const offset=source.toCodePoint(window.start);
        for(const r of part.records)records.push({...r,anchor:r.anchor.map(s=>source.span(s.start+offset,s.end+offset)),origin:{...r.origin,windowIndex:index}});
        receipt.push({sourceRange:[offset,source.toCodePoint(window.end)],encodedTokens:window.encodedTokens});
    }
    onProgress?.({phase:'Analyzing note windows',completed:windows.length,total:windows.length});
    return {records:mergeWindowRecords(records,overlapPolicy),status:'complete',coverage:[[0,source.length]],windows:receipt,...LONG_CONTEXT_SETTINGS,overlapPolicy,notice:'Long-note analysis uses overlapping GLiNER2.5 windows. Attributes use local window context; mentions whose endpoints never fit together cannot be joined.',limitations:['window-local-context','cross-window-relations','cross-window-mention-stitching','annotation-defaults-not-inferred','record-binding-unsupported','relations-unsupported']};
}
