import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import test from 'node:test';
import {VISUAL_GATE_POLICY_SHA256} from '../src/visual-gate.mjs';
import {createDeepwellRuntimeIdentity,DEEPWELL_RUNTIME_HEADERS} from '../src/deepwell-runtime-identity.mjs';

const runner = new URL('../ports/interactive-visual-fixture/capture-theme-matrix.mjs', import.meta.url);
const lockFile = new URL('../ports/scripts/audit-lock.mjs', import.meta.url);
const helperFiles=['audit-shard-merge.mjs','capture-audit-records.mjs'];
const lock = lockFile.href;
const runtimeSha='a'.repeat(64);
const backendRuntimeIdentity=createDeepwellRuntimeIdentity({source_sha256:'b'.repeat(64),ftml_git_revision:'c'.repeat(40),container_id:'d'.repeat(64),image_id:`sha256:${'e'.repeat(64)}`,binary_sha256:'f'.repeat(64),config_sha256:'1'.repeat(64)});
const backendValues={sourceSha256:backendRuntimeIdentity.source_sha256,ftmlGitRevision:backendRuntimeIdentity.ftml_git_revision,containerId:backendRuntimeIdentity.container_id,imageId:backendRuntimeIdentity.image_id,binarySha256:backendRuntimeIdentity.binary_sha256,configSha256:backendRuntimeIdentity.config_sha256,identitySha256:backendRuntimeIdentity.identity_sha256};
const backendHeaders=Object.fromEntries(Object.entries(DEEPWELL_RUNTIME_HEADERS).map(([key,name])=>[name,backendValues[key]]));

async function fixture(operation) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matrix-runner-'));
  const scripts = path.join(dir, 'fixture');
  const support = path.join(dir, 'scripts');
  const bin=path.join(dir,'bin');
  await fs.mkdir(scripts);
  await fs.mkdir(support);
  await fs.mkdir(bin);
  const runnerSource=(await fs.readFile(runner,'utf8')).replace('../../src/visual-gate.mjs',new URL('../src/visual-gate.mjs',import.meta.url).href).replace('../../src/runtime-source-identity.mjs',new URL('../src/runtime-source-identity.mjs',import.meta.url).href).replace('../../src/deepwell-runtime-identity.mjs',new URL('../src/deepwell-runtime-identity.mjs',import.meta.url).href);
  await fs.writeFile(path.join(scripts,'capture-theme-matrix.mjs'),runnerSource);
  await fs.copyFile(lockFile, path.join(support, 'audit-lock.mjs'));
  for(const filename of helperFiles)await fs.copyFile(new URL(`../ports/scripts/${filename}`,import.meta.url),path.join(support,filename));
  await fs.writeFile(path.join(dir, 'en-theme-campaign.json'), JSON.stringify({themes: [{slug: 'theme:test'}]}));
  await fs.writeFile(path.join(scripts,'acceptance-run-contract.json'),JSON.stringify({expected_runtime_source_sha256:runtimeSha,expected_backend_runtime_identity:backendRuntimeIdentity,target_site:{origin:'https://fixture.localhost:3395'}}));
  await fs.writeFile(path.join(bin,'curl'),`#!${process.execPath}
    const scenario=process.env.SCENARIO;
    const sha=scenario==='runtime-header-mismatch'?'b'.repeat(64):'a'.repeat(64);
    if(scenario==='runtime-header-missing')process.stdout.write('HTTP/2 200\\r\\n\\r\\n');
    else process.stdout.write('HTTP/2 200\\r\\nx-theme-lab-runtime-source-sha: '+sha+'\\r\\n'+Object.entries(JSON.parse(process.env.BACKEND_HEADERS)).map(([name,value])=>name+': '+value+'\\r\\n').join('')+'\\r\\n');
  `,{mode:0o755});
  await fs.writeFile(path.join(scripts, 'ensure-built-framerail.mjs'), `
    if(process.env.SCENARIO==='built-failure') throw new Error('sidecar unavailable');
    console.log(JSON.stringify({transport_origin:'https://fixture.localhost:3395',source_sha256:process.env.SCENARIO==='built-source-mismatch'?'${'b'.repeat(64)}':'${runtimeSha}',backend_runtime_identity:${JSON.stringify(backendRuntimeIdentity)},backend_probe:{ok:true}}));
  `);
  await fs.writeFile(path.join(scripts, 'capture-interactive.mjs'), `
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import {withAuditLock} from ${JSON.stringify(lock)};
    const arg = name => process.argv.find(v=>v.startsWith('--'+name+'='))?.split('=')[1];
    const engine=arg('engine'), viewport=arg('viewport');
    const theme=arg('theme')??arg('themes')?.split(',')[0]??'test';
    const auditPath=process.env.THEME_LAB_INTERACTIVE_AUDIT_PATH;
    if(!process.argv.includes('--anonymous'))throw new Error('anonymous not forwarded');
    if(arg('transport-origin')!=='https://fixture.localhost:3395')throw new Error('transport not forwarded');
    if(process.env.EXPECT_RUN_CONTRACT && arg('run-contract')!==process.env.EXPECT_RUN_CONTRACT)throw new Error('run contract not forwarded');
    if(process.env.SCENARIO==='child-failure' && engine==='chromium' && viewport==='desktop')throw new Error('child failed');
    const retry=arg('concurrency')==='2';
    const failed=process.env.SCENARIO==='exhausted'||(process.env.SCENARIO==='retry'&&!retry);
    let priorMarker=null;
    if(process.env.THEME_LAB_AUDIT_SEED_PATH){const seed=JSON.parse(await fs.readFile(process.env.THEME_LAB_AUDIT_SEED_PATH,'utf8'));priorMarker=seed.records?.find(row=>row.surface==='page.normal'&&row.state==='settled')?.marker??null}
    if(process.env.CALLS_PATH)await fs.appendFile(process.env.CALLS_PATH,JSON.stringify({engine,viewport,retry,states:arg('state'),prior_marker:priorMarker})+'\\n');
    const row={theme,browser_engine:engine,viewport,surface:'page.normal',state:'settled',screenshot:'x.png',screenshot_sha256:'a'.repeat(64),runtime_source_sha256:'${runtimeSha}',backend_runtime_identity:${JSON.stringify(backendRuntimeIdentity)},backend_runtime_identity_sha256:${JSON.stringify(backendRuntimeIdentity.identity_sha256)},
      visual_gate:{class:'V',policy_sha256:${JSON.stringify(VISUAL_GATE_POLICY_SHA256)}},
      unconfirmed_items:failed?['action/capture failed: test']:[],asset_failures:[],page_errors:[],external_requests_sent:0};
    if(process.env.THEME_LAB_AUDIT_SHARD_DIR){
      await fs.mkdir(process.env.THEME_LAB_AUDIT_SHARD_DIR,{recursive:true});
      const key=theme+'|'+engine+'|'+viewport+'|page.normal|settled';
      const shard={schema:'theme_lab_interactive_audit_delta.v1',remove_keys:[key],records:[row],superseded_records:[],visual_review_reuse_updates:0,document_patch:{}};
      const destination=path.join(process.env.THEME_LAB_AUDIT_SHARD_DIR,engine+'__'+viewport+'.json');await fs.writeFile(destination+'.tmp',JSON.stringify(shard));await fs.rename(destination+'.tmp',destination);
      process.exit(0);
    }
    await withAuditLock(auditPath, async()=>{
      let audit;try{audit=JSON.parse(await fs.readFile(auditPath))}catch{audit={records:[]}}
      audit.records=audit.records.filter(r=>r.browser_engine!==engine||r.viewport!==viewport||r.state!=='settled');
      audit.records.push(row);
      await fs.writeFile(auditPath,JSON.stringify(audit));
    });
  `);
  const priorPath=process.env.PATH;
  process.env.PATH=`${bin}${path.delimiter}${priorPath??''}`;
  try { await operation({dir, script:path.join(scripts,'capture-theme-matrix.mjs')}); }
  finally { process.env.PATH=priorPath;await fs.rm(dir,{recursive:true,force:true}); }
}

for (const scenario of ['success', 'retry', 'exhausted', 'child-failure', 'built-failure','built-source-mismatch']) {
  test(`matrix orchestration: ${scenario}`, async()=>fixture(async({dir,script})=>{
    const auditPath=path.join(dir,'shadow.json');
    const callsPath=path.join(dir,'calls.jsonl');
    const unrelated={theme:'test',browser_engine:'chromium',viewport:'desktop',surface:'page.history',state:'list',
      unconfirmed_items:['action/capture failed: unrelated']};
    await fs.writeFile(auditPath,JSON.stringify({records:[unrelated]}));
    const result=spawnSync(process.execPath,[script,'--theme=test','--jobs=3','--anonymous','--state=page.normal.settled'],{
      cwd:os.tmpdir(),encoding:'utf8',timeout:15000,
      env:{...process.env,SCENARIO:scenario,BACKEND_HEADERS:JSON.stringify(backendHeaders),THEME_LAB_INTERACTIVE_AUDIT_PATH:auditPath,CALLS_PATH:callsPath}
    });
    const audit=JSON.parse(await fs.readFile(auditPath));
    const calls=(await fs.readFile(callsPath,'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.deepEqual(audit.records.find(r=>r.surface==='page.history'),unrelated);
    if(['success','retry'].includes(scenario)){
      assert.equal(result.status,0,result.stderr);
      const summary=JSON.parse(result.stdout.trim().split('\n').at(-1));
      assert.equal(summary.successful_states,9);
      assert.equal(summary.retried_states,scenario==='retry'?9:0);
      assert.equal(calls.length,scenario==='retry'?18:9);
      assert.ok(calls.every(call=>call.states==='page.normal.settled'));
    }else{
      assert.notEqual(result.status,0);
      assert.match(result.stderr,scenario==='exhausted'?/after targeted retries/:scenario==='built-failure'?/sidecar unavailable/:scenario==='built-source-mismatch'?/does not match run contract/u:/child failed/);
      if(scenario==='exhausted')assert.equal(calls.length,27);
      if(scenario==='built-failure')assert.equal(calls.length,0);
      if(scenario==='built-source-mismatch')assert.equal(calls.length,0);
      if(scenario==='child-failure'){
        const partial=JSON.parse(await fs.readFile(auditPath,'utf8'));
        assert.ok(partial.records.some(row=>row.surface==='page.normal'&&row.screenshot==='x.png'),'Successful parallel captures must survive a failed worker');
      }
      // No child may keep writing after the runner reports failure.
      const snapshot=await fs.readFile(auditPath,'utf8');
      await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(await fs.readFile(auditPath,'utf8'),snapshot);
    }
  }));
}

test('matrix retries compare against the immutable run-start prior row',async()=>fixture(async({dir,script})=>{
 const auditPath=path.join(dir,'retry-prior.json'),callsPath=path.join(dir,'retry-prior-calls.jsonl');
 const prior={theme:'test',browser_engine:'chromium',viewport:'desktop',surface:'page.normal',state:'settled',marker:'retained-prior'};
 await fs.writeFile(auditPath,JSON.stringify({records:[prior]}));
 const result=spawnSync(process.execPath,[script,'--theme=test','--jobs=3','--anonymous','--state=page.normal.settled'],{
  cwd:os.tmpdir(),encoding:'utf8',timeout:15000,
  env:{...process.env,SCENARIO:'retry',BACKEND_HEADERS:JSON.stringify(backendHeaders),THEME_LAB_INTERACTIVE_AUDIT_PATH:auditPath,CALLS_PATH:callsPath}
 });
 assert.equal(result.status,0,result.stderr);
 const calls=(await fs.readFile(callsPath,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 const desktopChromium=calls.filter(call=>call.engine==='chromium'&&call.viewport==='desktop');
 assert.equal(desktopChromium.length,2);
 assert.ok(desktopChromium.every(call=>call.prior_marker==='retained-prior'));
}));


test('matrix warns when anonymous capture omits a public state subset',async()=>fixture(async({dir,script})=>{
 const auditPath=path.join(dir,'warn.json');
 const callsPath=path.join(dir,'warn-calls.jsonl');
 await fs.writeFile(auditPath,JSON.stringify({records:[]}));
 const result=spawnSync(process.execPath,[script,'--theme=test','--jobs=3','--anonymous'],{
  cwd:os.tmpdir(),encoding:'utf8',timeout:15000,
  env:{...process.env,SCENARIO:'success',BACKEND_HEADERS:JSON.stringify(backendHeaders),THEME_LAB_INTERACTIVE_AUDIT_PATH:auditPath,CALLS_PATH:callsPath}
 });
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stderr,/--anonymous cannot capture states/);
 const summary=JSON.parse(result.stdout.trim().split('\n').at(-1));
 assert.equal(summary.successful_states,9);
}));

test('matrix reuses an explicit task-owned transport without bootstrapping the default sidecar',async()=>fixture(async({dir,script})=>{
 const auditPath=path.join(dir,'explicit.json');
 const callsPath=path.join(dir,'explicit-calls.jsonl');
 await fs.writeFile(auditPath,JSON.stringify({records:[]}));
 let capture=await fs.readFile(path.join(path.dirname(script),'capture-interactive.mjs'),'utf8');
 capture=capture.replace("'https://fixture.localhost:3395'","'https://scpaiueouiuiuiui.wikijump.localhost:3398'");
 await fs.writeFile(path.join(path.dirname(script),'capture-interactive.mjs'),capture);
 const result=spawnSync(process.execPath,[script,'--theme=test','--jobs=3','--anonymous','--state=page.normal.settled','--transport-origin=https://scpaiueouiuiuiui.wikijump.localhost:3398'],{
  cwd:os.tmpdir(),encoding:'utf8',timeout:15000,
   env:{...process.env,SCENARIO:'built-failure',BACKEND_HEADERS:JSON.stringify(backendHeaders),THEME_LAB_INTERACTIVE_AUDIT_PATH:auditPath,CALLS_PATH:callsPath}
 });
 assert.equal(result.status,0,result.stderr);
 const summary=JSON.parse(result.stdout.trim().split('\n').at(-1));
 assert.equal(summary.transport,'explicit');
 assert.equal(summary.transport_origin,'https://scpaiueouiuiuiui.wikijump.localhost:3398');
 assert.equal(summary.successful_states,9);
}));

test('matrix fails closed on an explicit runtime header mismatch and a missing built runtime header',async()=>{
 for(const scenario of ['runtime-header-mismatch','runtime-header-missing'])await fixture(async({dir,script})=>{
  const auditPath=path.join(dir,`${scenario}.json`),callsPath=path.join(dir,`${scenario}-calls.jsonl`);
  await fs.writeFile(auditPath,JSON.stringify({records:[]}));
  const args=[script,'--theme=test','--jobs=1','--anonymous','--state=page.normal.settled'];
  if(scenario==='runtime-header-mismatch'){
   let capture=await fs.readFile(path.join(path.dirname(script),'capture-interactive.mjs'),'utf8');
   capture=capture.replace("'https://fixture.localhost:3395'","'https://scpaiueouiuiuiui.wikijump.localhost:3398'");
   await fs.writeFile(path.join(path.dirname(script),'capture-interactive.mjs'),capture);
   args.push('--transport-origin=https://scpaiueouiuiuiui.wikijump.localhost:3398');
  }
  const result=spawnSync(process.execPath,args,{cwd:os.tmpdir(),encoding:'utf8',timeout:15000,
   env:{...process.env,SCENARIO:scenario,BACKEND_HEADERS:JSON.stringify(backendHeaders),THEME_LAB_INTERACTIVE_AUDIT_PATH:auditPath,CALLS_PATH:callsPath}});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,scenario==='runtime-header-mismatch'?/does not match run contract/u:/missing a valid/u);
  assert.equal((await fs.readFile(callsPath,'utf8').catch(()=>'' )).trim(),'');
 });
});

test('matrix isolates a run-contract campaign and forwards its additional candidate',async()=>fixture(async({dir,script})=>{
 const campaignDir=path.join(dir,'sigma10-migration');
 const runContractPath=path.join(campaignDir,'run-contract.json');
 const auditPath=path.join(campaignDir,'evidence','interactive-visual-audit.json');
 await fs.mkdir(campaignDir,{recursive:true});
 await fs.writeFile(runContractPath,JSON.stringify({
  expected_runtime_source_sha256:'a'.repeat(64),
  expected_backend_runtime_identity:backendRuntimeIdentity,
  target_site:{origin:'https://fixture.localhost:3395'},
  artifact_namespace:'migration/sigma10',
  audit_path:'evidence/interactive-visual-audit.json',
  additional_candidates:{'sigma10-baseline':{directory:'baseline-probe'}},
 }));
 const result=spawnSync(process.execPath,[script,'--theme=sigma10-baseline','--jobs=3','--anonymous','--state=page.normal.settled',`--run-contract=${runContractPath}`],{
  cwd:os.tmpdir(),encoding:'utf8',timeout:15000,
  env:{...process.env,SCENARIO:'success',BACKEND_HEADERS:JSON.stringify(backendHeaders),EXPECT_RUN_CONTRACT:runContractPath}
 });
 assert.equal(result.status,0,result.stderr);
 const audit=JSON.parse(await fs.readFile(auditPath));
 assert.equal(audit.records.length,9);
 assert.ok(audit.records.every(row=>row.theme==='sigma10-baseline'));
 const summary=JSON.parse(result.stdout.trim().split('\n').at(-1));
 assert.equal(summary.successful_states,9);
}));

test('matrix rejects a custom contract targeting accepted audit evidence',async()=>fixture(async({dir,script})=>{
 const campaignDir=path.join(dir,'sigma10-migration');
 await fs.mkdir(campaignDir,{recursive:true});
 const runContractPath=path.join(campaignDir,'run-contract.json');
 await fs.writeFile(runContractPath,JSON.stringify({artifact_namespace:'migration/sigma10',audit_path:'../interactive-visual-audit.json'}));
 const result=spawnSync(process.execPath,[script,'--theme=test','--anonymous',`--run-contract=${runContractPath}`],{encoding:'utf8',timeout:10000});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/custom run contract audit/);
 assert.equal(await fs.readFile(path.join(dir,'interactive-visual-audit.json'),'utf8').catch(()=>null),null);
}));

test('matrix interruption terminates and reaps active captures',async()=>fixture(async({dir,script})=>{
 const pids=path.join(dir,'pids');
 await fs.writeFile(path.join(path.dirname(script),'capture-interactive.mjs'),`
  import fs from 'node:fs';
  fs.appendFileSync(${JSON.stringify(pids)},process.pid+'\\n');
  setInterval(()=>{},1000);
 `);
 const child=spawn(process.execPath,[script,'--theme=test','--jobs=3','--anonymous'],{
  cwd:dir,stdio:'ignore',env:{...process.env,BACKEND_HEADERS:JSON.stringify(backendHeaders),THEME_LAB_INTERACTIVE_AUDIT_PATH:path.join(dir,'audit.json')}
 });
 const exited=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 try{
  let ids=[];
  for(let attempt=0;attempt<200;attempt++){
   ids=(await fs.readFile(pids,'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(Number);
   if(ids.length===3)break;
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(ids.length,3);
  child.kill('SIGTERM');
  const result=await exited;
  assert.notEqual(result.code,0);
  for(const pid of ids)assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 }finally{if(child.exitCode===null&&!child.killed)child.kill('SIGKILL')}
}));
