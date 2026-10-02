import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextareaOffsetMap } from '../../src/nextmedtator/integrity.mjs';
test('textarea normalization is an explicit derived view, not source mutation', () => { const source = 'a\r\nไทย 👩‍⚕️ diabetes\rnext'; const map = new TextareaOffsetMap(source); assert.equal(map.view, 'a\nไทย 👩‍⚕️ diabetes\nnext'); const a = map.view.indexOf('diabetes'); const span = map.selection(a, a + 8); assert.equal(span.text, 'diabetes'); assert.equal(Array.from(source).slice(span.start, span.end).join(''), 'diabetes'); assert.equal(map.viewOffset(span.start), a); });
test('selection cannot split a surrogate, combining mark or ZWJ grapheme', () => { const m = new TextareaOffsetMap('👩‍⚕️ e\u0301'); assert.throws(() => m.selection(0, 1)); assert.throws(() => m.selection(0, 2)); assert.throws(() => m.selection(6, 7)); assert.equal(m.selection(0, 5).text, '👩‍⚕️'); });
test('CRLF internal boundary cannot be silently shifted for display', () => { const m = new TextareaOffsetMap('a\r\nb'); assert.throws(() => m.viewOffset(2), /normalized line ending/); });
