#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {once} from 'node:events';
import {finished} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';

import {withAuditLock} from './audit-lock.mjs';

const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const portsDir=path.resolve(scriptDir,'..');
const defaultAudit=path.join(portsDir,'current-acceptance/artifacts/interactive-visual-audit.json');
const auditArg=process.argv.find(arg=>arg.startsWith('--audit='))?.slice(8);
for(const arg of process.argv.slice(2))if(arg!=='--help'&&!arg.startsWith('--audit='))throw new Error(`unknown argument: ${arg}`);
if(process.argv.includes('--help')){console.log('Usage: split-interactive-audit-history.mjs [--audit=/path/to/interactive-visual-audit.json]');process.exit(0)}
const auditPath=path.resolve(auditArg??defaultAudit);
const auditDirectory=path.dirname(auditPath);
const auditStem=path.basename(auditPath).replace(/\.json$/u,'');
const historyDirectory=path.join(auditDirectory,`${auditStem}.superseded-history`);
const manifestPath=path.join(auditDirectory,`${auditStem}.superseded-history.json`);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const isWhitespace=byte=>byte===0x20||byte===0x09||byte===0x0a||byte===0x0d;

async function locateHistoryArray(file){
 let objectDepth=0,arrayDepth=0,insideString=false,escaped=false;
 let rootExpectsKey=false,rootKey=null,rootExpectsValue=false,keyStart=-1,keyBytes=[];
 let targetArrayDepth=0,targetArrayStart=-1,targetArrayEnd=-1,rootEnd=-1,offset=0;
 const sourceHash=crypto.createHash('sha256');
 for await(const chunk of fsSync.createReadStream(file)){
  sourceHash.update(chunk);
  for(let index=0;index<chunk.length;index++,offset++){
   const byte=chunk[index];
   if(insideString){
    if(keyStart>=0)keyBytes.push(byte);
    if(escaped){escaped=false;continue}
    if(byte===0x5c){escaped=true;continue}
    if(byte===0x22){
     insideString=false;
     if(keyStart>=0){rootKey=JSON.parse(Buffer.from(keyBytes).toString('utf8'));rootExpectsKey=false;keyStart=-1;keyBytes=[]}
    }
    continue;
   }
   if(byte===0x22){
    insideString=true;
    if(objectDepth===1&&arrayDepth===0&&rootExpectsKey){keyStart=offset;keyBytes=[byte]}
    continue;
   }
   if(objectDepth===1&&arrayDepth===0){
    if(byte===0x3a&&rootKey!==null)rootExpectsValue=true;
    else if(byte===0x2c){rootExpectsKey=true;rootKey=null;rootExpectsValue=false}
    else if(byte===0x7d){rootEnd=offset}
   }
   if(rootExpectsValue&&byte!==0x3a&&!isWhitespace(byte)){
    if(rootKey==='superseded_records'){
     if(byte!==0x5b)throw new Error('top-level superseded_records is not a JSON array');
     targetArrayStart=offset;targetArrayDepth=1;
    }
    rootExpectsValue=false;
   }else if(targetArrayDepth>0){
    if(byte===0x5b)targetArrayDepth++;
    else if(byte===0x5d&&--targetArrayDepth===0)targetArrayEnd=offset+1;
   }
   if(byte===0x7b){if(objectDepth===0)rootExpectsKey=true;objectDepth++}
   else if(byte===0x7d)objectDepth--;
   else if(byte===0x5b)arrayDepth++;
   else if(byte===0x5d)arrayDepth--;
  }
 }
 if(insideString||objectDepth!==0||arrayDepth!==0||rootEnd<0)throw new Error('audit JSON structure is incomplete');
 return {targetArrayStart,targetArrayEnd,rootEnd,source_sha256:sourceHash.digest('hex')};
}

async function readByte(file,position){
 const handle=await fs.open(file,'r');
 try{const buffer=Buffer.alloc(1);const {bytesRead}=await handle.read(buffer,0,1,position);return bytesRead?buffer[0]:null}
 finally{await handle.close()}
}

async function findRemovalRange(file,arrayStart,arrayEnd){
 let after=arrayEnd;
 let byte;
 while((byte=await readByte(file,after))!==null&&isWhitespace(byte))after++;
 if(byte===0x2c)return {start:(await findMemberKeyStart(file,arrayStart)),end:after+1};
 if(byte!==0x7d)throw new Error('could not find the top-level delimiter after superseded_records');
 let before=(await findMemberKeyStart(file,arrayStart))-1;
 while(before>=0&&(byte=await readByte(file,before))!==null&&isWhitespace(byte))before--;
 if(byte!==0x2c)throw new Error('could not find the top-level delimiter before superseded_records');
 return {start:before,end:arrayEnd};
}

async function findMemberKeyStart(file,arrayStart){
 // The property key immediately precedes its value. Scan backward over the
 // short key/colon/whitespace span, respecting a quoted JSON string.
 const windowStart=Math.max(0,arrayStart-128);
 const handle=await fs.open(file,'r');
 try{
  const length=arrayStart-windowStart;
  const bytes=Buffer.alloc(length);
  await handle.read(bytes,0,length,windowStart);
  let colon=-1;
  for(let i=bytes.length-1;i>=0;i--)if(bytes[i]===0x3a){colon=i;break}
  if(colon<0)throw new Error('missing colon before superseded_records array');
  let closingQuote=-1;
  for(let i=colon-1;i>=0;i--){
   if(bytes[i]!==0x22)continue;
   let slashes=0;for(let j=i-1;j>=0&&bytes[j]===0x5c;j--)slashes++;
   if(slashes%2===0){closingQuote=i;break}
  }
  if(closingQuote<0)throw new Error('missing closing quote for superseded_records key');
  let openingQuote=-1;
  for(let i=closingQuote-1;i>=0;i--){
   if(bytes[i]!==0x22)continue;
   let slashes=0;for(let j=i-1;j>=0&&bytes[j]===0x5c;j--)slashes++;
   if(slashes%2===0){openingQuote=i;break}
  }
  if(openingQuote<0)throw new Error('missing opening quote for superseded_records key');
  return windowStart+openingQuote;
 }finally{await handle.close()}
}

async function writeChunk(stream,digest,bytes){
 if(!bytes?.length)return;
 digest?.update(bytes);
 if(!stream.write(bytes))await once(stream,'drain');
}

async function writeHistoryJsonl(file,start,end,tempPath){
 const output=fsSync.createWriteStream(tempPath,{flags:'wx'});
 const done=finished(output);
 const digest=crypto.createHash('sha256');
 let count=0,depth=0,insideString=false,escaped=false,active=false,segmentStart=-1;
 let recordChunks=[];
 try{
  if(end>start){
   for await(const chunk of fsSync.createReadStream(file,{start,end:end-1})){
    if(active&&segmentStart<0)segmentStart=0;
    for(let index=0;index<chunk.length;index++){
     const byte=chunk[index];
     if(!active){
      if(isWhitespace(byte)||byte===0x2c)continue;
      if(byte!==0x7b)throw new Error(`superseded record ${count} is not an object`);
      active=true;depth=1;insideString=false;escaped=false;segmentStart=index;recordChunks=[];
      continue;
     }
     if(insideString){
      if(escaped){escaped=false;continue}
      if(byte===0x5c){escaped=true;continue}
      if(byte===0x22)insideString=false;
      continue;
     }
     if(byte===0x22){insideString=true;continue}
     if(byte===0x7b||byte===0x5b)depth++;
     else if(byte===0x7d||byte===0x5d)depth--;
     if(depth===0){
      recordChunks.push(chunk.subarray(segmentStart,index+1));
      const parsed=JSON.parse(Buffer.concat(recordChunks).toString('utf8'));
      const serialized=Buffer.from(JSON.stringify(parsed)+'\n');
      await writeChunk(output,digest,serialized);
      count++;active=false;segmentStart=-1;recordChunks=[];
     }
    }
    if(active&&segmentStart>=0){recordChunks.push(chunk.subarray(segmentStart));segmentStart=-1}
   }
  }
  if(active)throw new Error('truncated superseded JSON object');
  output.end();await done;
  return {count,sha256:digest.digest('hex')};
 }catch(error){output.destroy();await done.catch(()=>{});throw error}
}

async function copyRange(file,from,to,output,digest){
 if(to<=from)return;
 for await(const chunk of fsSync.createReadStream(file,{start:from,end:to-1}))await writeChunk(output,digest,chunk);
}

await withAuditLock(auditPath,async()=>{
 const stat=await fs.stat(auditPath);
 const bounds=await locateHistoryArray(auditPath);
 if(bounds.targetArrayStart<0){
  console.log(JSON.stringify({status:'already-separated-or-no-history',audit:auditPath,bytes:stat.size}));
  return;
 }
 if(bounds.targetArrayEnd<0)throw new Error('superseded_records array did not close');
 const keyStart=await findMemberKeyStart(auditPath,bounds.targetArrayStart);
 let after=bounds.targetArrayEnd,byte;
 while((byte=await readByte(auditPath,after))!==null&&isWhitespace(byte))after++;
 let removal;
 if(byte===0x2c)removal={start:keyStart,end:after+1};
 else{
  if(byte!==0x7d)throw new Error('could not find the top-level delimiter after superseded_records');
  let before=keyStart-1;
  while(before>=0&&(byte=await readByte(auditPath,before))!==null&&isWhitespace(byte))before--;
  if(byte!==0x2c)throw new Error('could not find the top-level delimiter before superseded_records');
  removal={start:before,end:bounds.targetArrayEnd};
 }
 await fs.mkdir(historyDirectory,{recursive:true});
 const temporaryHistory=path.join(historyDirectory,`.legacy-${process.pid}-${crypto.randomUUID()}.jsonl.tmp`);
 const history=await writeHistoryJsonl(auditPath,bounds.targetArrayStart+1,bounds.targetArrayEnd-1,temporaryHistory);
 const historyId=`legacy-${history.sha256.slice(0,24)}`;
 const historyFilename=`${historyId}.jsonl`;
 const historyPath=path.join(historyDirectory,historyFilename);
 try{await fs.rename(temporaryHistory,historyPath)}catch(error){
  if(error.code!=='EEXIST'&&error.code!=='ENOTEMPTY')throw error;
  await fs.rm(temporaryHistory,{force:true});
  const existingHash=crypto.createHash('sha256');for await(const chunk of fsSync.createReadStream(historyPath))existingHash.update(chunk);
  if(existingHash.digest('hex')!==history.sha256)throw new Error('existing migrated history shard differs');
 }
 const relativeHistoryPath=path.relative(auditDirectory,historyPath).split(path.sep).join('/');
 const manifest={schema:'theme_lab_interactive_audit_history_manifest.v1',created_at:new Date().toISOString(),source_audit_sha256:bounds.source_sha256,record_count:history.count,shards:[{id:historyId,path:relativeHistoryPath,record_count:history.count,sha256:history.sha256}]};
 const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
 const manifestTemp=`${manifestPath}.${process.pid}.tmp`;
 await fs.writeFile(manifestTemp,manifestBytes);await fs.rename(manifestTemp,manifestPath);
 const pointer={format:'jsonl-shards',manifest_path:path.relative(auditDirectory,manifestPath).split(path.sep).join('/'),manifest_sha256:hash(manifestBytes),record_count:history.count};
 const activeTemp=`${auditPath}.${process.pid}.split.tmp`;
 const output=fsSync.createWriteStream(activeTemp,{flags:'wx'});
 const done=finished(output),digest=crypto.createHash('sha256');
 try{
  await copyRange(auditPath,0,removal.start,output,digest);
  await copyRange(auditPath,removal.end,bounds.rootEnd,output,digest);
  await writeChunk(output,digest,Buffer.from(`,"superseded_history":${JSON.stringify(pointer)}`));
  await copyRange(auditPath,bounds.rootEnd,stat.size,output,digest);
  output.end();await done;
  await fs.rename(activeTemp,auditPath);
 }catch(error){output.destroy();await done.catch(()=>{});await fs.rm(activeTemp,{force:true});throw error}
 const activeStat=await fs.stat(auditPath);
 console.log(JSON.stringify({status:'separated',audit:auditPath,source_audit_sha256:bounds.source_sha256,active_bytes_before:stat.size,active_bytes_after:activeStat.size,superseded_records:history.count,superseded_history_path:relativeHistoryPath,superseded_history_sha256:history.sha256,history_manifest_path:pointer.manifest_path,history_manifest_sha256:pointer.manifest_sha256}));
});
