import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

for(const scenario of ['missing-dev','caddy-failure','success']) {
 test(`built transport lifecycle: ${scenario}`,async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'built-transport-test-'));
  const fixture=path.join(dir,'install/local/theme-lab/ports/interactive-visual-fixture');
  const scripts=path.join(dir,'install/local/theme-lab/ports/scripts');
  const bin=path.join(dir,'bin');
  const framerail=path.join(dir,'framerail');
  try{
   for(const p of [fixture,scripts,bin,path.join(framerail,'node_modules/.bin')])await fs.mkdir(p,{recursive:true});
   await fs.copyFile(new URL('../ports/interactive-visual-fixture/ensure-built-framerail.mjs',import.meta.url),path.join(fixture,'ensure.mjs'));
   await fs.copyFile(new URL('../ports/scripts/audit-lock.mjs',import.meta.url),path.join(scripts,'audit-lock.mjs'));
   await fs.writeFile(path.join(framerail,'package.json'),'{}');
   await fs.writeFile(path.join(framerail,'node_modules/.bin/vite'),'#!/bin/sh\nexit 0\n',{mode:0o755});
   const log=path.join(dir,'commands.jsonl');
   await fs.writeFile(path.join(bin,'docker'),`#!${process.execPath}
    const fs=require('node:fs');const args=process.argv.slice(2);
    fs.appendFileSync(process.env.COMMAND_LOG,JSON.stringify(args)+'\\n');
    if(args[0]==='inspect'){
     if(args[1]!=='wikijump-local-development-framerail-1'||process.env.SCENARIO==='missing-dev')process.exit(1);
     console.log(JSON.stringify({Config:{Env:[],Image:'fixture-image'},NetworkSettings:{Networks:{fixture:{}}},Mounts:[]}));
    }
    if(args[0]==='run'&&args.includes('wikijump-theme-lab-built-caddy')&&process.env.SCENARIO==='caddy-failure')process.exit(1);
   `,{mode:0o755});
   await fs.writeFile(path.join(bin,'curl'),'#!/bin/sh\nexit 0\n',{mode:0o755});
   const cache=path.join(dir,'cache');
   const result=spawnSync(process.execPath,[path.join(fixture,'ensure.mjs')],{
    cwd:os.tmpdir(),encoding:'utf8',timeout:10000,
    env:{...process.env,PATH:`${bin}:${process.env.PATH}`,SCENARIO:scenario,COMMAND_LOG:log,THEME_LAB_BUILT_CACHE:cache,TMPDIR:dir}
   });
   const commands=(await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
   if(scenario==='success'){
    assert.equal(result.status,0,result.stderr);
    assert.equal(JSON.parse(result.stdout).restarted,true);
   }else{
    assert.notEqual(result.status,0);
    if(scenario==='missing-dev')assert.ok(commands.every(args=>args[0]!=='rm'&&args[0]!=='run'));
    else assert.deepEqual(commands.at(-1),['rm','-f','wikijump-theme-lab-built-framerail']);
   }
   assert.ok(!(await fs.readdir(dir)).some(name=>name.startsWith('theme-lab-built-env-')));
   await assert.rejects(fs.access(path.join(cache,'bootstrap.lock')));
   await assert.rejects(fs.access(path.join(cache,'bootstrap.lock.recovery')));
  }finally{await fs.rm(dir,{recursive:true,force:true})}
 });
}
