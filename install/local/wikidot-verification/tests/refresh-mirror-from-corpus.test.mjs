import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {parseArgs, planMirrorRefresh} from '../scripts/refresh-mirror-from-corpus.mjs';

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const corpus = {
  'same': {source: 'same body', title: 'Same', tags: ['b', 'a'], run: 'run-1'},
  'stale-source': {source: 'new body', title: 'Stale', tags: ['a'], run: 'run-2'},
  'stale-tags': {source: 'body', title: 'Tags', tags: ['_cc', 'scp'], run: 'run-2'},
  'empty-title': {source: 'body', title: '', tags: [], run: 'run-2'},
  'local-edit': {source: 'corpus body', title: 'Local', tags: [], run: 'run-2'},
};
const read = (slug) => corpus[slug] ?? null;

test('only import-only pages that differ from the corpus are refreshed', () => {
  const {plan, skipped} = planMirrorRefresh([
    {slug: 'same', sourceSha256: sha('same body'), title: 'Same', tags: ['a', 'b'], importOnly: true},
    {slug: 'stale-source', sourceSha256: sha('old body'), title: 'Stale', tags: ['a'], importOnly: true},
    {slug: 'stale-tags', sourceSha256: sha('body'), title: 'Tags', tags: ['scp'], importOnly: true},
    {slug: 'empty-title', sourceSha256: sha('body'), title: 'empty-title', tags: [], importOnly: true},
    {slug: 'local-edit', sourceSha256: sha('edited body'), title: 'Local', tags: [], importOnly: false},
    {slug: 'not-in-corpus', sourceSha256: sha('x'), title: 'X', tags: [], importOnly: true},
  ], read);

  assert.deepEqual(plan, [
    {slug: 'stale-source', run: 'run-2', wikitext: 'new body'},
    {slug: 'stale-tags', run: 'run-2', tags: ['_cc', 'scp']},
  ]);
  assert.deepEqual(skipped, [{slug: 'local-edit', reason: 'has-local-revisions', fields: ['wikitext']}]);
});

test('the refresh only writes with --apply', () => {
  assert.equal(parseArgs(['--corpus-root', '/corpus']).apply, false);
  assert.equal(parseArgs(['--corpus-root', '/corpus', '--apply']).apply, true);
  assert.throws(() => parseArgs([]), /--corpus-root is required/);
});
