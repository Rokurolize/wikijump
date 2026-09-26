#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withAuditLock} from '../scripts/audit-lock.mjs';

const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const repoRoot=path.resolve(scriptDir,'../../../../../');
const framerailDir=path.join(repoRoot,'framerail');
const cacheBase=process.env.THEME_LAB_BUILT_CACHE??'/tmp/wikijump-theme-lab-built-framerail';
const framerailContainer='wikijump-theme-lab-built-framerail';
const caddyContainer='wikijump-theme-lab-built-caddy';
const transportOrigin='https://scpaiueouiuiuiui.wikijump.localhost:3395';
const devContainer='wikijump-local-development-framerail-1';
const buildInputs=[
  path.join(framerailDir,'src'),
  path.join(framerailDir,'static'),
  path.join(framerailDir,'package.json'),
  path.join(framerailDir,'server.js'),
  path.join(framerailDir,'svelte.config.js'),
  path.join(framerailDir,'tsconfig.json'),
  path.join(framerailDir,'vite.config.js'),
  path.join(repoRoot,'pnpm-lock.yaml')
];

function run(command,args,{cwd=repoRoot,env=process.env,stdio='pipe'}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd,env,stdio});
  let stdout='',stderr='';
  if(child.stdout)child.stdout.on('data',chunk=>stdout+=chunk);
  if(child.stderr)child.stderr.on('data',chunk=>stderr+=chunk);
  child.once('error',reject);
  child.once('close',code=>code===0?resolve({stdout,stderr}):reject(new Error(`${command} exited ${code}: ${stderr.slice(-4000)}`)));
 });
}

async function filesBelow(entry){
 const stat=await fs.stat(entry);
 if(stat.isFile())return[entry];
 const output=[];
 for(const item of await fs.readdir(entry,{withFileTypes:true})){
  if(['node_modules','.svelte-kit','build'].includes(item.name))continue;
  const child=path.join(entry,item.name);
  if(item.isDirectory())output.push(...await filesBelow(child));
  else if(item.isFile())output.push(child);
 }
 return output;
}

async function sourceFingerprint(){
 const hash=crypto.createHash('sha256');
 const files=[];
 for(const entry of buildInputs){try{files.push(...await filesBelow(entry))}catch(error){if(error.code!=='ENOENT')throw error}}
 files.sort();
 for(const file of files){
  hash.update(path.relative(repoRoot,file));hash.update('\0');
  hash.update(await fs.readFile(file));hash.update('\0');
 }
 return hash.digest('hex');
}

async function inspectContainer(name){
 try{return JSON.parse((await run('docker',['inspect',name,'--format','{{json .}}'])).stdout.trim())}
 catch{return null}
}

async function isReady(){
 try{await run('curl',['-ksSf','--max-time','2',`${transportOrigin}/run-owned%3Atheme-lab-visual-acceptance-imported-20260924`]);return true}catch{return false}
}

async function buildSource(fingerprint){
 const buildDir=path.join(cacheBase,fingerprint);
 const ready=path.join(buildDir,'.theme-lab-built-ready');
 try{await fs.access(ready);return{buildDir,built:false}}catch{}
 await fs.rm(buildDir,{recursive:true,force:true});
 await fs.mkdir(buildDir,{recursive:true});
 await run('rsync',['-a','--delete','--exclude','node_modules','--exclude','.svelte-kit','--exclude','build',`${framerailDir}/`,`${buildDir}/`]);
 await fs.symlink(path.join(framerailDir,'node_modules'),path.join(buildDir,'node_modules'));
 const copiedFingerprint=await sourceFingerprint();
 if(copiedFingerprint!==fingerprint)throw new Error('Framerail source changed while preparing the built capture runtime; retry after the current edit settles');
 await run(path.join(buildDir,'node_modules/.bin/vite'),['build'],{cwd:buildDir});
 const afterFingerprint=await sourceFingerprint();
 if(afterFingerprint!==fingerprint)throw new Error('Framerail source changed during the built capture runtime build; retry so evidence cannot use a stale build');
 await fs.writeFile(ready,`${fingerprint}\n`);
 return{buildDir,built:true};
}

async function startContainers(fingerprint,buildDir){
 const running=await inspectContainer(framerailContainer);
 const currentFingerprint=running?.Config?.Labels?.['theme-lab.source-sha'];
 if(currentFingerprint===fingerprint&&await isReady())return{restarted:false};

 const dev=await inspectContainer(devContainer);
 if(!dev)throw new Error(`required local-development container ${devContainer} is not running`);
 const network=Object.keys(dev.NetworkSettings?.Networks??{})[0];
 if(!network)throw new Error('could not determine the local-development Docker network');
 await run('docker',['rm','-f',caddyContainer,framerailContainer]).catch(()=>{});
 const created=[];
 try{

 const envFile=path.join(os.tmpdir(),`theme-lab-built-env-${process.pid}`);
 const envLines=(dev.Config?.Env??[]).filter(value=>value.includes('=')).map(value=>{
  const [key,...rest]=value.split('=');
  if(key==='FRAMERAIL_MODE')return 'FRAMERAIL_MODE=built';
  if(key==='PORT')return 'PORT=3393';
  return `${key}=${rest.join('=')}`;
 });
 if(!envLines.some(line=>line.startsWith('FRAMERAIL_MODE=')))envLines.push('FRAMERAIL_MODE=built');
 if(!envLines.some(line=>line.startsWith('PORT=')))envLines.push('PORT=3393');
 await fs.writeFile(envFile,envLines.join('\n')+'\n',{mode:0o600});
 try{
  const args=['run','-d','--rm','--name',framerailContainer,'--network',network,'--label',`theme-lab.source-sha=${fingerprint}`,'--env-file',envFile,'-e','FRAMERAIL_MODE=built','-e','PORT=3393','-v',`${buildDir}:/app`];
  for(const mount of dev.Mounts??[]){
   if(mount.Destination==='/app/node_modules'&&mount.Type==='volume')args.push('-v',`${mount.Name}:/app/node_modules`);
   if(mount.Destination==='/pnpm'&&mount.Type==='volume')args.push('-v',`${mount.Name}:/pnpm`);
   if(mount.Destination==='/app/src/assets'&&mount.Type==='bind')args.push('-v',`${mount.Source}:/app/src/assets:ro`);
  }
  args.push(dev.Config.Image);
  await run('docker',args);
  created.push(framerailContainer);
 }finally{await fs.rm(envFile,{force:true})}

 const caddyFile=path.join(cacheBase,'Caddyfile');
 await fs.mkdir(cacheBase,{recursive:true});
 await fs.writeFile(caddyFile,`{
  auto_https disable_redirects
}
https://scpaiueouiuiuiui.wikijump.localhost {
  tls internal
  reverse_proxy ${framerailContainer}:3393 {
    header_up X-Wikijump-Site-Id 6000003
    header_up X-Wikijump-Site-Slug scpaiueouiuiuiui
  }
}
`);
 await run('docker',['run','-d','--rm','--name',caddyContainer,'--network',network,'-p','127.0.0.1:3395:443','-v',`${caddyFile}:/etc/caddy/Caddyfile:ro`,'caddy:alpine','caddy','run','--config','/etc/caddy/Caddyfile','--adapter','caddyfile']);
 created.push(caddyContainer);

 for(let attempt=0;attempt<60;attempt++){
  if(await isReady())return{restarted:true};
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw new Error('built Framerail capture sidecar did not become ready');
 }catch(error){
  if(created.length)await run('docker',['rm','-f',...created.reverse()]).catch(()=>{});
  throw error;
 }
}

await fs.mkdir(cacheBase,{recursive:true});
await withAuditLock(path.join(cacheBase,'bootstrap'),async()=>{
const started=Date.now();
let attempts=0;
while(true){
 attempts++;
 const fingerprint=await sourceFingerprint();
 try{
  const build=await buildSource(fingerprint);
  const containers=await startContainers(fingerprint,build.buildDir);
  console.log(JSON.stringify({schema:'theme_lab_built_framerail.v1',transport_origin:transportOrigin,source_sha256:fingerprint,built:build.built,restarted:containers.restarted,attempts,elapsed_ms:Date.now()-started}));
  break;
 }catch(error){
  if(/source changed/iu.test(error.message)&&attempts<3)continue;
  throw error;
 }
}

},{attempts:12000});
