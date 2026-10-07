import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline';

import {compactSupersededRecord} from './capture-audit-records.mjs';
import {withAuditLock} from './audit-lock.mjs';

const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const auditBase=auditPath=>path.basename(auditPath).replace(/\.json$/u,'');
const historyDirectory=auditPath=>path.join(path.dirname(auditPath),`${auditBase(auditPath)}.superseded-history`);
const defaultHistoryManifestPath=auditPath=>path.join(path.dirname(auditPath),`${auditBase(auditPath)}.superseded-history.json`);
const keyOf=row=>`${row.theme}|${row.browser_engine}|${row.viewport}|${row.surface}|${row.state}`;

function cleanSuccessfulMachineOnlyRow(row){
 const next={...row,reviewed_after_last_change:false};
 for(const field of ['screenshot','screenshot_sha256','visual_review','visual_findings','intentional_differences'])delete next[field];
 if(next.visual_gate)next.visual_gate={...next.visual_gate,risk_triggers:[]};
 if(Array.isArray(next.unconfirmed_items))next.unconfirmed_items=next.unconfirmed_items.filter(item=>item!=='screenshot captured but awaiting image review');
 return next;
}

export function interactiveAuditRowKey(row){return keyOf(row)}

async function writeAtomic(file,bytes){
 const temporary=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
 await fs.writeFile(temporary,bytes);
 await fs.rename(temporary,file);
}

export async function writeInteractiveAuditDelta(directory,shard){
 if(shard.schema!=='theme_lab_interactive_audit_delta.v1')throw new Error(`invalid interactive audit delta schema: ${shard.schema}`);
 await fs.mkdir(directory,{recursive:true});
 const shardId=shard.shard_id??crypto.randomUUID();
 const safeTheme=String(shard.theme??'capture').replace(/[^a-z0-9_-]+/giu,'_');
 const filename=`${safeTheme}__${shard.engine??'engine'}__${shard.viewport??'viewport'}__${shardId}.json`;
 const destination=path.join(directory,filename);
 await writeAtomic(destination,JSON.stringify({...shard,shard_id:shardId,created_at:shard.created_at??new Date().toISOString()})+'\n');
 return destination;
}

async function loadHistoryManifest(auditPath,document){
 const pointer=document.superseded_history;
 const manifestPath=pointer?.manifest_path
  ? path.resolve(path.dirname(auditPath),pointer.manifest_path)
  : defaultHistoryManifestPath(auditPath);
 if(!manifestPath.startsWith(path.dirname(auditPath)+path.sep))throw new Error('superseded history manifest escapes the audit directory');
 let manifest={schema:'theme_lab_interactive_audit_history_manifest.v1',record_count:0,shards:[]};
 try{
  const bytes=await fs.readFile(manifestPath);
  if(pointer?.manifest_sha256&&sha256(bytes)!==pointer.manifest_sha256)throw new Error('superseded history manifest SHA-256 mismatch');
  manifest=JSON.parse(bytes);
 }catch(error){if(error.code!=='ENOENT')throw error}
 if(manifest.schema!=='theme_lab_interactive_audit_history_manifest.v1'||!Array.isArray(manifest.shards))throw new Error('invalid superseded history manifest');
 return {manifestPath,manifest};
}

async function writeSupersededHistory(auditPath,document,rows,batchIdentity,batchTimestamp){
 const legacy=document.superseded_records??[];
 const allRows=[...legacy,...rows];
 if(!allRows.length&&!document.superseded_history)return null;
 let {manifestPath,manifest}=await loadHistoryManifest(auditPath,document);
 if(allRows.length){
  const batchId=batchIdentity.slice(0,32);
  if(!manifest.shards.some(shard=>shard.id===batchId)){
   const directory=historyDirectory(auditPath);
   await fs.mkdir(directory,{recursive:true});
   const filename=`batch-${batchId}.jsonl`;
   const shardPath=path.join(directory,filename);
   const bytes=Buffer.from(allRows.map(row=>JSON.stringify(row)).join('\n')+'\n');
   const digest=sha256(bytes);
   try{
    const existing=await fs.readFile(shardPath);
    if(sha256(existing)!==digest)throw new Error(`superseded history shard collision: ${filename}`);
   }catch(error){
    if(error.code!=='ENOENT')throw error;
    await writeAtomic(shardPath,bytes);
   }
   const relativePath=path.relative(path.dirname(auditPath),shardPath).split(path.sep).join('/');
   manifest.shards.push({id:batchId,path:relativePath,record_count:allRows.length,sha256:digest});
   manifest.record_count=manifest.shards.reduce((sum,shard)=>sum+shard.record_count,0);
   manifest.updated_at=batchTimestamp;
   manifest.last_batch_id=batchId;
   manifestPath=path.join(path.dirname(auditPath),`${auditBase(auditPath)}.superseded-history-${batchId}.json`);
   const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
   try{
    const existing=await fs.readFile(manifestPath);
    if(!existing.equals(manifestBytes))throw new Error(`superseded history manifest collision: ${path.basename(manifestPath)}`);
   }catch(error){
    if(error.code!=='ENOENT')throw error;
    await writeAtomic(manifestPath,manifestBytes);
   }
  }
 }
 const manifestBytes=await fs.readFile(manifestPath);
 if(!manifest.shards.length)return null;
 return {
  format:'jsonl-shards',
  manifest_path:path.relative(path.dirname(auditPath),manifestPath).split(path.sep).join('/'),
  manifest_sha256:sha256(manifestBytes),
  record_count:manifest.record_count
 };
}

export async function* iterateSupersededAuditHistory(auditPath,document){
 if(Array.isArray(document.superseded_records))for(const row of document.superseded_records)yield row;
 const pointer=document.superseded_history;
 if(!pointer?.manifest_path)return;
 const {manifestPath,manifest}=await loadHistoryManifest(auditPath,document);
 const manifestBytes=await fs.readFile(manifestPath);
 if(pointer.manifest_sha256&&sha256(manifestBytes)!==pointer.manifest_sha256)throw new Error('superseded history manifest SHA-256 mismatch');
 for(const shard of manifest.shards){
  const file=path.resolve(path.dirname(auditPath),shard.path);
  if(!file.startsWith(historyDirectory(auditPath)+path.sep))throw new Error(`history shard escapes its directory: ${shard.path}`);
  const digest=crypto.createHash('sha256');
  for await(const chunk of fsSync.createReadStream(file))digest.update(chunk);
  if(digest.digest('hex')!==shard.sha256)throw new Error(`superseded history shard SHA-256 mismatch: ${shard.path}`);
  let count=0;
  const lines=createInterface({input:fsSync.createReadStream(file),crlfDelay:Infinity});
  for await(const line of lines){count++;yield JSON.parse(line)}
  if(count!==shard.record_count)throw new Error(`superseded history count mismatch: ${shard.path}`);
 }
}

function sameCaptureIdentity(previous,next){
 return previous.screenshot_sha256===next.screenshot_sha256&&
  previous.candidate_sha256===next.candidate_sha256&&
  previous.candidate_source_sha256===next.candidate_source_sha256&&
  previous.environment_contract_sha256===next.environment_contract_sha256&&
  previous.capture_state_action_contract_sha256===next.capture_state_action_contract_sha256;
}

async function supersedeRow(row,portsDir,supersededAt){
 let historicalScreenshotStatus='no-path';
 if(row.screenshot){
  try{
   const bytes=await fs.readFile(path.join(portsDir,row.screenshot));
   historicalScreenshotStatus=sha256(bytes)===row.screenshot_sha256?'valid':'hash-mismatch';
  }catch(error){historicalScreenshotStatus=error.code==='ENOENT'?'missing':'unreadable'}
 }
 return compactSupersededRecord({
  ...row,
  superseded_at:supersededAt,
  historical_screenshot_valid:historicalScreenshotStatus==='valid',
  historical_screenshot_status:historicalScreenshotStatus
 });
}

export async function mergeInteractiveAuditShards({auditPath,shardDirectory,portsDir}){
 const files=(await fs.readdir(shardDirectory)).filter(name=>name.endsWith('.json')).sort();
 if(!files.length)return {shards:0,records:0,superseded:0};
 const shards=[];
 for(const filename of files){
  const shard=JSON.parse(await fs.readFile(path.join(shardDirectory,filename),'utf8'));
  if(shard.schema!=='theme_lab_interactive_audit_delta.v1')throw new Error(`invalid audit shard schema: ${shard.schema}`);
  shards.push({...shard,_filename:filename});
 }
 shards.sort((a,b)=>String(a.created_at??'').localeCompare(String(b.created_at??''))||a._filename.localeCompare(b._filename));
 const batchIdentity=sha256(Buffer.from(shards.map(shard=>`${shard._filename}:${sha256(JSON.stringify(shard))}`).join('\n')));
 const batchTimestamp=shards[0]?.created_at??new Date().toISOString();
 let mergeSummary;
 await withAuditLock(auditPath,async()=>{
  let previous={};
  try{previous=JSON.parse(await fs.readFile(auditPath,'utf8'))}
  catch(error){if(error.code!=='ENOENT')throw error}
  const removeKeys=new Set();
  const replacements=new Map();
  let visualReviewReuse=0,lastPatch=null,normalizedMachineOnlyRows=0;
  const normalizeSuccessfulMachineOnly=shards.some(shard=>shard.normalize_successful_machine_only_visuals===true);
  let machineOnlyPolicyKeys=new Set();
  if(normalizeSuccessfulMachineOnly){
   const policyPath=path.resolve(path.dirname(auditPath),'../visual-gate-policy.json');
   const policy=JSON.parse(await fs.readFile(policyPath,'utf8'));
   if(policy.schema!=='theme_lab_visual_gate_policy.v2')throw new Error('cannot normalize machine-only rows with an unknown visual policy');
   machineOnlyPolicyKeys=new Set(policy.rows.filter(row=>row.class==='M').map(row=>`${row.browser_engine}|${row.viewport}|${row.surface}|${row.state}`));
  }
  for(const shard of shards){
   for(const key of shard.remove_keys??[])removeKeys.add(key);
   for(const row of shard.records??[])replacements.set(keyOf(row),row);
   visualReviewReuse+=shard.visual_review_reuse_updates??0;
   lastPatch=shard.document_patch??lastPatch;
  }
  const previousRows=previous.records??[];
  const superseded=[];
  const retained=[];
  for(const row of previousRows){
   const key=keyOf(row),policyKey=`${row.browser_engine}|${row.viewport}|${row.surface}|${row.state}`;
   let next=replacements.get(key);
   if(!next&&normalizeSuccessfulMachineOnly&&machineOnlyPolicyKeys.has(policyKey)&&!row.failure&&
      (row.screenshot||row.screenshot_sha256||row.visual_review||row.visual_findings?.length||row.intentional_differences?.length||row.visual_gate?.risk_triggers?.length)){
    next=cleanSuccessfulMachineOnlyRow(row);
    replacements.set(key,next);
    normalizedMachineOnlyRows++;
   }
   const removed=removeKeys.has(key)||replacements.has(key);
   if(!removed){retained.push(row);continue}
   if(next&&sameCaptureIdentity(row,next))continue;
   superseded.push(await supersedeRow(row,portsDir,batchTimestamp));
  }
  const records=[...retained,...[...replacements.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,row])=>row)];
  const historyPointer=await writeSupersededHistory(auditPath,previous,superseded,batchIdentity,batchTimestamp);
  const patch=lastPatch??{};
  const next={
   ...previous,...patch,updated_at:new Date().toISOString(),records,
   network_policy:{
    external_requests_sent:records.reduce((sum,row)=>sum+(row.external_requests_sent??0),0),
    external_requests_blocked_during_auth:patch.auth_bootstrap_blocked??previous.network_policy?.external_requests_blocked_during_auth??null,
    external_requests_blocked_during_states:records.reduce((sum,row)=>sum+(row.external_requests_blocked??0),0)
   },
   visual_review_reuse_updates:(previous.visual_review_reuse_updates??0)+visualReviewReuse
  };
  delete next.auth_bootstrap_blocked;
  delete next.superseded_records;
  if(historyPointer)next.superseded_history=historyPointer;
  else delete next.superseded_history;
  await writeAtomic(auditPath,JSON.stringify(next)+'\n');
  mergeSummary={shards:files.length,records:records.length,superseded:superseded.length,normalized_machine_only_rows:normalizedMachineOnlyRows};
 });
 await Promise.all(files.map(filename=>fs.unlink(path.join(shardDirectory,filename))));
 return mergeSummary;
}
