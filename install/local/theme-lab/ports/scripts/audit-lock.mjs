import fs from 'node:fs/promises';

export async function withAuditLock(auditPath,operation,{pollMs=50,staleMs=5000,attempts=600}={}){
 const lockPath=`${auditPath}.lock`;
 let lock;
 for(let attempt=0;attempt<attempts;attempt++){
  try{
   lock=await fs.open(lockPath,'wx');
   await lock.writeFile(JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));
   break;
  }catch(error){
   if(error.code!=='EEXIST')throw error;
   try{
    const owner=JSON.parse(await fs.readFile(lockPath,'utf8'));
    let alive=true;
    try{process.kill(owner.pid,0)}catch(signalError){if(signalError.code==='ESRCH')alive=false}
    const age=Date.now()-Date.parse(owner.started_at);
    if(!alive&&age>staleMs)await fs.unlink(lockPath);
   }catch(readError){
    if(readError.code==='ENOENT')continue;
   }
   await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
 }
 if(!lock)throw new Error(`timed out waiting for audit lock ${lockPath}`);
 try{return await operation()}
 finally{
  await lock.close();
  try{await fs.unlink(lockPath)}catch(error){if(error.code!=='ENOENT')throw error}
 }
}
