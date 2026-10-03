import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utf16Offset, medtatorSpans, documentKey, preferredTag, attributeDraft } from '../../src/nextmedtator/assist.mjs';
test('code-point spans become MedTator UTF-16 spans', () => {
    const text = 'A👩‍⚕️B diabetes';
    const chars = [...text];
    const start = chars.indexOf('d');
    assert.equal(chars.slice(start, start + 8).join(''), 'diabetes');
    assert.equal(utf16Offset(text, start), text.indexOf('diabetes'));
    assert.equal(medtatorSpans(text, [{ start, end: start + 8, text: 'diabetes' }]), `${text.indexOf('diabetes')}~${text.indexOf('diabetes') + 8}`);
    assert.notEqual(start, text.indexOf('diabetes'));
});
test('document keys change when the source text changes', () => {
    assert.equal(documentKey('note.txt', 'alpha'), documentKey('note.txt', 'alpha'));
    assert.notEqual(documentKey('note.txt', 'alpha'), documentKey('note.txt', 'alpha.'));
});
test('entity tag preference uses the schema name and otherwise the only span tag', () => {
    const tags = [{ name: 'SYMP' }, { name: 'DOC', is_non_consuming: true }];
    assert.equal(preferredTag('condition_occurrence', tags), 'SYMP');
    assert.equal(preferredTag('SYMP', tags), 'SYMP');
    assert.equal(preferredTag('condition_occurrence', [{ name: 'SYMP' }, { name: 'DRUG' }]), '');
});
test('attribute copy matches names and leaves unrelated schema defaults', () => {
    const attrs = [
        { name: 'id', vtype: 'text', default_value: '' },
        { name: 'certainty', vtype: 'list', values: ['positive', 'negated', 'possible'], default_value: 'positive' },
        { name: 'comment', vtype: 'text', default_value: 'NA' },
        { name: 'from', vtype: 'idref', default_value: '' }
    ];
    const fields = { concept: 'diabetes', assertion: 'negated', experiencer: 'patient', comment: 'family history' };
    const draft = attributeDraft(attrs, fields);
    assert.equal(draft.values.certainty, 'positive');
    assert.equal(draft.values.comment, 'family history');
    assert.equal(draft.values.from, undefined);
    assert.deepEqual(draft.unmatched.sort(), ['assertion', 'experiencer']);
});
