#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {candidateIdentity} from './candidate-identity.mjs';
import {validatePublicationCandidateSet} from '../../src/publication-candidate-freeze.mjs';
import {requireDeepwellRuntimeIdentity} from '../../src/deepwell-runtime-identity.mjs';
import {requireRuntimeSourceSha} from '../../src/runtime-source-identity.mjs';
import {validateVisualGateRecord,visualGateNeedsScreenshot,visualGatePolicyRow,VISUAL_GATE_POLICY_SHA256} from '../../src/visual-gate.mjs';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const portsDir=path.resolve(scriptDir,'..');
const themeLabDir=path.resolve(portsDir,'..');
const values=new Map(process.argv.slice(2).filter(arg=>arg.startsWith('--')).map(arg=>{const i=arg.indexOf('=');return[arg.slice(2,i),arg.slice(i+1)]}));
for(const key of ['run-contract','audit','review','output'])if(!values.has(key))throw new Error(`missing --${key}=...`);
for(const key of values.keys())if(!['run-contract','audit','review','output'].includes(key))throw new Error(`unknown option --${key}`);
const resolveInput=(value,label)=>{const p=path.resolve(value);if(!p.startsWith(themeLabDir+path.sep))throw new Error(`${label} must remain inside Theme Lab`);return p};
const contractPath=resolveInput(values.get('run-contract'),'run contract');
const auditPath=resolveInput(values.get('audit'),'audit');
const reviewPath=resolveInput(values.get('review'),'visual review');
const outputPath=resolveInput(values.get('output'),'aggregate output');
const contractBytes=await fs.readFile(contractPath),contract=JSON.parse(contractBytes),contractSha=sha(contractBytes);
const auditBytes=await fs.readFile(auditPath),audit=JSON.parse(auditBytes),auditSha=sha(auditBytes);
const reviewBytes=await fs.readFile(reviewPath),review=JSON.parse(reviewBytes),reviewSha=sha(reviewBytes);
const failures=[];
const backend=requireDeepwellRuntimeIdentity(contract.expected_backend_runtime_identity,'canary run contract');
requireRuntimeSourceSha(contract.expected_runtime_source_sha256,'canary run contract');
if(contract.candidate_set_sha256!==review.candidate_set_sha256||review.run_contract_sha256!==contractSha)failures.push('visual review is not bound to the canary candidate set and exact run contract');
if(review.audit_sha256===auditSha)failures.push('visual review unexpectedly points to the post-review audit rather than its input audit');
if(contract.audit_path&&path.resolve(path.dirname(contractPath),contract.audit_path)!==auditPath)failures.push('canary run contract names a different audit');
failures.push(...validatePublicationCandidateSet(themeLabDir,{expectedCandidateSetSha256:contract.candidate_set_sha256,contract,label:'Canary frozen publication candidate set'}));

const records=audit.records??[],themes=new Set(records.map(row=>row.theme));
const rowKeys=new Set(),classes={V:0,C:0,M:0},riskTriggers={},visualRows=[],images=new Map(),runtimeShas=new Set(),backendShas=new Set();
let actionFailures=0,pageErrors=0,assetFailures=0,externalRequests=0,machineSuccess=0,machineScreenshots=0;
const themeNames=[...themes];
if(audit.schema!=='scp_jp_interactive_visual_audit.v1')failures.push('canary audit has an unexpected schema');
if(records.length!==145||themes.size!==1)failures.push(`expected one-theme 145-row canary, found ${records.length} rows/${themes.size} themes`);
const theme=themeNames[0];
const packageDir=path.join(portsDir,theme??'missing-theme');
const css=await fs.readFile(path.join(packageDir,'candidate.css'));
const base=await fs.readFile(path.join(packageDir,'candidate-base.css')).catch(()=>Buffer.alloc(0));
const source=await fs.readFile(path.join(packageDir,'candidate.wikidot.source.txt')).catch(()=>fs.readFile(path.join(packageDir,'candidate.wikidot.txt')));
const sourceSha=sha(source);
const known=new Set(records.map(row=>row.candidate_sha256));
const {candidateSha}=candidateIdentity(css,base,known);
const expectedTheme=JSON.parse(await fs.readFile(path.join(themeLabDir,'publication/frozen-candidate-set.json'),'utf8')).nodes.find(node=>node.id===`theme:${theme}`);
if(!expectedTheme||expectedTheme.source_sha256!==sourceSha||expectedTheme.candidate_css_sha256!==sha(css))failures.push(`current ${theme} source/CSS differs from the frozen publication node`);
for(const row of records){
 const key=`${row.theme}|${row.browser_engine}|${row.viewport}|${row.surface}|${row.state}`;
 if(rowKeys.has(key))failures.push(`duplicate canary row ${key}`);rowKeys.add(key);
 const policy=visualGatePolicyRow(row);if(!policy){failures.push(`unclassified canary state ${key}`);continue}
 classes[policy.class]++;
 failures.push(...validateVisualGateRecord(row));
 if(row.run_contract_sha256!==contractSha)failures.push(`stale run-contract identity ${key}`);
 if(row.candidate_sha256!==candidateSha||row.candidate_source_sha256!==sourceSha)failures.push(`stale candidate identity ${key}`);
 if(row.runtime_source_sha256!==contract.expected_runtime_source_sha256)failures.push(`stale Framerail runtime identity ${key}`);
 runtimeShas.add(row.runtime_source_sha256??null);
 try{const measured=requireDeepwellRuntimeIdentity(row.backend_runtime_identity,`canary row ${key}`);if(measured.identity_sha256!==backend.identity_sha256||row.backend_runtime_identity_sha256!==backend.identity_sha256)failures.push(`stale Deepwell runtime identity ${key}`);backendShas.add(measured.identity_sha256)}catch(error){failures.push(`missing Deepwell runtime identity ${key}: ${error.message}`)}
 if(row.external_requests_sent!==0||row.asset_failures?.length||row.page_errors?.length||row.failure||row.action_responses?.some(response=>response.type==='failure'||response.status>=400||response.error_message))failures.push(`capture safety failure ${key}`);
 actionFailures+=row.failure?1:0;pageErrors+=row.page_errors?.length??0;assetFailures+=row.asset_failures?.length??0;externalRequests+=row.external_requests_sent??0;
 const needsImage=visualGateNeedsScreenshot(row,{failure:!!row.failure});
 if(needsImage){
  visualRows.push(row);
  if(!row.screenshot||!/^[a-f0-9]{64}$/u.test(row.screenshot_sha256??''))failures.push(`required image missing ${key}`);
  const current=images.get(row.screenshot_sha256)??{screenshot_sha256:row.screenshot_sha256,path:row.screenshot,rows:[]};current.rows.push(key);images.set(row.screenshot_sha256,current);
 }else if(policy.class==='M'&&!row.failure){machineSuccess++;if(row.screenshot||row.screenshot_sha256)machineScreenshots++}
 if(policy.class==='C')for(const trigger of row.visual_gate?.risk_triggers??[])riskTriggers[trigger]=(riskTriggers[trigger]??0)+1;
}
if(classes.V!==35||classes.C!==76||classes.M!==34)failures.push(`unexpected canary V/C/M counts ${JSON.stringify(classes)}`);
if(runtimeShas.size!==1||!runtimeShas.has(contract.expected_runtime_source_sha256)||backendShas.size!==1||!backendShas.has(backend.identity_sha256))failures.push('canary did not use one measured runtime identity matching its contract');
if(machineSuccess!==34||machineScreenshots!==0)failures.push(`M-row policy mismatch: ${machineSuccess} successful rows, ${machineScreenshots} retained screenshots`);
if(actionFailures||pageErrors||assetFailures||externalRequests)failures.push(`canary safety totals are nonzero: ${actionFailures}/${pageErrors}/${assetFailures}/${externalRequests}`);

const reviewRows=new Map((review.reviews??[]).map(item=>[item.screenshot_sha256,item]));
if(visualRows.length!==111||reviewRows.size!==images.size||(review.reviews??[]).length!==images.size)failures.push(`expected 111 visual rows with one exact-hash review per unique screenshot, found ${visualRows.length}/${images.size}/${reviewRows.size}/${(review.reviews??[]).length}`);
const visualClassifications=new Set();
for(const [imageSha,image] of images){
 const item=reviewRows.get(imageSha);if(!item){failures.push(`missing direct review ${imageSha}`);continue}
 if(!['PASS_NATURAL','PASS_INTENTIONAL_DIVERGENCE'].includes(item.classification)||typeof item.note!=='string'||item.note.trim().length<12)failures.push(`unaccepted image review ${imageSha}`);
 for(const key of image.rows){const row=records.find(candidate=>`${candidate.theme}|${candidate.browser_engine}|${candidate.viewport}|${candidate.surface}|${candidate.state}`===key);if(row?.visual_review?.method!=='direct-image-vision-review'||row.visual_review.screenshot_sha256!==imageSha||row.visual_review.candidate_sha256!==row.candidate_sha256||row.visual_review.candidate_source_sha256!==row.candidate_source_sha256||row.classification!==item.classification)failures.push(`review binding mismatch ${key}`);else visualClassifications.add(row.classification)}
 const absolute=path.resolve(portsDir,image.path);if(!absolute.startsWith(portsDir+path.sep))failures.push(`image path escapes Theme Lab ${image.path}`);else{try{const bytes=await fs.readFile(absolute);if(sha(bytes)!==imageSha)failures.push(`image SHA mismatch ${image.path}`)}catch(error){failures.push(`image is unavailable ${image.path}: ${error.message}`)}}
}

const receipt={schema:'theme_lab_visual_gate_canary_aggregate.v1',stage:'post-policy-change-one-theme-vcm-canary',generated_at:new Date().toISOString(),status:failures.length?'fail':'pass',theme,candidate_set_sha256:contract.candidate_set_sha256,run_contract:{path:path.relative(themeLabDir,contractPath).split(path.sep).join('/'),sha256:contractSha},audit:{path:path.relative(themeLabDir,auditPath).split(path.sep).join('/'),sha256:auditSha,bytes:auditBytes.length,rows:records.length,unique_rows:rowKeys.size},visual_review:{path:path.relative(themeLabDir,reviewPath).split(path.sep).join('/'),sha256:reviewSha,input_audit_sha256:review.audit_sha256,required_rows:visualRows.length,unique_images:images.size,accepted_images:reviewRows.size,reused_exact_image_reviews:0,new_direct_image_reviews:reviewRows.size},runtime:{expected_framerail_source_sha256:contract.expected_runtime_source_sha256,measured_framerail_source_sha256s:[...runtimeShas].filter(Boolean),expected_deepwell_identity_sha256:backend.identity_sha256,measured_deepwell_identity_sha256s:[...backendShas]},visual_gate:{policy_sha256:VISUAL_GATE_POLICY_SHA256,classes,required_screenshot_rows:visualRows.length,machine_only_success_rows:machineSuccess,machine_only_success_screenshots:machineScreenshots,risk_triggers:riskTriggers,validation_failures:failures},capture:{capture_runtime_source_sha256:contract.expected_runtime_source_sha256,action_failures:actionFailures,page_errors:pageErrors,asset_failures:assetFailures,external_requests_sent:externalRequests,jobs:2,capture_concurrency:3},final_gate:{status:failures.length?'fail':'pass',all_145_rows_validated:failures.length===0,all_111_required_images_reviewed:failures.length===0,all_34_machine_rows_screenshot_free:machineScreenshots===0}};
await fs.writeFile(outputPath,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({status:receipt.status,theme,rows:records.length,classes,visual_rows:visualRows.length,unique_images:images.size,machine_only_success_rows:machineSuccess,machine_only_success_screenshots:machineScreenshots,validation_failures:failures.length,output:path.relative(themeLabDir,outputPath).split(path.sep).join('/')}));
if(failures.length)process.exitCode=1;
