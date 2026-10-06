#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {validatePublicationCandidateSet} from '../../src/publication-candidate-freeze.mjs';
import {requireDeepwellRuntimeIdentity} from '../../src/deepwell-runtime-identity.mjs';
import {requireRuntimeSourceSha} from '../../src/runtime-source-identity.mjs';
import {validateVisualGateRecord,visualGateNeedsScreenshot,visualGatePolicyRow,VISUAL_GATE_POLICY_SHA256} from '../../src/visual-gate.mjs';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const portsDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const themeLabDir=path.resolve(portsDir,'..');
const campaignDir=path.join(themeLabDir,'sigma10-migration/current-campaign');
const auditPath=path.join(campaignDir,'evidence/interactive-visual-audit.json');
const contractPath=path.join(campaignDir,'run-contract.json');
const outputPath=path.join(campaignDir,'final-vcm-acceptance-20261007/visual-review-worklist.json');
const contractBytes=await fs.readFile(contractPath),contract=JSON.parse(contractBytes),contractSha=sha(contractBytes);
const auditBytes=await fs.readFile(auditPath),audit=JSON.parse(auditBytes),auditSha=sha(auditBytes);
const failures=[...validatePublicationCandidateSet(themeLabDir,{expectedCandidateSetSha256:contract.candidate_set_sha256,contract,label:'Sigma-10 final review candidate set'})];
const runtimeSha=requireRuntimeSourceSha(contract.expected_runtime_source_sha256,'Sigma-10 final run contract');
const backend=requireDeepwellRuntimeIdentity(contract.expected_backend_runtime_identity,'Sigma-10 final run contract');
if(audit.schema!=='scp_jp_interactive_visual_audit.v1')failures.push('Sigma-10 active audit has an unexpected schema');
if(contract.audit_path&&path.resolve(campaignDir,contract.audit_path)!==auditPath)failures.push('Sigma-10 contract names a different active audit');
const inventory=new Map((contract.current_candidate_inventory??[]).map(row=>[row.package,row]));
if(inventory.size!==37)failures.push(`expected 37 Sigma-10 candidates including baseline, found ${inventory.size}`);
const counts={rows:audit.records?.length??0,themes:new Set(),classes:{V:0,C:0,M:0},screenshot_rows:0,machine_only_success_rows:0,failures:0,asset_failures:0,page_errors:0,external_requests_sent:0};
const rowKeys=new Set(),themes=new Map(),screenshots=new Map();
for(const record of audit.records??[]){
 const key=`${record.theme}|${record.browser_engine}|${record.viewport}|${record.surface}|${record.state}`;
 if(rowKeys.has(key))failures.push(`duplicate current Sigma-10 observation ${key}`);rowKeys.add(key);
 const expected=inventory.get(record.theme),policy=visualGatePolicyRow(record);
 if(!expected||record.candidate_sha256!==expected.candidate_sha256||record.candidate_source_sha256!==expected.source_sha256)failures.push(`capture candidate is not bound to the frozen inventory ${key}`);
 if(record.run_contract_sha256!==contractSha)failures.push(`capture uses a stale run contract ${key}`);
 if(record.runtime_source_sha256!==runtimeSha)failures.push(`capture uses a stale Framerail runtime ${key}`);
 if(record.backend_runtime_identity_sha256!==backend.identity_sha256)failures.push(`capture uses a stale Deepwell runtime ${key}`);
 if(!policy)failures.push(`unclassified V/C/M row ${key}`);else counts.classes[policy.class]++;
 for(const issue of validateVisualGateRecord(record,{requireVisualReview:false}))failures.push(issue);
 if(!Array.isArray(record.unconfirmed_items)||!Array.isArray(record.asset_failures)||!Array.isArray(record.page_errors)||!Array.isArray(record.action_responses))failures.push(`capture omits structured safety evidence ${key}`);
 if(record.unconfirmed_items?.some(item=>item!=='screenshot captured but awaiting image review'))failures.push(`capture has an unexplained unconfirmed result ${key}`);
 if(record.failure||record.asset_failures?.length||record.page_errors?.length||record.external_requests_sent!==0||record.action_responses?.some(item=>item.type==='failure'||item.status>=400||item.error_message))failures.push(`capture safety failure ${key}`);
 counts.failures+=record.failure?1:0;counts.asset_failures+=record.asset_failures?.length??0;counts.page_errors+=record.page_errors?.length??0;counts.external_requests_sent+=record.external_requests_sent??0;
 const needsImage=visualGateNeedsScreenshot(record,{failure:!!record.failure});
 if(needsImage){
  counts.screenshot_rows++;
  if(!record.screenshot||!/^[a-f0-9]{64}$/u.test(record.screenshot_sha256??''))failures.push(`required exact screenshot is missing ${key}`);
  else{
   const list=screenshots.get(record.screenshot_sha256)??{screenshot_sha256:record.screenshot_sha256,paths:new Set(),candidate_identities:new Set(),contexts:[]};
   list.paths.add(record.screenshot);list.candidate_identities.add(`${record.theme}:${record.candidate_sha256}:${record.candidate_source_sha256}`);
   list.contexts.push({theme:record.theme,browser_engine:record.browser_engine,viewport:record.viewport,surface:record.surface,state:record.state,visual_class:policy?.class,risk_triggers:record.visual_gate?.risk_triggers??[],candidate_sha256:record.candidate_sha256,candidate_source_sha256:record.candidate_source_sha256});
   screenshots.set(record.screenshot_sha256,list);
  }
 }else if(policy?.class==='M'&&!record.failure){
  counts.machine_only_success_rows++;
  if(record.screenshot||record.screenshot_sha256)failures.push(`successful machine-only row retained a screenshot ${key}`);
 }
 counts.themes.add(record.theme);themes.set(record.theme,(themes.get(record.theme)??0)+1);
}
if(counts.rows!==37*145)failures.push(`expected 5,365 observations, found ${counts.rows}`);
if(counts.themes.size!==37)failures.push(`expected 37 captured candidates, found ${counts.themes.size}`);
for(const [name,count] of themes)if(count!==145)failures.push(`${name} has ${count} observations, expected 145`);
for(const [name,expected] of Object.entries({V:1295,C:2812,M:1258}))if(counts.classes[name]!==expected)failures.push(`${name} row count ${counts.classes[name]} differs from the 37-candidate visual policy (${expected})`);
if(counts.screenshot_rows!==4107)failures.push(`expected 4,107 required visual rows, found ${counts.screenshot_rows}`);
if(counts.machine_only_success_rows!==1258)failures.push(`expected 1,258 successful machine-only rows, found ${counts.machine_only_success_rows}`);
if(failures.length){console.error(JSON.stringify({status:'fail',failures:failures.length,details:failures.slice(0,50)}));process.exit(1)}
const groups=[...screenshots.values()].map(group=>({screenshot_sha256:group.screenshot_sha256,paths:[...group.paths].sort(),candidate_identities:[...group.candidate_identities].sort(),contexts:group.contexts.sort((a,b)=>a.theme.localeCompare(b.theme)||a.browser_engine.localeCompare(b.browser_engine)||a.viewport.localeCompare(b.viewport)||a.surface.localeCompare(b.surface)||a.state.localeCompare(b.state))})).sort((a,b)=>a.contexts[0].theme.localeCompare(b.contexts[0].theme)||a.contexts[0].browser_engine.localeCompare(b.contexts[0].browser_engine)||a.contexts[0].viewport.localeCompare(b.contexts[0].viewport)||a.contexts[0].surface.localeCompare(b.contexts[0].surface)||a.contexts[0].state.localeCompare(b.contexts[0].state));
const riskTriggers={};for(const record of audit.records??[])for(const trigger of record.visual_gate?.risk_triggers??[])riskTriggers[trigger]=(riskTriggers[trigger]??0)+1;
const result={schema:'theme_lab_sigma10_vcm_direct_review_worklist.v1',generated_at:new Date().toISOString(),candidate_set_sha256:contract.candidate_set_sha256,run_contract:{path:path.relative(themeLabDir,contractPath).split(path.sep).join('/'),sha256:contractSha},audit:{path:path.relative(themeLabDir,auditPath).split(path.sep).join('/'),sha256:auditSha,bytes:auditBytes.length,rows:counts.rows,unique_rows:rowKeys.size},visual_gate:{policy_sha256:VISUAL_GATE_POLICY_SHA256,classes:counts.classes,required_visual_rows:counts.screenshot_rows,unique_screenshot_images:groups.length,machine_only_success_rows:counts.machine_only_success_rows,risk_triggers:riskTriggers},runtime:{framerail_source_sha256:runtimeSha,deepwell_identity_sha256:backend.identity_sha256},capture_safety:{failures:counts.failures,asset_failures:counts.asset_failures,page_errors:counts.page_errors,external_requests_sent:counts.external_requests_sent},groups};
await fs.mkdir(path.dirname(outputPath),{recursive:true});await fs.writeFile(outputPath,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:'ready-for-direct-review',worklist:path.relative(themeLabDir,outputPath),rows:counts.rows,classes:counts.classes,visual_rows:counts.screenshot_rows,unique_images:groups.length,machine_only_success_rows:counts.machine_only_success_rows,audit_sha256:auditSha,run_contract_sha256:contractSha,candidate_set_sha256:contract.candidate_set_sha256,failures:0}));
