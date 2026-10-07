import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateAuthority} from '../src/adaptation-authority.mjs';
const ports=fileURLToPath(new URL('../ports/',import.meta.url));
const ledger=JSON.parse(fs.readFileSync(path.join(ports,'adaptation-authority.json'),'utf8'));
const compact=JSON.parse(fs.readFileSync(new URL('./fixtures/wikidot-adaptation-semantic.json',import.meta.url),'utf8'));
const authority=ledger.packages.paperstack.blocks.find(row=>row.marker==='SCP-JP Wikidot navigation correction: paperstack rightmost submenu anchors.');

test('Paperstack viewport authority accepts fractional centered geometry from retained Wikidot A/B',()=>{
  validateAuthority(authority);
  assert.deepEqual(compact.paperstack.authority_binding,authority.evidence[0]);
  assert.equal(compact.paperstack.authority_source_sha256,authority.evidence[0].sha256);
  const themed=compact.paperstack.authority_rows.filter(row=>row.variant==='with');
  assert.equal(themed.length,8);
  assert.deepEqual([...new Set(themed.map(row=>row.width))],[320,390]);
  for(const row of themed){
    assert.equal(row.pass,true);
    assert.equal(row.viewport_width,row.width);
    assert.ok(row.bounds_pass.every(Boolean));
  }
  for(const row of compact.paperstack.centered_rows.filter(row=>row.variant==='with'&&row.width===390)){
    const rect=row.page_rect;
    assert.equal(rect.left,19.5);
    assert.equal(rect.right,370.5);
    assert.equal(rect.left,(row.viewport_width-rect.width)/2);
  }
});
