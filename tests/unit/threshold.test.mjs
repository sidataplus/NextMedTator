import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestionThreshold} from '../../src/nextmedtator/threshold.mjs';

test('user threshold takes precedence without changing frozen model or scope defaults',()=>{
    const model=Object.freeze({threshold:.6}),scope=Object.freeze({threshold:.7});
    assert.deepEqual(suggestionThreshold(null,null,model),{threshold:.6,thresholdSource:'model'});
    assert.deepEqual(suggestionThreshold(null,scope,model),{threshold:.7,thresholdSource:'scope'});
    const run=Object.freeze(suggestionThreshold('0.9',scope,model));
    assert.deepEqual(suggestionThreshold('0',scope,model),{threshold:0,thresholdSource:'user'});
    assert.equal(suggestionThreshold('1',scope,model).threshold,1);
    assert.equal(run.threshold,.9);
    assert.equal(scope.threshold,.7);
    assert.equal(model.threshold,.6);
});
test('invalid input cannot silently become zero or run with a default',()=>{
    for(const value of ['', ' ', 'abc', 'NaN', 'Infinity', -.01, 1.01, NaN, Infinity, false])
        assert.throws(()=>suggestionThreshold(value,null,{threshold:.6}),/between 0 and 1/);
    assert.equal(suggestionThreshold(null,null,{}).threshold,.5);
});
