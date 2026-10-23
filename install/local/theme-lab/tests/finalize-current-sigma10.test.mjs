import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkCampaignCompletion} from '../src/campaign-completion.mjs';
import {finalizeCurrentSigma10} from '../src/finalize-current-sigma10.mjs';
import {assembleCurrentCampaign} from '../scripts/assemble-current-campaign.mjs';
import {digest,mockBrowserVersions,mockCampaign,migrationAuditPath,migrationResultPath} from './support/current-campaign-fixture.mjs';

const sigma10Default='sigma10-migration/current-campaign/run-contract.json';
const sigma10Explicit='sigma10-migration/current-campaign/run-contract-explicit-check.json';

// A minimal framerail-shaped tree whose Playwright registry reports the fixture versions.
function fakeBrowserRoot(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-browser-root-'));
 const pw=path.join(dir,'node_modules/playwright'),core=path.join(dir,'node_modules/playwright-core');
 fs.mkdirSync(pw,{recursive:true});fs.mkdirSync(core,{recursive:true});
 fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'framerail-fixture',private:true}));
 fs.writeFileSync(path.join(pw,'package.json'),JSON.stringify({name:'playwright',version:'0.0.0',main:'index.js'}));
 fs.writeFileSync(path.join(pw,'index.js'),'module.exports={};');
 fs.writeFileSync(path.join(core,'package.json'),JSON.stringify({name:'playwright-core',version:'0.0.0'}));
 fs.writeFileSync(path.join(core,'browsers.json'),JSON.stringify({browsers:Object.entries(mockBrowserVersions).map(([name,browserVersion])=>({name,browserVersion}))}));
 return dir;
}

// A finished Sigma-10 runs audit (without embedded matrices), one matrix per package, and
// the decision outputs removed so that finalize is the only writer.
function finalizeFixture({mutateAudit=()=>{},contractFile=sigma10Default}={}){
 const mock=mockCampaign({migrationSchema:'scp_jp_sigma10_migration_run.v1'});
 fs.rmSync(path.join(mock.root,migrationResultPath),{force:true});
 fs.rmSync(path.join(mock.root,migrationAuditPath),{force:true});
 const inputs=path.join(mock.workspace,'inputs'),matrixDir=path.join(inputs,'matrices');
 fs.mkdirSync(matrixDir,{recursive:true});
 const {canonical_scenarios:_embedded,...runsAudit}=structuredClone(mock.migrationAudit);
 mutateAudit(runsAudit);
 const auditPath=path.join(inputs,'sigma10-runs-audit.json');
 fs.writeFileSync(auditPath,JSON.stringify(runsAudit));
 fs.writeFileSync(path.join(matrixDir,'testtheme.json'),JSON.stringify(mock.sigma10Matrix));
 return {mock,auditPath,matrixDir,browserRoot:fakeBrowserRoot(),contractFile};
}
const finalize=(f,extra={})=>finalizeCurrentSigma10({root:f.mock.root,auditPath:f.auditPath,runContract:f.contractFile,scenarioMatrixDirectory:f.matrixDir,browserRoot:f.browserRoot,...extra});
const decisionAbsent=f=>!fs.existsSync(path.join(f.mock.root,migrationResultPath))&&!fs.existsSync(path.join(f.mock.root,migrationAuditPath));
const cleanup=f=>{fs.rmSync(f.mock.workspace,{recursive:true,force:true});fs.rmSync(f.browserRoot,{recursive:true,force:true});};

test('finalize writes the Sigma-10 decision from the gate-equivalent checks and the gate accepts the assembled campaign',()=>{
 const f=finalizeFixture();
 try{
  const out=finalize(f);
  assert.equal(out.ok,true,out.failures.join('\n'));
  assert.deepEqual(out.written,[migrationAuditPath,migrationResultPath]);
  const receipt=JSON.parse(fs.readFileSync(path.join(f.mock.root,migrationResultPath),'utf8'));
  assert.equal(receipt.schema,'theme_lab_current_sigma10_acceptance.v1');
  assert.equal(receipt.run_contract_sha256,digest(fs.readFileSync(path.join(f.mock.root,sigma10Default))));
  assert.equal(receipt.browser_audit_sha256,digest(fs.readFileSync(path.join(f.mock.root,migrationAuditPath))));
  assert.deepEqual(receipt.overall_acceptance,{status:'pass',derived_from:{}});
  assert.deepEqual(Object.keys(receipt.canonical_scenario_evidence),['testtheme']);
  assert.equal(receipt.canonical_scenario_evidence.testtheme.generation,'sigma10');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.mock.root,migrationAuditPath),'utf8')).canonical_scenarios,{testtheme:f.mock.sigma10Matrix});
  // The decision is indexed by the existing assembler and accepted by the unchanged default gate.
  const document=JSON.parse(fs.readFileSync(path.join(f.mock.root,assembleCurrentCampaign(f.mock.root).path),'utf8'));
  assert.equal(Object.hasOwn(document.migration,'run_contract'),false);
  assert.deepEqual(checkCampaignCompletion(f.mock.root).failures,[]);
 }finally{cleanup(f)}
});

test('finalize with gzip writes a compressed audit that the assembler and gate index by its uncompressed binding',()=>{
 const f=finalizeFixture();
 try{
  const out=finalize(f,{gzip:true});
  assert.equal(out.ok,true,out.failures.join('\n'));
  assert.equal(fs.existsSync(path.join(f.mock.root,migrationAuditPath)),false);
  const document=JSON.parse(fs.readFileSync(path.join(f.mock.root,assembleCurrentCampaign(f.mock.root).path),'utf8'));
  assert.equal(document.migration.browser_audit.encoding,'gzip');
  assert.deepEqual(checkCampaignCompletion(f.mock.root).failures,[]);
 }finally{cleanup(f)}
});

test('finalize refuses a package without a canonical matrix and writes no decision',()=>{
 const f=finalizeFixture();
 try{
  fs.rmSync(path.join(f.matrixDir,'testtheme.json'));
  const out=finalize(f);
  assert.equal(out.ok,false);
  assert.ok(out.failures.some(message=>message.includes('exactly one <package>.json')));
  assert.deepEqual(out.written,[]);
  assert.ok(decisionAbsent(f));
 }finally{cleanup(f)}
});

test('finalize refuses a stale run contract whose bytes changed after the audit was captured',()=>{
 const f=finalizeFixture();
 try{
  const file=path.join(f.mock.root,sigma10Default),contract=JSON.parse(fs.readFileSync(file,'utf8'));
  fs.writeFileSync(file,JSON.stringify({...contract,operator_note:'edited after capture'}));
  const out=finalize(f);
  assert.equal(out.ok,false);
  assert.ok(out.failures.some(message=>message.includes('superseded baseline/contract')));
  assert.ok(decisionAbsent(f));
 }finally{cleanup(f)}
});

test('finalize refuses a failing browser record and writes no decision',()=>{
 const f=finalizeFixture({mutateAudit:audit=>{
  const row=audit.records.find(record=>record.theme==='testtheme');
  row.unconfirmed_items=['visible text outside the reference'];
 }});
 try{
  const out=finalize(f);
  assert.equal(out.ok,false);
  assert.ok(out.failures.some(message=>message.includes('Unresolved Sigma-10 state testtheme/')));
  assert.ok(decisionAbsent(f));
 }finally{cleanup(f)}
});

test('finalize refuses an audit whose browser versions differ from the installed runtime',()=>{
 const f=finalizeFixture({mutateAudit:audit=>{audit.records[0].browser_version='1.0.0';}});
 try{
  const out=finalize(f);
  assert.equal(out.ok,false);
  assert.ok(out.failures.some(message=>message.includes('differs from the installed')));
  assert.ok(decisionAbsent(f));
 }finally{cleanup(f)}
});

test('finalize refuses to overwrite an existing decision',()=>{
 const f=finalizeFixture();
 try{
  assert.equal(finalize(f).ok,true);
  const before=fs.readFileSync(path.join(f.mock.root,migrationResultPath));
  const again=finalize(f);
  assert.equal(again.ok,false);
  assert.ok(again.failures.some(message=>message.includes('already exists')));
  assert.deepEqual(fs.readFileSync(path.join(f.mock.root,migrationResultPath)),before);
 }finally{cleanup(f)}
});

test('an explicit task-owned Sigma-10 contract is bound by exact path and sha, and rejected when unbound',()=>{
 const f=finalizeFixture({contractFile:sigma10Explicit});
 try{
  fs.copyFileSync(path.join(f.mock.root,sigma10Default),path.join(f.mock.root,sigma10Explicit));
  const out=finalize(f);
  assert.equal(out.ok,true,out.failures.join('\n'));
  // Unbound: the assembled campaign names no Sigma-10 contract, so an explicit check fails.
  assembleCurrentCampaign(f.mock.root);
  const unbound=checkCampaignCompletion(f.mock.root,{sigma10RunContract:sigma10Explicit});
  assert.notEqual(unbound.status,'pass');
  assert.ok(unbound.failures.some(message=>message.includes('not bound to the explicitly supplied Sigma-10 run contract')));
  // Bound: the assembler records the exact path and sha, and the explicit gate accepts it.
  const document=JSON.parse(fs.readFileSync(path.join(f.mock.root,assembleCurrentCampaign(f.mock.root,{sigma10RunContract:sigma10Explicit}).path),'utf8'));
  assert.deepEqual(document.migration.run_contract,{path:sigma10Explicit,sha256:digest(fs.readFileSync(path.join(f.mock.root,sigma10Explicit)))});
  assert.deepEqual(checkCampaignCompletion(f.mock.root,{sigma10RunContract:sigma10Explicit}).failures,[]);
  // A bound receipt must not be accepted silently when no contract is named.
  const implicit=checkCampaignCompletion(f.mock.root);
  assert.ok(implicit.failures.some(message=>message.includes('bound to a task-owned Sigma-10 run contract')));
 }finally{cleanup(f)}
});

test('the assembler refuses a task-owned Sigma-10 contract that the migration audit was not captured against',()=>{
 const f=finalizeFixture();
 try{
  assert.equal(finalize(f).ok,true);
  fs.writeFileSync(path.join(f.mock.root,sigma10Explicit),fs.readFileSync(path.join(f.mock.root,sigma10Default),'utf8')+'\n');
  assert.throws(()=>assembleCurrentCampaign(f.mock.root,{sigma10RunContract:sigma10Explicit}),/Sigma-10: audit row was not captured against the supplied run contract/);
 }finally{cleanup(f)}
});

test('finalize refuses a Sigma-9 or non-task Sigma-10 contract path',()=>{
 const f=finalizeFixture({contractFile:'ports/current-acceptance/run-contract.json'});
 try{
  assert.throws(()=>finalize(f),/sigma10|task-owned/u);
  assert.ok(decisionAbsent(f));
 }finally{cleanup(f)}
});

test('the Sigma-10 finalizer CLI rejects a missing required option without writing',()=>{
 const script=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scripts/finalize-current-sigma10.mjs');
 const run=spawnSync(process.execPath,[script,'--audit=/nonexistent.json'],{encoding:'utf8'});
 assert.equal(run.status,64);
 assert.match(run.stderr,/missing --run-contract/u);
});

test('the canonical matrix CLI takes the Sigma-10 task contract only through its own option', () => {
 const script=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scripts/run-canonical-scenario-matrix.mjs');
 const base=['--package','testtheme','--generation','sigma10','--site-state-receipt','/nonexistent.json','--authenticated-storage','/nonexistent.json','--output','/nonexistent-out.json'];
 const misused=spawnSync(process.execPath,[script,...base,'--run-contract','sigma10-migration/current-campaign/run-contract-explicit-check.json'],{encoding:'utf8'});
 assert.equal(misused.status,1);
 assert.match(misused.stderr,/Sigma-10 canonical matrices take --sigma10-run-contract/u);
 assert.equal(fs.existsSync('/nonexistent-out.json'),false);
});
