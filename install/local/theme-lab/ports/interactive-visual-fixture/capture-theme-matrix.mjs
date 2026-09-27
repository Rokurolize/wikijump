#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withAuditLock} from '../scripts/audit-lock.mjs';

const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const portsDir=path.resolve(scriptDir,'..');
const captureScript=path.join(scriptDir,'capture-interactive.mjs');
const ensureBuiltScript=path.join(scriptDir,'ensure-built-framerail.mjs');
const themeArg=process.argv.find(value=>value.startsWith('--theme='))?.slice(8);
const themesArg=process.argv.find(value=>value.startsWith('--themes='))?.slice(9);
const stateArg=process.argv.find(value=>value.startsWith('--state='))?.slice(8);
// Built transport, 4 themes x 9 engine/viewports x 4 core states (120
// requested rows) against a shadow copy of the full 4,947-row audit: jobs
// 3/4/5/6/7 took 82.9/78.7/75.6/75.1/75.0 s with zero failed, retried,
// asset, page-error or external-request rows in every run of issue #1964.
// Seven is the measured plateau (six is within noise); keep it. Callers on
// smaller hosts can set --jobs explicitly.
const jobsArg=Number(process.argv.find(value=>value.startsWith('--jobs='))?.slice(7)??7);
const transportArg=process.argv.find(value=>value.startsWith('--transport='))?.slice(12)??'built';
const force=process.argv.includes('--force');
const anonymous=process.argv.includes('--anonymous');
const seenOptions=new Set();
for(const argument of process.argv.slice(2)){
 const name=argument.split('=')[0];
 if(seenOptions.has(name))throw new Error(`duplicate option: ${name}`);
 seenOptions.add(name);
}
const accepted=new Set(['--force','--anonymous','--help']);
for(const arg of process.argv.slice(2)){if(accepted.has(arg)||/^--(?:theme|themes|state|jobs|transport)=/u.test(arg))continue;throw new Error(`unknown argument: ${arg}`)}
if(process.argv.includes('--help')){console.log('Usage: capture-theme-matrix.mjs (--theme=slug|--themes=a,b) [--state=surface.state,...] [--jobs=1..9] [--transport=built|dev] [--anonymous] [--force]');console.log('--anonymous only captures states that work without the authenticated administrator; admin-only states (page.edit, page.rename, page.delete) fail closed. Pass --state for a public subset.');process.exit(0)}
if((!themeArg&&!themesArg)||(themeArg&&themesArg))throw new Error('exactly one of --theme or --themes is required');
if(!Number.isInteger(jobsArg)||jobsArg<1||jobsArg>9)throw new Error('--jobs must be an integer from 1 to 9');
if(!['built','dev'].includes(transportArg))throw new Error('--transport must be built or dev');
const themes=themeArg?[themeArg]:themesArg.split(',');
if(themes.some(theme=>!theme.trim())||new Set(themes).size!==themes.length)throw new Error('themes must be non-empty and unique');
if(stateArg!==undefined&&stateArg.split(',').some(state=>!state.trim()))throw new Error('states must be non-empty');
const manifest=JSON.parse(await fs.readFile(path.join(portsDir,'en-theme-campaign.json'),'utf8'));
const registered=new Set(['dear-dictator',...manifest.themes.map(theme=>theme.slug.replace(/^theme:/u,''))]);
if(themes.some(theme=>!registered.has(theme)))throw new Error('requested theme is not registered in the campaign manifest');
const matrix=[
 ['chromium','desktop'],['chromium','laptop'],['chromium','tablet'],['chromium','mobile'],['chromium','narrow-mobile'],
 ['firefox','desktop'],['firefox','mobile'],['webkit','desktop'],['webkit','mobile']
];
const auditPath=process.env.THEME_LAB_INTERACTIVE_AUDIT_PATH
 ? path.resolve(process.env.THEME_LAB_INTERACTIVE_AUDIT_PATH)
 : path.join(portsDir,'interactive-visual-audit.json');
if(anonymous&&!stateArg)process.stderr.write('warning: --anonymous cannot capture states that require the authenticated administrator (page.edit, page.rename, page.delete); targeted retries cannot fix them, so pass --state for a public subset or run authenticated\n');

const children=new Set();
let interrupted=null;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
 interrupted=new Error(`matrix interrupted by ${signal}`);
 for(const child of children)child.kill(signal);
});

function run(command,args,{capture=false,env=process.env}={}){
 return new Promise((resolve,reject)=>{
  if(interrupted){reject(interrupted);return}
  const child=spawn(command,args,{stdio:capture?['ignore','pipe','pipe']:'inherit',env});
  children.add(child);
  child.once('close',()=>children.delete(child));
  let stdout='',stderr='';
  if(child.stdout)child.stdout.on('data',chunk=>stdout+=chunk);
  if(child.stderr)child.stderr.on('data',chunk=>stderr+=chunk);
  child.once('error',reject);
  child.once('close',code=>code===0?resolve({stdout,stderr}):reject(new Error(`${path.basename(command)} exited ${code}: ${stderr.slice(-4000)}`)));
 });
}

let transportOrigin=null;
if(transportArg==='built'){
 const ensured=await run(process.execPath,[ensureBuiltScript],{capture:true});
 const line=ensured.stdout.trim().split('\n').at(-1);
 transportOrigin=JSON.parse(line).transport_origin;
}

const auditShardDir=await fs.mkdtemp(path.join(os.tmpdir(),'theme-lab-audit-shards-'));
process.once('exit',()=>fsSync.rmSync(auditShardDir,{recursive:true,force:true}));
const captureEnv={...process.env,THEME_LAB_AUDIT_SHARD_DIR:auditShardDir};
const auditRowKey=row=>`${row.theme}|${row.browser_engine}|${row.viewport}|${row.surface}|${row.state}`;
async function commitAuditShards(){
 const files=(await fs.readdir(auditShardDir)).filter(name=>name.endsWith('.json')).sort();
 if(!files.length)return 0;
 const shards=[];
 for(const name of files)shards.push(JSON.parse(await fs.readFile(path.join(auditShardDir,name),'utf8')));
 await withAuditLock(auditPath,async()=>{
  let previous={};try{previous=JSON.parse(await fs.readFile(auditPath,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
  const removeKeys=new Set();const replacements=new Map();const superseded=[];
  let reviewReuse=0,lastPatch=null;
  for(const shard of shards){
   if(shard.schema!=='theme_lab_interactive_audit_delta.v1')throw new Error(`invalid audit shard schema: ${shard.schema}`);
   for(const key of shard.remove_keys??[])removeKeys.add(key);
   for(const row of shard.records??[])replacements.set(auditRowKey(row),row);
   superseded.push(...(shard.superseded_records??[]));
   reviewReuse+=shard.visual_review_reuse_updates??0;
   lastPatch=shard.document_patch??lastPatch;
  }
  const retained=(previous.records??[]).filter(row=>!removeKeys.has(auditRowKey(row))&&!replacements.has(auditRowKey(row)));
  const records=[...retained,...[...replacements.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,row])=>row)];
  const patch=lastPatch??{};
  const next={
   ...previous,...patch,updated_at:new Date().toISOString(),records,
   superseded_records:[...(previous.superseded_records??[]),...superseded],
   network_policy:{
    external_requests_sent:records.reduce((sum,row)=>sum+(row.external_requests_sent??0),0),
    external_requests_blocked_during_auth:patch.auth_bootstrap_blocked??previous.network_policy?.external_requests_blocked_during_auth??null,
    external_requests_blocked_during_states:records.reduce((sum,row)=>sum+(row.external_requests_blocked??0),0)
   },
   visual_review_reuse_updates:(previous.visual_review_reuse_updates??0)+reviewReuse
  };
  delete next.auth_bootstrap_blocked;
  const temporary=`${auditPath}.${process.pid}.tmp`;await fs.writeFile(temporary,JSON.stringify(next)+'\n');await fs.rename(temporary,auditPath);
 });
 await Promise.all(files.map(name=>fs.unlink(path.join(auditShardDir,name))));
 return files.length;
}

const common=[themes.length===1?`--theme=${themes[0]}`:`--themes=${themes.join(',')}`];
if(stateArg)common.push(`--state=${stateArg}`);
if(force)common.push('--force');
if(anonymous)common.push('--anonymous');
if(transportOrigin)common.push(`--transport-origin=${transportOrigin}`);

let next=0;
const results=[];
let firstWorkerError=null;
const started=Date.now();
await Promise.all(Array.from({length:Math.min(jobsArg,matrix.length)},async()=>{
 while(true){
  if(firstWorkerError)return;
  const index=next++;
  if(index>=matrix.length)return;
  const [engine,viewport]=matrix[index];
  const childStarted=Date.now();
  try{
   await run(process.execPath,[captureScript,`--engine=${engine}`,`--viewport=${viewport}`,...common],{env:captureEnv});
   results.push({engine,viewport,elapsed_ms:Date.now()-childStarted});
  }catch(error){
   firstWorkerError??=error;
   return;
  }
 }
}));
if(firstWorkerError){await fs.rm(auditShardDir,{recursive:true,force:true});throw firstWorkerError}
await commitAuditShards();
const requestedStates=stateArg?new Set(stateArg.split(',').filter(Boolean)):null;
const isRequestedRow=row=>
 themes.includes(row.theme) &&
 (!requestedStates||requestedStates.has(`${row.surface}.${row.state}`));
let retries=0;
for(let pass=0;pass<2;pass++){
 const audit=JSON.parse(await fs.readFile(auditPath,'utf8'));
 const failures=(audit.records??[]).filter(row=>
  isRequestedRow(row) &&
  row.unconfirmed_items?.some(item=>String(item).startsWith('action/capture failed'))
 );
 if(!failures.length)break;
 const groups=new Map();
 for(const row of failures){
  const key=`${row.theme}|${row.browser_engine}|${row.viewport}`;
  const group=groups.get(key)??{theme:row.theme,engine:row.browser_engine,viewport:row.viewport,states:new Set()};
  group.states.add(`${row.surface}.${row.state}`);groups.set(key,group);
 }
 for(const group of groups.values()){
  retries+=group.states.size;
  const args=[captureScript,`--engine=${group.engine}`,`--viewport=${group.viewport}`,`--theme=${group.theme}`,`--state=${[...group.states].join(',')}`,'--concurrency=2','--force'];
  if(anonymous)args.push('--anonymous');
  if(transportOrigin)args.push(`--transport-origin=${transportOrigin}`);
  await run(process.execPath,args,{env:captureEnv});
 }
 await commitAuditShards();
}

const finalAudit=JSON.parse(await fs.readFile(auditPath,'utf8'));
const runRows=(finalAudit.records??[]).filter(isRequestedRow);
const remainingFailures=runRows.filter(row=>row.unconfirmed_items?.some(item=>String(item).startsWith('action/capture failed')));
const invalidEvidence=runRows.filter(row=>!row.screenshot||!Array.isArray(row.asset_failures)||row.asset_failures.length||!Array.isArray(row.page_errors)||row.page_errors.length||row.external_requests_sent!==0);
if(invalidEvidence.length){await fs.rm(auditShardDir,{recursive:true,force:true});throw new Error(`matrix capture has ${invalidEvidence.length} rows with missing screenshots or failed runtime evidence`)}
if(remainingFailures.length){await fs.rm(auditShardDir,{recursive:true,force:true});throw new Error(`matrix capture still has ${remainingFailures.length} action failures after targeted retries`)}
console.log(JSON.stringify({
 schema:'theme_lab_matrix_capture.v1',
 themes,
 transport:transportArg,
 transport_origin:transportOrigin,
 jobs:jobsArg,
 elapsed_ms:Date.now()-started,
 successful_states:runRows.filter(row=>row.screenshot&&!row.unconfirmed_items?.some(item=>String(item).startsWith('action/capture failed'))).length,
 action_failures:remainingFailures.length,
 page_errors:runRows.reduce((sum,row)=>sum+(row.page_errors?.length??0),0),
 asset_failures:runRows.reduce((sum,row)=>sum+(row.asset_failures?.length??0),0),
 external_requests_sent:runRows.reduce((sum,row)=>sum+(row.external_requests_sent??0),0),
 retried_states:retries,
 job_results:results.sort((a,b)=>a.engine.localeCompare(b.engine)||a.viewport.localeCompare(b.viewport))
}));
await fs.rm(auditShardDir,{recursive:true,force:true});
