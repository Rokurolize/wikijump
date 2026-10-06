import test from 'node:test';
import assert from 'node:assert/strict';
import {stringifyAsciiJson} from '../src/ascii-json.mjs';

test('socket JSON escapes Unicode without changing parsed text', () => {
  const value = {css: '日本語のテーマ🌙', source: 'é漢字'};
  const encoded = stringifyAsciiJson(value);
  assert.match(encoded, /^[\x00-\x7f]*$/u);
  assert.deepEqual(JSON.parse(encoded), value);
});
