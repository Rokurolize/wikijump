import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {createDeepwellRuntimeIdentity,deepwellRuntimeSourceIdentity} from '../src/deepwell-runtime-identity.mjs';
import {framerailSourceFingerprintSync} from '../src/framerail-source-fingerprint.mjs';

for(const scenario of ['missing-dev','caddy-failure','success','isolated']) {
 test(`built transport lifecycle: ${scenario}`,async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'built-transport-test-'));
  const fixture=path.join(dir,'install/local/theme-lab/ports/interactive-visual-fixture');
  const scripts=path.join(dir,'install/local/theme-lab/ports/scripts');
  const src=path.join(dir,'install/local/theme-lab/src');
  const bin=path.join(dir,'bin');
  const framerail=path.join(dir,'framerail');
  try{
   const sourceDirs=['deepwell/src','deepwell/relation-impl-derive','deepwell/migrations','deepwell/seeder','.cargo','locales','install/local/deepwell','install/common/deepwell','framerail/src','framerail/static'];
   for(const p of [fixture,scripts,src,bin,path.join(framerail,'node_modules/.bin'),...sourceDirs.map(value=>path.join(dir,value))])await fs.mkdir(p,{recursive:true});
   await fs.copyFile(new URL('../ports/interactive-visual-fixture/ensure-built-framerail.mjs',import.meta.url),path.join(fixture,'ensure.mjs'));
   await fs.copyFile(new URL('../ports/scripts/audit-lock.mjs',import.meta.url),path.join(scripts,'audit-lock.mjs'));
   await fs.copyFile(new URL('../src/framerail-source-fingerprint.mjs',import.meta.url),path.join(src,'framerail-source-fingerprint.mjs'));
   await fs.copyFile(new URL('../src/deepwell-runtime-identity.mjs',import.meta.url),path.join(src,'deepwell-runtime-identity.mjs'));
   await fs.copyFile(new URL('../src/runtime-source-identity.mjs',import.meta.url),path.join(src,'runtime-source-identity.mjs'));
   const ftmlRevision='c'.repeat(40),containerId='d'.repeat(64),imageId=`sha256:${'e'.repeat(64)}`,binarySha='f'.repeat(64),configSha='1'.repeat(64);
   await fs.writeFile(path.join(dir,'deepwell/Cargo.lock'),`[[package]]\nname = "ftml"\nversion = "0.1.0"\nsource = "git+https://github.com/utensil/ftml#${ftmlRevision}"\n`);
   await fs.writeFile(path.join(dir,'deepwell/Cargo.toml'),'[package]\nname = "deepwell"\n');
   await fs.writeFile(path.join(dir,'install/local/deepwell/Dockerfile'),'FROM scratch\n');
   await fs.writeFile(path.join(dir,'install/local/deepwell/config.toml'),'[deepwell]\n');
   await fs.writeFile(path.join(dir,'install/local/deepwell/deepwell-start'),'#!/bin/sh\n');
   await fs.writeFile(path.join(dir,'install/common/deepwell/health-check.sh'),'#!/bin/sh\n');
   await fs.writeFile(path.join(framerail,'package.json'),'{}');
   await fs.writeFile(path.join(framerail,'node_modules/.bin/vite'),'#!/bin/sh\nexit 0\n',{mode:0o755});
   const sourceSha=framerailSourceFingerprintSync(dir);
   const backendIdentity=createDeepwellRuntimeIdentity({source_sha256:deepwellRuntimeSourceIdentity(dir).source_sha256,ftml_git_revision:ftmlRevision,container_id:containerId,image_id:imageId,binary_sha256:binarySha,config_sha256:configSha});
   await fs.writeFile(path.join(fixture,'acceptance-run-contract.json'),JSON.stringify({expected_runtime_source_sha256:sourceSha,expected_backend_runtime_identity:backendIdentity}));
   const deepwellMounts=[['/src/deepwell/src','deepwell/src'],['/src/deepwell/build.rs','deepwell/build.rs'],['/src/deepwell/Cargo.toml','deepwell/Cargo.toml'],['/src/deepwell/Cargo.lock','deepwell/Cargo.lock'],['/src/deepwell/askama.toml','deepwell/askama.toml'],['/src/deepwell/migrations','deepwell/migrations'],['/src/deepwell/seeder','deepwell/seeder'],['/src/.cargo/config.toml','.cargo/config.toml'],['/src/install','install'],['/opt/locales','locales']].map(([Destination,relative])=>({Destination,Source:path.join(dir,relative)}));
   const deepwellInspect={Id:containerId,Image:imageId,Config:{Labels:{'com.docker.compose.project':'wikijump-local-development','com.docker.compose.service':'deepwell'}},Mounts:deepwellMounts,NetworkSettings:{Networks:{fixture:{Aliases:['deepwell'],IPAddress:'172.20.0.2'}}}};
   const runtimeHeaderNames={sourceSha256:'x-theme-lab-backend-source-sha',ftmlGitRevision:'x-theme-lab-backend-ftml-git-revision',containerId:'x-theme-lab-backend-container-id',imageId:'x-theme-lab-backend-image-id',binarySha256:'x-theme-lab-backend-binary-sha',configSha256:'x-theme-lab-backend-config-sha',identitySha256:'x-theme-lab-backend-identity-sha'};
   const log=path.join(dir,'commands.jsonl');
   await fs.writeFile(path.join(bin,'docker'),`#!${process.execPath}
    const fs=require('node:fs');const args=process.argv.slice(2);
    fs.appendFileSync(process.env.COMMAND_LOG,JSON.stringify(args)+'\\n');
    if(args[0]==='inspect'){
     if(args[1]==='wikijump-local-development-deepwell-1'){console.log(${JSON.stringify(JSON.stringify(deepwellInspect))});process.exit(0)}
     if(args[1]!=='wikijump-local-development-framerail-1'||process.env.SCENARIO==='missing-dev')process.exit(1);
     console.log(JSON.stringify({Config:{Env:['DEEPWELL_HOST=deepwell','PORT=3393'],Image:'fixture-image'},NetworkSettings:{Networks:{fixture:{Aliases:['framerail']}}},Mounts:[]}));
    }
    if(args[0]==='exec'&&args[1]==='wikijump-local-development-deepwell-1'){
     if(args.includes('sha256sum')&&args.includes('/etc/deepwell.toml')){console.log('${configSha}  /etc/deepwell.toml');process.exit(0)}
     if(args.includes('sh')){console.log('${binarySha}');process.exit(0)}
    }
    if(args[0]==='exec'&&args.includes('node')){console.log(JSON.stringify({ip:'172.20.0.2',status:200,ok:true}));process.exit(0)}
    if(args[0]==='run'&&args.includes('wikijump-theme-lab-built-caddy')&&process.env.SCENARIO==='caddy-failure')process.exit(1);
   `,{mode:0o755});
   await fs.writeFile(path.join(bin,'curl'),`#!${process.execPath}
    const fs=require('node:fs'),path=require('node:path');
    const file=path.join(process.env.THEME_LAB_BUILT_CACHE,'Caddyfile');
    if(!fs.existsSync(file))process.exit(1);
    const headers=[...fs.readFileSync(file,'utf8').matchAll(/header (X-Theme-Lab-[A-Za-z-]+) (\\S+)/gu)];
    if(!headers.some(row=>row[1]==='X-Theme-Lab-Runtime-Source-Sha'))process.exit(1);
    const names=${JSON.stringify(runtimeHeaderNames)};
    const keyMap={'X-Theme-Lab-Backend-Source-Sha':names.sourceSha256,'X-Theme-Lab-Backend-FTML-Git-Revision':names.ftmlGitRevision,'X-Theme-Lab-Backend-Container-Id':names.containerId,'X-Theme-Lab-Backend-Image-Id':names.imageId,'X-Theme-Lab-Backend-Binary-Sha':names.binarySha256,'X-Theme-Lab-Backend-Config-Sha':names.configSha256,'X-Theme-Lab-Backend-Identity-Sha':names.identitySha256};
    process.stdout.write('HTTP/2 200\\r\\n'+headers.map(row=>keyMap[row[1]]?keyMap[row[1]]+': '+row[2]+'\\r\\n':'x-theme-lab-runtime-source-sha: '+row[2]+'\\r\\n').join('')+'\\r\\n');
   `,{mode:0o755});
   const cache=path.join(dir,'cache');
   const result=spawnSync(process.execPath,[path.join(fixture,'ensure.mjs'),...(scenario==='isolated'?['--namespace=semantic-proof','--port=3396']:[])],{
    cwd:os.tmpdir(),encoding:'utf8',timeout:10000,
    env:{...process.env,PATH:`${bin}:${process.env.PATH}`,SCENARIO:scenario,COMMAND_LOG:log,THEME_LAB_BUILT_CACHE:cache,TMPDIR:dir}
   });
   const commands=(await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
   if(scenario==='success'||scenario==='isolated'){
    assert.equal(result.status,0,result.stderr);
    const summary=JSON.parse(result.stdout);
    assert.equal(summary.restarted,true);
    assert.match(summary.source_sha256,/^[0-9a-f]{64}$/u);
    assert.ok(commands.some(args=>args.includes(`theme-lab.source-sha=${summary.source_sha256}`)));
    if(scenario==='isolated'){
     assert.ok(commands.every(args=>!args.includes('wikijump-theme-lab-built-framerail')&&!args.includes('wikijump-theme-lab-built-caddy')));
     assert.ok(commands.some(args=>args.includes('127.0.0.1:3396:443')));
    }
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
