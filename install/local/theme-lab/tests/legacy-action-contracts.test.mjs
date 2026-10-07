import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {legacyEquivalentContractHashes} from '../src/legacy-action-contracts.mjs';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const contract={action:'unchanged',expandMobileTopSubmenu:null,expandTabletTopNavigation:null,navigationActivation:null,renderedSubmenuGeometry:null,visualDiagnostics:'unchanged observer'};

test('only evidenced absent null navigation fields reproduce legacy serialization',()=>{
  const alternatives=legacyEquivalentContractHashes(contract);
  const withoutGeometry={...contract};delete withoutGeometry.renderedSubmenuGeometry;
  assert.deepEqual(alternatives,[hash(contract),hash(withoutGeometry),hash({action:'unchanged',visualDiagnostics:'unchanged observer'})]);
  assert.ok(!alternatives.includes(hash({...contract,visualDiagnostics:'changed observer'})));
  assert.ok(!alternatives.includes(hash({...contract,action:'changed action'})));
});

test('active navigation and required credit/sidebar helpers cannot be omitted',()=>{
  for(const key of ['expandMobileTopSubmenu','expandTabletTopNavigation','navigationActivation','renderedSubmenuGeometry']){
    const active={...contract,[key]:'required current helper'};
    const omitted={...active};delete omitted[key];
    assert.ok(!legacyEquivalentContractHashes(active).includes(hash(omitted)));
  }
  for(const key of ['openCreditView','openCreditOtherwise','sidebarIsClosed','sidebarOccupiesViewport']){
    const active={...contract,[key]:'required current helper'};
    assert.ok(!legacyEquivalentContractHashes(active).includes(hash(contract)));
  }
});

test('serialization history retains exact immutable Git source excerpts',()=>{
  const root=new URL('../evidence/browser-action-contract-formats/',import.meta.url);
  const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',root)));
  assert.equal(manifest.formats.length,5);
  for(const row of manifest.formats){
    const body=fs.readFileSync(new URL(row.path,root));
    assert.equal(crypto.createHash('sha256').update(body).digest('hex'),row.sha256);
  }
});
