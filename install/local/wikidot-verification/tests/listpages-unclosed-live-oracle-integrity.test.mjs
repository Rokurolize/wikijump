import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const fixture = new URL('../artifacts/listpages-campaign-generated-live-preview.jsonl', import.meta.url);
const expectedFixtureSha = '7da22f7f2650c16903616c13569b2aaee7c7b7205a41d5e06beab0f5e83464e0';
const expected = [
  {
    id: 'lpgen-0140-syntax-whitespace-malformed',
    source: '[[module ListPages category="fragment"]]\n%%title%%',
    openerExecuted: true,
  },
  {
    id: 'lpgen-0141-syntax-whitespace-malformed',
    source: '[[module ListPages category="fragment"\n%%title%%',
    openerExecuted: false,
  },
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('two external unclosed-ListPages oracles retain their original source and render provenance', () => {
  const bytes = readFileSync(fixture);
  assert.equal(sha256(bytes), expectedFixtureSha, 'frozen PagePreview capture bytes must not drift');
  const observations = bytes.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  for (const entry of expected) {
    const rows = observations.filter((row) => row.syntax_case?.case_id === entry.id);
    assert.equal(rows.length, 1, `expected one independent capture for ${entry.id}`);
    const row = rows[0];
    assert.equal(row.syntax_case.source, entry.source);
    assert.equal(row.syntax_case.wikidot_observation_tier, 'page-preview');
    assert.equal(row.provenance.module, 'edit/PagePreviewModule');
    assert.equal(row.provenance.authenticated, false);
    assert.equal(row.provenance.mutated, false);
    assert.equal(sha256(row.raw_html), row.raw_html_sha256);
    if (entry.openerExecuted) {
      assert.match(row.raw_html, /<div class="list-pages-box">/u);
      assert.match(row.raw_html, /<p>%%title%%<\/p>/u);
      assert.doesNotMatch(row.raw_html, /\[\[module ListPages/u);
    } else {
      assert.doesNotMatch(row.raw_html, /list-pages-box/u);
      assert.match(row.raw_html, /\[\[module ListPages category=&quot;fragment&quot;/u);
      assert.match(row.raw_html, /%%title%%/u);
    }
  }
});
