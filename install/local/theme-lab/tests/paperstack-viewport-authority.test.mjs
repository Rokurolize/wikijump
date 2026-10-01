import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest, validateAuthority, verifyEvidence} from '../src/adaptation-authority.mjs';

const ports=fileURLToPath(new URL('../ports/',import.meta.url));
const ledger=JSON.parse(fs.readFileSync(path.join(ports,'adaptation-authority.json'),'utf8'));
const authority=ledger.packages.paperstack.blocks.find(row=>row.marker==='SCP-JP Wikidot navigation correction: paperstack rightmost submenu anchors.');

test('Paperstack viewport authority accepts fractional centered geometry from retained Wikidot A/B',()=>{
  validateAuthority(authority);
  const evidencePath=authority.evidence[0].path;
  const receiptFile=path.join(ports,evidencePath);
  const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
  assert.equal(digest(fs.readFileSync(receiptFile)),authority.evidence[0].sha256);
  verifyEvidence([authority]);
  const themed=receipt.rows.filter(row=>row.variant==='with');
  assert.equal(themed.length,8);
  assert.deepEqual([...new Set(themed.map(row=>row.width))],[320,390]);
  for(const row of themed) {
    assert.equal(row.pass,true);
    assert.equal(row.measurement.viewport_width,row.width);
    assert.ok(row.bounds.every(bounds=>bounds.pass));
  }

  const centered=JSON.parse(fs.readFileSync(path.join(ports,'authority-evidence/paperstack-current-package-acceptance-remeasured/receipt.json'),'utf8'));
  const page=row=>row.measurement.rows.find(probe=>probe.selector==='#page-content').rect;
  for(const row of centered.rows.filter(row=>row.variant==='with'&&row.width===390)) {
    const rect=page(row);
    assert.equal(rect.left,19.5);
    assert.equal(rect.right,370.5);
    assert.equal(rect.left,(row.measurement.viewport_width-rect.width)/2);
  }
});
