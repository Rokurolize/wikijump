import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import test from 'node:test';

const runner = new URL('../ports/interactive-visual-fixture/capture-theme-matrix.mjs', import.meta.url);
const lockFile = new URL('../ports/scripts/audit-lock.mjs', import.meta.url);
const lock = lockFile.href;

async function fixture(operation) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matrix-runner-'));
  const scripts = path.join(dir, 'fixture');
  const support = path.join(dir, 'scripts');
  await fs.mkdir(scripts);
  await fs.mkdir(support);
  await fs.copyFile(runner, path.join(scripts, 'capture-theme-matrix.mjs'));
  await fs.copyFile(lockFile, path.join(support, 'audit-lock.mjs'));
  await fs.writeFile(path.join(dir, 'en-theme-campaign.json'), JSON.stringify({themes: [{slug: 'theme:test'}]}));
  await fs.writeFile(path.join(scripts, 'ensure-built-framerail.mjs'), `
    if(process.env.SCENARIO==='built-failure') throw new Error('sidecar unavailable');
    console.log(JSON.stringify({transport_origin:'https://fixture.localhost:3395'}));
  `);
  await fs.writeFile(path.join(scripts, 'capture-interactive.mjs'), `
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import {withAuditLock} from ${JSON.stringify(lock)};
    const arg = name => process.argv.find(v=>v.startsWith('--'+name+'='))?.split('=')[1];
    const engine=arg('engine'), viewport=arg('viewport');
    const auditPath=process.env.THEME_LAB_INTERACTIVE_AUDIT_PATH;
    if(!process.argv.includes('--anonymous'))throw new Error('anonymous not forwarded');
    if(arg('transport-origin')!=='https://fixture.localhost:3395')throw new Error('transport not forwarded');
    if(process.env.SCENARIO==='child-failure' && engine==='chromium' && viewport==='desktop')throw new Error('child failed');
    const retry=arg('concurrency')==='2';
    const failed=process.env.SCENARIO==='exhausted'||(process.env.SCENARIO==='retry'&&!retry);
    if(process.env.CALLS_PATH)await fs.appendFile(process.env.CALLS_PATH,JSON.stringify({engine,viewport,retry,states:arg('state')})+'\\n');
    const row={theme:'test',browser_engine:engine,viewport,surface:'page.normal',state:'settled',screenshot:'x.png',
      unconfirmed_items:failed?['action/capture failed: test']:[],asset_failures:[],page_errors:[],external_requests_sent:0};
    if(process.env.THEME_LAB_AUDIT_SHARD_DIR){
      await fs.mkdir(process.env.THEME_LAB_AUDIT_SHARD_DIR,{recursive:true});
      const key='test|'+engine+'|'+viewport+'|page.normal|settled';
      const shard={schema:'theme_lab_interactive_audit_delta.v1',remove_keys:[key],records:[row],superseded_records:[],visual_review_reuse_updates:0,document_patch:{}};
      await fs.writeFile(path.join(process.env.THEME_LAB_AUDIT_SHARD_DIR,engine+'__'+viewport+'.json'),JSON.stringify(shard));
      process.exit(0);
    }
    await withAuditLock(auditPath, async()=>{
      let audit;try{audit=JSON.parse(await fs.readFile(auditPath))}catch{audit={records:[]}}
      audit.records=audit.records.filter(r=>r.browser_engine!==engine||r.viewport!==viewport||r.state!=='settled');
      audit.records.push(row);
      await fs.writeFile(auditPath,JSON.stringify(audit));
    });
  `);
  try { await operation({dir, script:path.join(scripts,'capture-theme-matrix.mjs')}); }
  finally { await fs.rm(dir,{recursive:true,force:true}); }
}

for (const scenario of ['success', 'retry', 'exhausted', 'child-failure', 'built-failure']) {
  test(`matrix orchestration: ${scenario}`, async()=>fixture(async({dir,script})=>{
    const auditPath=path.join(dir,'shadow.json');
    const callsPath=path.join(dir,'calls.jsonl');
    const unrelated={theme:'test',browser_engine:'chromium',viewport:'desktop',surface:'page.history',state:'list',
      unconfirmed_items:['action/capture failed: unrelated']};
    await fs.writeFile(auditPath,JSON.stringify({records:[unrelated]}));
    const result=spawnSync(process.execPath,[script,'--theme=test','--jobs=3','--anonymous','--state=page.normal.settled'],{
      cwd:os.tmpdir(),encoding:'utf8',timeout:15000,
      env:{...process.env,SCENARIO:scenario,THEME_LAB_INTERACTIVE_AUDIT_PATH:auditPath,CALLS_PATH:callsPath}
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
      assert.match(result.stderr,scenario==='exhausted'?/after targeted retries/:scenario==='built-failure'?/sidecar unavailable/:/child failed/);
      if(scenario==='exhausted')assert.equal(calls.length,27);
      if(scenario==='built-failure')assert.equal(calls.length,0);
      // No child may keep writing after the runner reports failure.
      const snapshot=await fs.readFile(auditPath,'utf8');
      await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(await fs.readFile(auditPath,'utf8'),snapshot);
    }
  }));
}


test('matrix warns when anonymous capture omits a public state subset',async()=>fixture(async({dir,script})=>{
 const auditPath=path.join(dir,'warn.json');
 const callsPath=path.join(dir,'warn-calls.jsonl');
 await fs.writeFile(auditPath,JSON.stringify({records:[]}));
 const result=spawnSync(process.execPath,[script,'--theme=test','--jobs=3','--anonymous'],{
  cwd:os.tmpdir(),encoding:'utf8',timeout:15000,
  env:{...process.env,SCENARIO:'success',THEME_LAB_INTERACTIVE_AUDIT_PATH:auditPath,CALLS_PATH:callsPath}
 });
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stderr,/--anonymous cannot capture states/);
 const summary=JSON.parse(result.stdout.trim().split('\n').at(-1));
 assert.equal(summary.successful_states,9);
}));

test('matrix interruption terminates and reaps active captures',async()=>fixture(async({dir,script})=>{
 const pids=path.join(dir,'pids');
 await fs.writeFile(path.join(path.dirname(script),'capture-interactive.mjs'),`
  import fs from 'node:fs';
  fs.appendFileSync(${JSON.stringify(pids)},process.pid+'\\n');
  setInterval(()=>{},1000);
 `);
 const child=spawn(process.execPath,[script,'--theme=test','--jobs=3','--anonymous'],{
  cwd:dir,stdio:'ignore',env:{...process.env,THEME_LAB_INTERACTIVE_AUDIT_PATH:path.join(dir,'audit.json')}
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
