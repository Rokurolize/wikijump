import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {withAuditLock} from '../ports/scripts/audit-lock.mjs';

test('audit lock serializes concurrent read-modify-write operations', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'theme-audit-lock-'));
 const audit=path.join(dir,'audit.json');
 await fs.writeFile(audit,JSON.stringify({value:0}));
 try{
  await Promise.all(Array.from({length:8},()=>withAuditLock(audit,async()=>{
   const document=JSON.parse(await fs.readFile(audit,'utf8'));
   await new Promise(resolve=>setTimeout(resolve,5));
   document.value++;
   const temp=`${audit}.${process.pid}.${document.value}.tmp`;
   await fs.writeFile(temp,JSON.stringify(document));
   await fs.rename(temp,audit);
  })));
  assert.equal(JSON.parse(await fs.readFile(audit,'utf8')).value,8);
 }finally{
  await fs.rm(dir,{recursive:true,force:true});
 }
});

test('audit lock reclaims a stale lock owned by a dead process', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'theme-audit-lock-stale-'));
 const audit=path.join(dir,'audit.json');
 await fs.writeFile(audit,JSON.stringify({value:0}));
 await fs.writeFile(`${audit}.lock`,JSON.stringify({pid:99_999_999,started_at:'2020-01-01T00:00:00.000Z'}));
 try{
  await withAuditLock(audit,async()=>fs.writeFile(audit,JSON.stringify({value:1})),{pollMs:1,staleMs:0,attempts:20});
  assert.equal(JSON.parse(await fs.readFile(audit,'utf8')).value,1);
  await assert.rejects(fs.access(`${audit}.lock`));
 }finally{
  await fs.rm(dir,{recursive:true,force:true});
 }
});
