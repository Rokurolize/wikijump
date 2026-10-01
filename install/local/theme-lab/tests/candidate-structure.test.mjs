import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadCandidateStructure} from '../src/candidate-structure.mjs';
test('source-owned structure is bound to both preserved source and rendered excerpt',async()=>{
 const original=new URL('../ports/monotypical/',import.meta.url);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'theme-structure-'));
 try{
  const spec=JSON.parse(await fs.readFile(new URL('acceptance-structure.json',original),'utf8'));
  for(const name of ['acceptance-structure.json',spec.source_file,spec.upstream_file,spec.excerpt.path,spec.html.path])await fs.copyFile(new URL(name,original),path.join(dir,name));
  assert.match((await loadCandidateStructure(dir)).html,/u-sb-button/u);
  await fs.appendFile(path.join(dir,spec.html.path),'<a>invented control</a>');
  await assert.rejects(loadCandidateStructure(dir),/stale or differs/);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
