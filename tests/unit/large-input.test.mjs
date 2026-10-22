import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OffsetMap} from '../../src/nextmedtator/integrity.mjs';
import {splitWords, locateSpans, documentCoverage} from '../../src/nextmedtator/gliner.mjs';
import {utf16Offset, medtatorSpans, documentKey, legacyRecords, streamingTags, workingCopyReplacer, anchorKey, nativeTagValues} from '../../src/nextmedtator/assist-legacy.mjs';
import {scanLongContext} from '../../src/nextmedtator/long-context.mjs';
import {autoApplyAdvice, raisedThreshold, adviceSummary} from '../../src/nextmedtator/auto-apply-advice.mjs';
import {matchesFilter, formatSize} from '../../src/nextmedtator/assist-batch.mjs';

// Reference: the former per-call code-point scan.
const referenceUtf16=(text,cp)=>{let units=0,seen=0;for(const ch of text){if(seen===cp)return units;units+=ch.length;seen++;}if(seen===cp)return units;throw new Error('outside');};

test('offset maps store no table for BMP text and match the code-point scan for astral text',()=>{
    for(const text of ['plain ASCII clinical note','ไทย é combining','A👩‍⚕️B 😀 diabetes 𝒳']){
        const map=new OffsetMap(text),cps=[...text].length;
        assert.equal(map.length,cps);
        assert.equal(map.cpTo16===null,cps===text.length);
        for(let cp=0;cp<=cps;cp++){assert.equal(map.toUTF16(cp),referenceUtf16(text,cp));assert.equal(map.toCodePoint(map.toUTF16(cp)),cp);}
    }
    const astral=new OffsetMap('a😀b');
    assert.throws(()=>astral.toCodePoint(2),/surrogate/);
    assert.throws(()=>astral.toUTF16(4),/out of bounds/);
    assert.throws(()=>new OffsetMap('bad\ud800'),/Unpaired/);
});

test('one offset map is reused for repeated spans in the same note',()=>{
    const text='fever '.repeat(2000)+'😀';
    assert.equal(new OffsetMap(text),new OffsetMap(text));
    const anchor=[{start:6,end:11,text:'fever'}];
    assert.equal(medtatorSpans(text,anchor),'6~11');
    assert.equal(utf16Offset(text,[...text].length),text.length);
    assert.throws(()=>utf16Offset(text,[...text].length+1),/outside/);
    assert.throws(()=>utf16Offset(text,-1),/Offset required/);
});

test('cached document keys still follow the file name and text',()=>{
    const text='x'.repeat(100000);
    const key=documentKey('a.txt',text);
    assert.equal(documentKey('a.txt',text),key);
    assert.notEqual(documentKey('b.txt',text),key);
    assert.notEqual(documentKey('a.txt',text+'y'),key);
});

test('segmented word splitting is identical to splitting the whole note at once',()=>{
    const sample='Visit https://example.org/path?q=1 or www.test.com; mail jo.doe+x@mail.example.com @user_1 '
        +'well-known foo_bar 😀 ไทย nbsp\ttab\r\nCRLF é x-ray-ready end.  ';
    const text=Array.from({length:40},(_,i)=>sample+i).join('\n');
    const whole=splitWords(text,{segment:Infinity});
    for(const segment of [1,7,64,333])assert.deepEqual(splitWords(text,{segment}),whole);
    assert.deepEqual(splitWords(text),whole);
    const map=new OffsetMap(text);
    for(const word of whole.slice(0,50))assert.equal(map.slice(word.start,word.end).toLowerCase(),word.text);
});

test('located spans and coverage use code points without copying the note',()=>{
    const text='😀 fever and chills',words=splitWords(text);
    const spans=locateSpans(text,words,[{label:'symptom',start:1,end:2,score:.9}],0);
    assert.deepEqual(spans.map(s=>[s.start,s.end,s.text]),[[2,7,'fever']]);
    assert.deepEqual(documentCoverage(text,words,[]),{status:'complete',coverage:[[0,[...text].length]]});
});

test('long-note scans report each window with its own source-anchored records',async()=>{
    const text='fever one. fever two. fever three.';
    const windows=[{start:0,end:10,encodedTokens:3},{start:11,end:21,encodedTokens:3},{start:22,end:text.length,encodedTokens:3}];
    const progress=[];
    await scanLongContext(text,windows,async chunk=>({status:'complete',records:[{id:chunk,family:'finding',anchor:[{start:0,end:5,text:'fever'}],fields:{},score:.9}]}),{overlapPolicy:'allow',onProgress:p=>progress.push(p)});
    assert.deepEqual(progress.map(p=>p.completed),[0,1,2,3]);
    assert.deepEqual(progress.slice(1).map(p=>p.records.map(r=>r.anchor[0].start)),[[0],[11],[22]]);
});

test('streaming tags stay out of evidence sync and working-copy snapshots',()=>{
    const schema={families:{SYMP:{fields:{concept:{type:'text'}}}}};
    const kept={id:'S0',tag:'SYMP',spans:'0~5',text:'fever'},streamed={id:'S1',tag:'SYMP',spans:'10~16',text:'chills'};
    const ann={text:'fever and chills',tags:[kept,streamed],_fh:{}};
    streamingTags.add(streamed);
    assert.deepEqual(legacyRecords(ann,{id:'d',text:ann.text},schema).map(r=>r.id),['S0']);
    const copy=JSON.parse(JSON.stringify(ann,workingCopyReplacer));
    assert.deepEqual(copy.tags.map(t=>t.id),['S0']);assert.equal(copy._fh,null);
    streamingTags.delete(streamed);
    assert.deepEqual(legacyRecords(ann,{id:'d',text:ann.text},schema).map(r=>r.id),['S0','S1']);
    assert.notEqual(anchorKey('SYMP',[{start:0,end:5}]),anchorKey('SYMP',[{start:0,end:4}]));
    assert.notEqual(anchorKey('SYMP',[{start:0,end:5}]),anchorKey('DRUG',[{start:0,end:5}]));
});

test('native Auto Apply values keep model abstention and refuse values outside the schema',()=>{
    const tagDef={attrs:[{name:'id'},{name:'certainty',vtype:'list',values:['positive','negated']},{name:'note',vtype:'text'},{name:'link',vtype:'idref'}]};
    assert.deepEqual(nativeTagValues(tagDef,{fields:{certainty:'negated'}}),{certainty:'negated',note:''});
    assert.equal(nativeTagValues(tagDef,{fields:{certainty:'maybe'}}),null);
    assert.equal(nativeTagValues(tagDef,{fields:{note:['span']}}),null);
});

test('dense Auto Apply runs suggest a stricter threshold or Assisted review',()=>{
    const rows=scores=>scores.map(score=>({score}));
    assert.equal(autoApplyAdvice(rows(Array(10).fill(.9)),{chars:100,threshold:.5}),null,'few tags');
    assert.equal(autoApplyAdvice(rows(Array(30).fill(.95)),{chars:10000,threshold:.5}),null,'sparse and confident');
    const dense=autoApplyAdvice(rows([...Array(20).fill(.52),...Array(10).fill(.9)]),{chars:20000,threshold:.5});
    assert.ok(dense);assert.equal(dense.count,30);assert.equal(dense.nearShare,20/30);
    assert.deepEqual(dense.suggestion,{threshold:.55,kept:10,total:30});
    assert.match(adviceSummary(dense),/30 tags · 1\.5 per 1,000 characters · 67% scored within 0\.1 of the 0\.5 threshold/);
    const crowded=autoApplyAdvice(rows(Array(40).fill(.95)),{chars:1000,threshold:.5});
    assert.ok(crowded);assert.equal(crowded.suggestion,null,'no step removes 30% of uniformly confident tags');
    assert.equal(autoApplyAdvice(rows(Array(40).fill(.55)),{chars:1000,threshold:.5,fixedThreshold:true}).suggestion,null);
    assert.equal(raisedThreshold([.61,.62,.63],.6),null,'never suggests a threshold that leaves nothing');
    assert.deepEqual(raisedThreshold([.61,.62,.9,.95],.6),{threshold:.65,kept:2,total:4});
});

test('batch filters match names and queue status',()=>{
    const ann={_filename:'Notes/Patient-07.txt'};
    assert.ok(matchesFilter(ann,null,{text:'patient-07',status:'new'}));
    assert.ok(!matchesFilter(ann,{status:'completed'},{status:'new'}));
    assert.ok(matchesFilter(ann,{status:'cancelled'},{status:'unfinished'}));
    assert.ok(matchesFilter(ann,{status:'completed',manyTags:true},{status:'many-tags'}));
    assert.ok(!matchesFilter(ann,{status:'failed'},{text:'other'}));
    assert.equal(formatSize(512),'512 B');assert.equal(formatSize(4096),'4 KB');assert.equal(formatSize(3*1048576),'3.0 MB');
});
