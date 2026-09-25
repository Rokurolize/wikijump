#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const portsDir=path.resolve(scriptDir,'..');
const captureScript=path.join(scriptDir,'capture-interactive.mjs');
const ensureBuiltScript=path.join(scriptDir,'ensure-built-framerail.mjs');
const themeArg=process.argv.find(value=>value.startsWith('--theme='))?.slice(8);
const themesArg=process.argv.find(value=>value.startsWith('--themes='))?.slice(9);
const stateArg=process.argv.find(value=>value.startsWith('--state='))?.slice(8);
const jobsArg=Number(process.argv.find(value=>value.startsWith('--jobs='))?.slice(7)??7);
const transportArg=process.argv.find(value=>value.startsWith('--transport='))?.slice(12)??'built';
const force=process.argv.includes('--force');
const accepted=new Set(['--force','--help']);
for(const arg of process.argv.slice(2)){if(accepted.has(arg)||/^--(?:theme|themes|state|jobs|transport)=/u.test(arg))continue;throw new Error(`unknown argument: ${arg}`)}
if(process.argv.includes('--help')){console.log('Usage: capture-theme-matrix.mjs (--theme=slug|--themes=a,b) [--state=surface.state,...] [--jobs=1..9] [--transport=built|dev] [--force]');process.exit(0)}
if((!themeArg&&!themesArg)||(themeArg&&themesArg))throw new Error('exactly one of --theme or --themes is required');
if(!Number.isInteger(jobsArg)||jobsArg<1||jobsArg>9)throw new Error('--jobs must be an integer from 1 to 9');
if(!['built','dev'].includes(transportArg))throw new Error('--transport must be built or dev');
const themes=themeArg?[themeArg]:themesArg.split(',').filter(Boolean);
const matrix=[
 ['chromium','desktop'],['chromium','laptop'],['chromium','tablet'],['chromium','mobile'],['chromium','narrow-mobile'],
 ['firefox','desktop'],['firefox','mobile'],['webkit','desktop'],['webkit','mobile']
];

function run(command,args,{capture=false}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:capture?['ignore','pipe','pipe']:'inherit'});
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

const common=[themes.length===1?`--theme=${themes[0]}`:`--themes=${themes.join(',')}`];
if(stateArg)common.push(`--state=${stateArg}`);
if(force)common.push('--force');
if(transportOrigin)common.push(`--transport-origin=${transportOrigin}`);

let next=0;
const results=[];
const started=Date.now();
await Promise.all(Array.from({length:Math.min(jobsArg,matrix.length)},async()=>{
 while(true){
  const index=next++;
  if(index>=matrix.length)return;
  const [engine,viewport]=matrix[index];
  const childStarted=Date.now();
  await run(process.execPath,[captureScript,`--engine=${engine}`,`--viewport=${viewport}`,...common]);
  results.push({engine,viewport,elapsed_ms:Date.now()-childStarted});
 }
}));

const auditPath=path.join(portsDir,'interactive-visual-audit.json');
let retries=0;
for(let pass=0;pass<2;pass++){
 const audit=JSON.parse(await fs.readFile(auditPath,'utf8'));
 const failures=(audit.records??[]).filter(row=>themes.includes(row.theme)&&row.unconfirmed_items?.some(item=>String(item).startsWith('action/capture failed')));
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
  if(transportOrigin)args.push(`--transport-origin=${transportOrigin}`);
  await run(process.execPath,args);
 }
}

const finalAudit=JSON.parse(await fs.readFile(auditPath,'utf8'));
const remainingFailures=(finalAudit.records??[]).filter(row=>themes.includes(row.theme)&&row.unconfirmed_items?.some(item=>String(item).startsWith('action/capture failed')));
if(remainingFailures.length)throw new Error(`matrix capture still has ${remainingFailures.length} action failures after targeted retries`);
console.log(JSON.stringify({schema:'theme_lab_matrix_capture.v1',themes,transport:transportArg,transport_origin:transportOrigin,jobs:jobsArg,elapsed_ms:Date.now()-started,retried_states:retries,job_results:results.sort((a,b)=>a.engine.localeCompare(b.engine)||a.viewport.localeCompare(b.viewport))}));
