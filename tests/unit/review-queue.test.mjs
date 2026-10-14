import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestionPage,validateUndoTags} from '../../src/nextmedtator/review-queue.mjs';
test('review pagination bounds DOM work and combines family/status filters',()=>{
    const records=Array.from({length:1000},(_,i)=>({id:String(i),family:i%2?'a':'b'}));
    const decisions={'1':{status:'rejected'}};
    assert.equal(suggestionPage(records,decisions).records.length,20);
    assert.deepEqual(suggestionPage(records,decisions,{family:'a',status:'rejected',page:100}).records,[records[1]]);
    assert.equal(suggestionPage(records,decisions,{status:'unreviewed'}).total,999);
});
test('undo preserves unrelated tags and refuses edited or referenced additions',()=>{
    const added=[{id:'a',text:'fever'}],tags=[{id:'human',text:'cough'},...added];
    assert.deepEqual(validateUndoTags(tags,added),[tags[0]]);
    assert.throws(()=>validateUndoTags([{id:'a',text:'changed'}],added),/edited/);
    assert.throws(()=>validateUndoTags([...tags,{id:'link',target:'a'}],added),/refers/);
});
