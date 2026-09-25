import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateIdentity } from '../ports/scripts/candidate-identity.mjs';

test('candidate identity preserves the known legacy combined key without a base layer', () => {
  const css = '#header { color: teal }';
  const legacy = candidateIdentity(css, '');
  assert.equal(candidateIdentity(css, '', new Set([legacy.combinedSha])).candidateSha, legacy.combinedSha);
});

test('candidate identity prefers the raw CSS key when that identity is already known', () => {
  const css = '#header { color: teal }';
  const first = candidateIdentity(css, '');
  assert.equal(candidateIdentity(css, '', new Set([first.rawSha, first.combinedSha])).candidateSha, first.rawSha);
});

test('a base CSS layer always binds both CSS byte streams', () => {
  const css = '#header { color: teal }';
  const result = candidateIdentity(css, 'body { margin: 0 }', new Set([candidateIdentity(css, '').rawSha]));
  assert.equal(result.candidateSha, result.combinedSha);
  assert.notEqual(result.candidateSha, result.rawSha);
});
