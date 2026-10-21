#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {currentFullCheckBackend,currentFullCheckPaths} from '../src/current-full-check-options.mjs';
import {resolveExistingContainedFile} from '../src/package-path.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const lab=path.resolve(here,'..');
const repo=path.resolve(lab,'../../..');
const ports=path.join(lab,'ports');
const positional=process.argv.slice(2).filter(arg=>!arg.startsWith('--'));
const options=process.argv.slice(2).filter(arg=>arg.startsWith('--'));
if(positional.length<1||positional.length>2||options.some(arg=>!/^--(?:run-id|run-contract|backend-project|rpc-url)=.+/u.test(arg)))
 throw new Error('usage: run-current-full-check.mjs <package> [reference-cache-dir] --run-id=<unique-task-id> [--run-contract=<path>] [--backend-project=wikijump-theme-lab-NAME --rpc-url=http://127.0.0.1:PORT/jsonrpc]');
const name=positional[0];
const referenceCacheDir=positional[1]?path.resolve(positional[1]):null;
const optionValue=key=>options.filter(arg=>arg.startsWith(`--${key}=`)).map(arg=>arg.slice(key.length+3));
if(optionValue('run-id').length!==1||optionValue('run-contract').length>1||optionValue('backend-project').length>1||optionValue('rpc-url').length>1)throw new Error('a single --run-id and at most one --run-contract, --backend-project and --rpc-url are required');
const backend=currentFullCheckBackend({backendProject:optionValue('backend-project')[0],rpcUrl:optionValue('rpc-url')[0]});
const ledger=JSON.parse(fs.readFileSync(path.join(ports,'adaptation-authority.json'),'utf8'));
const pkg=ledger.packages[name];
if(!pkg)throw new Error(`unknown package: ${name}`);
const contractPath=optionValue('run-contract')[0]
 ?resolveExistingContainedFile(lab,path.resolve(optionValue('run-contract')[0]),'current run contract')
 :path.join(ports,'current-acceptance/run-contract.json');
const runContract=JSON.parse(fs.readFileSync(contractPath,'utf8'));
if(!runContract.expected_runtime_source_sha256||!runContract.expected_backend_runtime_identity?.identity_sha256)throw new Error('current Sigma-9 runtime contract is incomplete');
const paths=currentFullCheckPaths(lab,name,optionValue('run-id')[0],runContract);
const candidateUrl=paths.fixtureUrl;
if(fs.existsSync(paths.runDir))throw new Error(`${name}: run ID already exists; use a fresh --run-id instead of overwriting evidence`);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

function preflight(url){
 let output;
 try {output=execFileSync('curl',['-ksS','-D','-','-o','/dev/null','--max-time','8',url],{encoding:'utf8'});}
 catch(error){throw new Error(`${name}: contracted fixture origin is unreachable; provision the source-bound built Framerail transport before capture (${error.stderr?.trim()||error.message})`);}
 const status=Number.parseInt(output.match(/^HTTP\/\S+\s+(\d+)/mi)?.[1]??'',10);
 if(!Number.isInteger(status)||status<200||status>=400)throw new Error(`${name}: candidate fixture returned HTTP ${status||'unknown'}: ${url}`);
 const runtime=output.match(/^x-theme-lab-runtime-source-sha:\s*([a-f0-9]{64})\s*$/mi)?.[1];
 const backend=output.match(/^x-theme-lab-backend-identity-sha:\s*([a-f0-9]{64})\s*$/mi)?.[1];
 if(runtime!==runContract.expected_runtime_source_sha256)throw new Error(`${name}: fixture is missing the expected source-bound Framerail runtime header or differs from the run contract`);
 if(backend!==runContract.expected_backend_runtime_identity.identity_sha256)throw new Error(`${name}: fixture is missing the expected source-bound Deepwell identity header or differs from the run contract`);
}

function linkAssets(){
 const root=path.join(os.tmpdir(),'theme-lab-current-full-check-assets',name,optionValue('run-id')[0]);
 fs.rmSync(root,{recursive:true,force:true});fs.mkdirSync(root,{recursive:true});
 const sources=[path.join(ports,'shared-replay-assets'),path.join(ports,name,'assets')];
 for(const source of sources){
  if(!fs.existsSync(source))continue;
  for(const entry of fs.readdirSync(source,{withFileTypes:true})){
   if(!entry.isFile())continue;
   const src=path.join(source,entry.name),dst=path.join(root,entry.name);
   if(fs.existsSync(dst)){
    if(sha(fs.readFileSync(src))!==sha(fs.readFileSync(dst)))throw new Error(`${name}: conflicting asset filename ${entry.name}`);
    continue;
   }
   try{fs.linkSync(src,dst)}catch{fs.copyFileSync(src,dst)}
  }
 }
 return root;
}

preflight(candidateUrl);
const dockerEnv=execFileSync('docker',['inspect',backend.containerName,'--format','{{range .Config.Env}}{{println .}}{{end}}'],{encoding:'utf8'});
const token=dockerEnv.split(/\r?\n/u).find(line=>line.startsWith('DEEPWELL_RPC_TOKEN='))?.slice('DEEPWELL_RPC_TOKEN='.length);
if(!token)throw new Error('current local Deepwell RPC token is unavailable');
const childEnv={...process.env,DEEPWELL_RPC_TOKEN:token};
const dir=path.join(ports,name),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
const sourceFile=pkg.source_file??(fs.existsSync(path.join(dir,'candidate.wikidot.source.txt'))?'candidate.wikidot.source.txt':'candidate.wikidot.txt');
const ref=manifest.reference_url??manifest.source_url;
if(!ref)throw new Error(`${name}: no current reference URL`);
const rel=p=>path.relative(lab,p);
const selectors=fs.existsSync(path.join(dir,'acceptance-selectors.txt'))?rel(path.join(dir,'acceptance-selectors.txt')):'ports/shared-acceptance-selectors.txt';
const contract=fs.existsSync(path.join(dir,'surface-contract.json'))?rel(path.join(dir,'surface-contract.json')):'auto';
const structure=fs.existsSync(path.join(dir,'acceptance-structure.json'))?rel(path.join(dir,'acceptance-structure.json')):null;
const pageAssets=fs.existsSync(path.join(dir,'page-assets.json'))?rel(path.join(dir,'page-assets.json')):null;
const baseCss=fs.existsSync(path.join(dir,'candidate-base.css'))?rel(path.join(dir,'candidate-base.css')):null;
const safe=name.replace(/[^a-z0-9-]/giu,'-');
const runSuffix=`${safe}-${optionValue('run-id')[0]}`;
// Unix-domain socket path length is bounded even when the task ID is long.
const socket=path.join(os.tmpdir(),`theme-lab-${sha(runSuffix).slice(0,24)}.sock`);
const logFile=path.join(os.tmpdir(),`theme-lab-current-full-${runSuffix}.log`);
const artifactDir=paths.artifactsDir;
if(fs.existsSync(socket))throw new Error(`${name}: capture socket already exists: ${socket}`);
fs.mkdirSync(artifactDir,{recursive:true});
const assetDir=linkAssets();
const daemonArgs=['scripts/theme-lab.mjs','serve','--socket',socket,'--candidate-url',candidateUrl,'--browser-root','../../../framerail','--asset-dir',assetDir,'--header-html','fixtures/scp-jp-header.html','--navigation-html','fixtures/scp-jp-navigation.html','--sidebar-html','fixtures/scp-jp-sidebar.html','--baseline-css','fixtures/scp-jp-sigma9-offline.css','--allow-private'];
if(referenceCacheDir)daemonArgs.push('--cache-dir',referenceCacheDir);
if(backend.rpcUrl)daemonArgs.push('--rpc-url',backend.rpcUrl);
const log=fs.openSync(logFile,'a');const daemon=spawn(process.execPath,daemonArgs,{cwd:lab,env:childEnv,stdio:['ignore',log,log]});
try{
 const started=Date.now();while(!fs.existsSync(socket)){if(daemon.exitCode!==null)throw new Error(`${name}: daemon exited ${daemon.exitCode}; see ${logFile}`);if(Date.now()-started>30000)throw new Error(`${name}: daemon socket timeout`);await new Promise(r=>setTimeout(r,150));}
 const args=['scripts/theme-lab.mjs','check','--socket',socket,'--site-id','6000003','--title','Preview','--css',rel(path.join(dir,'candidate.css')),'--wikitext',rel(path.join(dir,'candidate.wikidot.txt')),'--source',rel(path.join(dir,sourceFile)),'--reference',ref,'--offline','--selectors',selectors,'--surface-contract',contract,'--visual','--artifact-dir',artifactDir,'--json-full','--compact'];
 if(structure)args.push('--source-structure',structure);if(pageAssets)args.push('--page-assets',pageAssets);if(baseCss)args.push('--css-base',baseCss);
 const stdoutFile=path.join(paths.runDir,'check.stdout');
 const stderrFile=path.join(paths.runDir,'check.stderr');
 const out=fs.openSync(stdoutFile,'w'),err=fs.openSync(stderrFile,'w');let run;
 try{run=spawnSync(process.execPath,args,{cwd:lab,env:childEnv,stdio:['ignore',out,err],timeout:300000});}finally{fs.closeSync(out);fs.closeSync(err)}
 if(run.error)throw run.error;if(run.signal)throw new Error(`${name}: check terminated by ${run.signal}`);
 const stdout=fs.readFileSync(stdoutFile,'utf8');let doc;try{doc=JSON.parse(stdout)}catch(error){throw new Error(`${name}: invalid check JSON (${error.message}); stderr=${fs.readFileSync(stderrFile,'utf8').slice(0,800)}`)}
 const result=doc.result??doc;
 if(result.target_runtime_identity?.response_status!==200)throw new Error(`${name}: full check did not bind to HTTP 200 candidate response`);
 if(result.target_runtime_identity?.source_sha256!==runContract.expected_runtime_source_sha256)throw new Error(`${name}: full check Framerail identity mismatch`);
 if(result.target_runtime_identity?.backend_runtime_identity?.identity_sha256!==runContract.expected_backend_runtime_identity.identity_sha256)throw new Error(`${name}: full check Deepwell identity mismatch`);
 const rawPath=paths.rawResultPath;fs.writeFileSync(rawPath,JSON.stringify(doc,null,2)+'\n',{flag:'wx'});
 let old={};const reviewPath=path.join(ports,'current-acceptance',name,'visual-review.json');if(fs.existsSync(reviewPath))old=JSON.parse(fs.readFileSync(reviewPath,'utf8'));
 const matches={};for(const [vp,row] of Object.entries(result.visual?.viewports??{})){const prior=old.viewports?.[vp]??{};matches[vp]=prior.candidate_screenshot_sha256===row.candidate_screenshot_sha256&&prior.reference_screenshot_sha256===row.reference_screenshot_sha256;}
 console.log(JSON.stringify({package:name,status:'captured',verdict:result.verdict,target_status:result.target_acceptance?.status,contract:result.target_acceptance_contract_sha256,visual_matches_review:matches,raw:path.relative(repo,rawPath),artifacts:path.relative(repo,artifactDir)}));
}finally{
 spawnSync(process.execPath,['scripts/theme-lab.mjs','stop','--socket',socket],{cwd:lab,env:childEnv,stdio:'ignore',timeout:20000});if(daemon.exitCode===null)daemon.kill('SIGTERM');fs.closeSync(log);fs.rmSync(socket,{force:true});
}
