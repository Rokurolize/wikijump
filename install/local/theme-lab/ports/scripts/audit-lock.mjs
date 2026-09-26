import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const processAlive=pid=>{
 if(!Number.isInteger(pid)||pid<=0)return true; // unknown owner: treat as live
 try{process.kill(pid,0);return true}catch(error){return error.code!=='ESRCH'}
};

// Reclaim a lock whose owner is provably dead and older than staleMs. Only one
// waiter may reclaim at a time: without the gate, two waiters that both read
// the dead lock can unlink a replacement lock created by a third and then both
// enter the critical section. The gate records its owner so waiters only clear
// a gate abandoned by a dead reclaimer, never one that is actively reclaiming.
async function reclaimStaleLock(lockPath, recoveryPath, staleMs){
 let owner;
 try{owner=JSON.parse(await fs.readFile(lockPath,'utf8'))}
 catch(error){return error.code==='ENOENT'} // disappeared; retry acquisition
 if(processAlive(owner.pid)||!(Date.now()-Date.parse(owner.started_at)>staleMs))return false;
 const gateOwner=`${recoveryPath}/owner`;
 try{
  await fs.mkdir(recoveryPath);
  await fs.writeFile(gateOwner,JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));
 }catch(error){
  if(error.code!=='EEXIST')throw error;
  // Clear only a gate whose reclaimer died mid-recovery. An absent owner file
  // means the reclaimer died between mkdir and writeFile; allow a fixed grace
  // so the gate is not stolen while the owner write is still in flight.
  let holder=null;
  try{holder=JSON.parse(await fs.readFile(gateOwner,'utf8'))}catch{}
  const abandonedAfter=holder?staleMs:Math.max(staleMs,1000);
  const stat=await fs.stat(recoveryPath).catch(()=>null);
  if(stat&&Date.now()-stat.mtimeMs>abandonedAfter){
   if(!holder||!processAlive(holder.pid))await fs.rm(recoveryPath,{recursive:true,force:true}).catch(()=>{});
  }
  return false;
 }
 try{
  // Revalidate under the gate. If the lock was replaced while we waited,
  // leave the new owner alone and retry as an ordinary waiter.
  let current;
  try{current=JSON.parse(await fs.readFile(lockPath,'utf8'))}
  catch{return false}
  if(current.pid!==owner.pid||current.started_at!==owner.started_at||current.token!==owner.token)return false;
  try{await fs.unlink(lockPath)}catch(error){if(error.code!=='ENOENT')throw error}
  return true;
 }finally{
  await fs.rm(recoveryPath,{recursive:true,force:true}).catch(()=>{});
 }
}

export async function withAuditLock(auditPath,operation,{pollMs=50,staleMs=5000,attempts=600}={}){
 const lockPath=`${auditPath}.lock`;
 const recoveryPath=`${lockPath}.recovery`;
 const token=crypto.randomUUID();
 let lock;
 for(let attempt=0;attempt<attempts;attempt++){
  try{
   lock=await fs.open(lockPath,'wx');
   await lock.writeFile(JSON.stringify({pid:process.pid,started_at:new Date().toISOString(),token}));
   break;
  }catch(error){
   if(error.code!=='EEXIST')throw error;
   if(await reclaimStaleLock(lockPath,recoveryPath,staleMs))continue;
   await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
 }
 if(!lock)throw new Error(`timed out waiting for audit lock ${lockPath}`);
 try{return await operation()}
 finally{
  await lock.close();
  // Release only our own lock. If the path was already reclaimed, the token
  // differs and the replacement owner is left untouched.
  let current=null;
  try{current=JSON.parse(await fs.readFile(lockPath,'utf8'))}catch{}
  if(current?.token===token)await fs.unlink(lockPath).catch(error=>{if(error.code!=='ENOENT')throw error});
 }
}
