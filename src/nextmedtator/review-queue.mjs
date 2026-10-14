export function suggestionPage(records,decisions,{family='all',status='all',page=0,size=20}={}){
    const filtered=records.filter(r=>(family==='all'||r.family===family)&&(status==='all'||(decisions[r.id]?.status??'unreviewed')===status));
    const pages=Math.max(1,Math.ceil(filtered.length/size)),index=Math.max(0,Math.min(page,pages-1));
    return {records:filtered.slice(index*size,(index+1)*size),total:filtered.length,page:index,pages,size};
}

/** Undo removes only unchanged tags created by the recorded assistance action. */
export function validateUndoTags(tags,added){
    const ids=new Set(added.map(t=>t.id));
    for(const expected of added){const actual=tags.find(t=>t.id===expected.id);if(!actual||JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('An added tag was edited or removed. Resolve it manually before undoing this assistance action.');}
    for(const tag of tags)if(!ids.has(tag.id)&&Object.values(tag).some(value=>typeof value==='string'&&ids.has(value)))throw new Error('Another annotation refers to an added tag. Remove that link before undoing.');
    return tags.filter(t=>!ids.has(t.id));
}
