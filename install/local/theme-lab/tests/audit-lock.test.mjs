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
  await assert.rejects(fs.access(`${audit}.lock.recovery`));
 }finally{
  await fs.rm(dir,{recursive:true,force:true});
 }
});

test('stale recovery gate prevents unlinking a replacement lock', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'theme-audit-lock-gate-'));
 const audit=path.join(dir,'audit.json');
 const lock=`${audit}.lock`;
 await fs.writeFile(audit,'0');
 await fs.writeFile(lock,JSON.stringify({pid:99_999_999,started_at:'2020-01-01'}));
 await fs.mkdir(`${lock}.recovery`);
 await fs.writeFile(`${lock}.recovery/owner`,JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));
 let acquired=false;
 const waiter=withAuditLock(audit,async()=>{acquired=true},{pollMs:1,staleMs:0,attempts:500});
 try{
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(acquired,false);
  assert.equal(JSON.parse(await fs.readFile(lock,'utf8')).pid,99_999_999);
  await fs.access(`${lock}.recovery`);
  await fs.rm(`${lock}.recovery`,{recursive:true,force:true});
  await fs.unlink(lock);
  await waiter;
  assert.equal(acquired,true);
  await assert.rejects(fs.access(lock));
 }finally{
  await fs.rm(dir,{recursive:true,force:true});
 }
});

test('release leaves a replacement lock alone', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'theme-audit-lock-release-'));
 const audit=path.join(dir,'audit.json');
 const lock=`${audit}.lock`;
 await fs.writeFile(audit,'0');
 try{
  await withAuditLock(audit,async()=>{
   await fs.unlink(lock);
   await fs.writeFile(lock,JSON.stringify({pid:process.pid,started_at:new Date().toISOString(),token:'replacement'}));
  });
  assert.equal(JSON.parse(await fs.readFile(lock,'utf8')).token,'replacement');
 }finally{
  await fs.rm(dir,{recursive:true,force:true});
 }
});

test('concurrent writers recover a dead owner without losing updates', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'theme-audit-lock-recovery-'));
 const audit=path.join(dir,'audit.json');
 try{
  for(let round=0;round<5;round++){
   await fs.writeFile(audit,'0');
   await fs.writeFile(`${audit}.lock`,JSON.stringify({pid:99_999_999,started_at:'2020-01-01'}));
   await Promise.all(Array.from({length:8},()=>withAuditLock(audit,async()=>{
    const count=JSON.parse(await fs.readFile(audit));
    await new Promise(resolve=>setTimeout(resolve,3));
    await fs.writeFile(audit,JSON.stringify(count+1));
   },{pollMs:1,staleMs:0,attempts:500})));
   assert.equal(JSON.parse(await fs.readFile(audit)),8);
  }
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
