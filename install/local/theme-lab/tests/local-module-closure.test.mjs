import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

import {localModuleClosure,localModuleClosureSha256} from '../src/local-module-closure.mjs';

test('target acceptance program closure follows local static module dependencies deterministically',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..');
  const entry=new URL('../src/session-server.mjs',import.meta.url);
  const rows=localModuleClosure(entry,{root});
  const names=rows.map(row=>row.path);
  for(const required of ['src/session-server.mjs','src/browser-lab.mjs','src/verdict.mjs','src/target-baseline-viewport-probe.mjs','src/target-acceptance-contract.mjs'])assert.ok(names.includes(required),`missing ${required}`);
  assert.equal(new Set(names).size,names.length);
  assert.deepEqual(names,[...names].sort((a,b)=>a.localeCompare(b)));
  assert.match(localModuleClosureSha256(entry,{root}),/^[0-9a-f]{64}$/u);
});

test('local module closure rejects a dependency symlink escaping its contract root',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-module-closure-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'theme-module-outside-'));
  try{
    const entry=path.join(root,'entry.mjs'),outsideModule=path.join(outside,'outside.mjs');
    fs.writeFileSync(outsideModule,'export const outside = true;\n');
    fs.symlinkSync(outsideModule,path.join(root,'linked.mjs'));
    fs.writeFileSync(entry,"import './linked.mjs';\n");
    assert.throws(()=>localModuleClosure(pathToFileURL(entry),{root}),/escapes contract root/u);
  }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});
