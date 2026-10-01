import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {readBoundArtifact} from '../src/artifact-binding.mjs';

test('compressed artifact bindings fail closed for unknown encoding and absent native hash',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-gzip-'));
 try {
  const bytes=gzipSync(Buffer.from('{"native":true}\n'));
  fs.writeFileSync(path.join(root,'audit.json.gz'),bytes);
  const binding={path:'audit.json.gz',sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  assert.throws(()=>readBoundArtifact(root,{...binding,encoding:'gzip'},'audit'),/expanded binding/);
  assert.throws(()=>readBoundArtifact(root,{...binding,encoding:'zip'},'audit'),/invalid artifact encoding/);
  assert.throws(()=>readBoundArtifact(root,{...binding,path:'../escape.gz'},'audit'),/escapes Theme Lab/);
 } finally {fs.rmSync(root,{recursive:true,force:true})}
});
