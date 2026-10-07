import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../fixtures/',import.meta.url);
const manifest=JSON.parse(fs.readFileSync(new URL('theme-canonical-corpus-v1.json',root),'utf8'));
const source=fs.readFileSync(new URL(manifest.source,root),'utf8');

test('canonical corpus declares controlled site-state dependencies',()=>{
  assert.equal(manifest.schema,'theme_lab_canonical_corpus.v1');
  assert.deepEqual(manifest.site_state_requirements.existing_pages,['run-owned:theme-lab-corpus-existing']);
  assert.deepEqual(manifest.site_state_requirements.missing_pages,['run-owned:theme-lab-corpus-missing']);
  assert.ok(manifest.site_state_requirements.page_tags.includes('theme'));
  assert.ok(manifest.site_state_requirements.session_profiles.includes('anonymous'));
  assert.ok(manifest.site_state_requirements.session_profiles.includes('authenticated'));
});

test('canonical corpus contains probes whose rendering depends on branch/site state',()=>{
  assert.match(source,/\[\[\[run-owned:theme-lab-corpus-existing\|Existing internal page\]\]\]/u);
  assert.match(source,/\[\[\[run-owned:theme-lab-corpus-missing\|Missing internal page\]\]\]/u);
  assert.match(source,/\[\[iftags \+theme\]\]/u);
  assert.match(source,/class="page-rate-widget-box"/u);
  for(const name of ['collapsible','tabview','footnote','math','toc'])assert.match(source,new RegExp(`\\[\\[${name}`, 'u'));
});
