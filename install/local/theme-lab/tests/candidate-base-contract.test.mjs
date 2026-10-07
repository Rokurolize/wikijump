import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {currentPackageBaseCss} from '../src/candidate-base-contract.mjs';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

test('declared candidate base CSS is required and hash-bound',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'theme-base-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const bytes=Buffer.from('base css');
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({interactive_acceptance:{resolved_stylesheet:{sha256:sha(bytes)}}}));
  assert.throws(()=>currentPackageBaseCss(dir,'fixture'),/requires candidate-base\.css/u);
  fs.writeFileSync(path.join(dir,'candidate-base.css'),bytes);
  assert.deepEqual(currentPackageBaseCss(dir,'fixture'),bytes);
  fs.writeFileSync(path.join(dir,'candidate-base.css'),'changed');
  assert.throws(()=>currentPackageBaseCss(dir,'fixture'),/differs from the resolved stylesheet contract/u);
});

test('undeclared candidate base CSS fails closed',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'theme-base-unbound-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'manifest.json'),'{}');
  assert.equal(currentPackageBaseCss(dir,'fixture'),null);
  fs.writeFileSync(path.join(dir,'candidate-base.css'),'unbound base');
  assert.throws(()=>currentPackageBaseCss(dir,'fixture'),/lacks a resolved stylesheet contract/u);
});
