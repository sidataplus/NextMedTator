import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conformanceSummary,conformanceMessage} from '../../src/nextmedtator/conformance-report.mjs';
import {compareEntityContractRecords} from '../../src/nextmedtator/entity-contract.mjs';

test('score-only drift is quantified separately from changed predictions without loosening acceptance',()=>{
    const expected=[{family:'finding',anchor:[{start:0,end:5,text:'fever'}],fields:{assertion:'affirmed'},score:.9,attributeScores:{assertion:.8}}];
    const actual=structuredClone(expected);actual[0].attributeScores.assertion+=.003;
    const check=compareEntityContractRecords(expected,actual);
    assert.equal(check.pass,false);assert.equal(check.reason,'confidence-scores-differ');assert.equal(check.tolerance,.0001);assert.ok(check.maxScoreError>.0029);
    const summary=conformanceSummary({pass:false,backend:'webgpu',precision:'fp16',results:[{fixture:'synthetic-0.json',pass:false,nativeChecks:check,records:actual,sourceText:'PRIVATE_NOTE_MUST_NOT_LEAK',encodedTokensMatch:true}]});
    assert.match(conformanceMessage(summary),/spans and attributes match/);assert.match(conformanceMessage(summary),/0.0001/);
    assert.doesNotMatch(JSON.stringify(summary),/PRIVATE|fever|affirmed/);
    actual[0].fields.assertion='negated';assert.equal(compareEntityContractRecords(expected,actual).reason,'attribute-values-or-presence-differ');
    assert.equal(compareEntityContractRecords(expected,[]).reason,'entity-spans-differ');
    assert.throws(()=>compareEntityContractRecords(expected,actual,{tolerance:NaN}),/tolerance/);
});

test('non-finite confidence cannot pass or be mislabeled as harmless drift',()=>{
    const row={family:'x',anchor:[],fields:{},score:.5},actual={...row,score:NaN};
    const check=compareEntityContractRecords([row],[actual]);assert.equal(check.reason,'non-finite-score');assert.equal(check.pass,false);
    const summary=conformanceSummary({pass:false,results:[{pass:false,fixture:'f.json',nativeChecks:check}]});
    assert.equal(summary.fixtures[0].records.maxScoreError,null);assert.match(conformanceMessage(summary),/non-finite/);
});
