#!/usr/bin/env node
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const portsDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const capture=path.join(portsDir,'interactive-visual-fixture','capture-interactive.mjs');
if(process.argv.includes('--help')){
 console.log('Usage: capture-theme-matrix.mjs --theme=<slug> [--force]');
 process.exit(0);
}
const theme=process.argv.find(arg=>arg.startsWith('--theme='))?.slice(8);
const force=process.argv.includes('--force');
if(!theme)throw new Error('usage: capture-theme-matrix.mjs --theme=<slug> [--force]');
for(const arg of process.argv.slice(2)){
 if(arg===`--theme=${theme}`||arg==='--force'||arg==='--help')continue;
 throw new Error(`unknown argument: ${arg}`);
}

// Two resource-aware lanes outperform both a fully serial matrix and three
// simultaneously heavy Chromium runs on the local 16-thread host. Keep the
// two high-cost Chromium matrices apart while overlapping them with the
// smaller breakpoint/cross-engine jobs.
const lanes=[
 [
  ['chromium','desktop'],['chromium','narrow-mobile'],['firefox','mobile'],
  ['webkit','desktop'],['chromium','laptop']
 ],
 [
  ['chromium','mobile'],['firefox','desktop'],['webkit','mobile'],
  ['chromium','tablet']
 ]
];

function run(engine,viewport,lane){
 return new Promise((resolve,reject)=>{
  const args=[capture,`--theme=${theme}`,`--engine=${engine}`,`--viewport=${viewport}`];
  if(force)args.push('--force');
  const started=performance.now();
  const child=spawn(process.execPath,args,{cwd:path.resolve(portsDir,'../../../..'),stdio:['ignore','pipe','pipe']});
  let tail='';
  const collect=chunk=>{tail=(tail+chunk.toString()).slice(-8000)};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.once('error',reject);
  child.once('exit',code=>{
   const seconds=Number(((performance.now()-started)/1000).toFixed(2));
   if(code===0){console.log(JSON.stringify({lane,engine,viewport,status:'pass',seconds}));resolve()}
   else reject(new Error(`${engine}/${viewport} failed with exit ${code}: ${tail}`));
  });
 });
}

async function runLane(jobs,lane){
 for(const [engine,viewport] of jobs)await run(engine,viewport,lane);
}
const started=performance.now();
await Promise.all(lanes.map((jobs,index)=>runLane(jobs,index+1)));
console.log(JSON.stringify({schema:'theme_lab_interactive_matrix_capture.v1',theme,status:'pass',seconds:Number(((performance.now()-started)/1000).toFixed(2)),lanes:lanes.length}));
