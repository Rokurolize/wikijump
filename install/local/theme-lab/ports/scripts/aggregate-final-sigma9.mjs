#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {validatePublicationCandidateSet} from '../../src/publication-candidate-freeze.mjs';
import {requireDeepwellRuntimeIdentity} from '../../src/deepwell-runtime-identity.mjs';
import {validateVisualGateRecord,visualGateNeedsScreenshot,visualGatePolicyRow,VISUAL_GATE_POLICY,VISUAL_GATE_POLICY_SHA256} from '../../src/visual-gate.mjs';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const portsDir=path.resolve(scriptDir,'..');
const themeLabDir=path.resolve(portsDir,'..');
const acceptanceDir=path.join(portsDir,'current-acceptance');
const auditPath=path.join(acceptanceDir,'artifacts/interactive-visual-audit.json');
const contractPath=path.join(acceptanceDir,'run-contract.json');
const freezePath=path.join(themeLabDir,'publication/frozen-candidate-set.json');
const aggregatePath=path.join(acceptanceDir,'final-sigma9-aggregate-20261006.json');
const sourceReviewPath=path.join(acceptanceDir,'final-sigma9-visual-review-20261006.json');
const outputReviewPath=path.join(acceptanceDir,'final-sigma9-visual-review-final-20261006.json');
const outputWorklistPath=path.join(acceptanceDir,'final-sigma9-visual-review-worklist-final-20261006.json');
const deltaContactSheetManifestPath=path.join(acceptanceDir,'sigma9-direct-review-20261007/contact-sheets/manifest.json');
const failures=[];

const [auditBytes,contractBytes,freezeBytes,oldAggregateBytes,oldReviewBytes,deltaContactSheetManifestBytes]=await Promise.all([
 fs.readFile(auditPath),fs.readFile(contractPath),fs.readFile(freezePath),fs.readFile(aggregatePath),fs.readFile(sourceReviewPath),fs.readFile(deltaContactSheetManifestPath)
]);
const audit=JSON.parse(auditBytes),contract=JSON.parse(contractBytes),frozen=JSON.parse(freezeBytes),oldAggregate=JSON.parse(oldAggregateBytes),oldReview=JSON.parse(oldReviewBytes),deltaContactSheetManifest=JSON.parse(deltaContactSheetManifestBytes);
const auditSha=sha(auditBytes),contractSha=sha(contractBytes),freezeFileSha=sha(freezeBytes);
const expectedBackend=requireDeepwellRuntimeIdentity(contract.expected_backend_runtime_identity,'Sigma-9 final run contract');

failures.push(...validatePublicationCandidateSet(themeLabDir,{expectedCandidateSetSha256:contract.candidate_set_sha256,contract,label:'Sigma-9 frozen publication set'}));
if(contract.candidate_set_sha256!==frozen.candidate_set_sha256)failures.push('Sigma-9 run contract is not bound to the current candidate set');
if(contract.audit_path&&path.resolve(path.dirname(contractPath),contract.audit_path)!==auditPath)failures.push('Sigma-9 run contract names a different audit path');
if(oldReview.candidate_set_sha256!==contract.candidate_set_sha256||oldReview.run_contract_sha256!==contractSha)failures.push('source direct-review evidence is not bound to the current candidate set and run contract');
if(deltaContactSheetManifest.candidate_set_sha256!==contract.candidate_set_sha256||deltaContactSheetManifest.run_contract_sha256!==contractSha)failures.push('new direct-review contact sheets are not bound to the current candidate set and run contract');

const expectedCandidates=new Map((oldAggregate.candidate_binding?.candidate_inputs??[]).map(item=>[item.theme,item]));
if(expectedCandidates.size!==36)failures.push(`expected 36 frozen theme candidate inputs, found ${expectedCandidates.size}`);
const rowKeys=new Set(),themes=new Set(),classCounts={V:0,C:0,M:0};
const visualRows=[],classTriggerCounts={};
const screenshotsBySha=new Map(),rowsByScreenshot=new Map();
let actionFailures=0,pageErrors=0,assetFailures=0,externalRequests=0,machineOnlySuccessRows=0,machineOnlySuccessScreenshots=0;
const runtimeShas=new Set(),backendShas=new Set();
for(const record of audit.records??[]){
 const key=`${record.theme}|${record.browser_engine}|${record.viewport}|${record.surface}|${record.state}`;
 if(rowKeys.has(key))failures.push(`duplicate canonical row ${key}`);rowKeys.add(key);themes.add(record.theme);
 const policy=visualGatePolicyRow(record);
 if(!policy){failures.push(`unclassified visual policy row ${key}`);continue}
 classCounts[policy.class]++;
 for(const failure of validateVisualGateRecord(record))failures.push(failure);
 if(record.run_contract_sha256!==contractSha)failures.push(`row uses stale run contract ${key}`);
 if(record.runtime_source_sha256!==contract.expected_runtime_source_sha256)failures.push(`row uses stale Framerail runtime ${key}`);
 runtimeShas.add(record.runtime_source_sha256??null);
 try{
  const backend=requireDeepwellRuntimeIdentity(record.backend_runtime_identity,`Sigma-9 row ${key}`);
  if(backend.identity_sha256!==expectedBackend.identity_sha256||record.backend_runtime_identity_sha256!==expectedBackend.identity_sha256)failures.push(`row uses stale Deepwell runtime ${key}`);
  backendShas.add(backend.identity_sha256);
 }catch(error){failures.push(`row lacks current Deepwell runtime identity ${key}: ${error.message}`)}
 const candidate=expectedCandidates.get(record.theme);
 if(!candidate||record.candidate_sha256!==candidate.capture_candidate_css_sha256||record.candidate_source_sha256!==candidate.capture_candidate_source_sha256)
  failures.push(`row is not bound to its frozen theme candidate ${key}`);
 actionFailures+=record.failure?1:0;
 pageErrors+=(record.page_errors?.length??0);assetFailures+=(record.asset_failures?.length??0);externalRequests+=record.external_requests_sent??0;
 const needsImage=visualGateNeedsScreenshot(record,{failure:!!record.failure});
 if(needsImage){
  visualRows.push(record);
  if(record.screenshot&&/^[a-f0-9]{64}$/u.test(record.screenshot_sha256??'')){
   const current=rowsByScreenshot.get(record.screenshot_sha256)??[];current.push(record);rowsByScreenshot.set(record.screenshot_sha256,current);
   if(!screenshotsBySha.has(record.screenshot_sha256))screenshotsBySha.set(record.screenshot_sha256,{sha256:record.screenshot_sha256,path:record.screenshot});
  }
 }
 if(policy.class==='M'&&!record.failure){machineOnlySuccessRows++;if(record.screenshot||record.screenshot_sha256)machineOnlySuccessScreenshots++}
 if(policy.class==='C')for(const trigger of record.visual_gate?.risk_triggers??[])classTriggerCounts[trigger]=(classTriggerCounts[trigger]??0)+1;
}

const expectedRowCount=36*145;
if(audit.records?.length!==expectedRowCount)failures.push(`expected ${expectedRowCount} browser observations, found ${audit.records?.length??0}`);
if(themes.size!==36)failures.push(`expected 36 theme candidates, found ${themes.size}`);
for(const theme of themes){const count=audit.records.filter(row=>row.theme===theme).length;if(count!==145)failures.push(`${theme} has ${count} observations, expected 145`)}
for(const [key,expected] of Object.entries(VISUAL_GATE_POLICY.counts))if(classCounts[key]!==expected*36)failures.push(`visual class ${key} has ${classCounts[key]}, expected ${expected*36}`);
if(runtimeShas.size!==1||!runtimeShas.has(contract.expected_runtime_source_sha256))failures.push('measured Framerail runtime identity set differs from the run contract');
if(backendShas.size!==1||!backendShas.has(expectedBackend.identity_sha256))failures.push('measured Deepwell runtime identity set differs from the run contract');
if(machineOnlySuccessScreenshots!==0)failures.push(`successful M rows retain ${machineOnlySuccessScreenshots} screenshot(s)`);
if(actionFailures||pageErrors||assetFailures||externalRequests)failures.push(`browser safety failures: actions=${actionFailures}, page_errors=${pageErrors}, assets=${assetFailures}, external_requests=${externalRequests}`);

const requiredScreenshotShas=new Set(screenshotsBySha.keys());
const sourceReviews=new Map((oldReview.reviews??[]).map(review=>[review.screenshot_sha256,review]));
const deltaReviews=new Map((deltaContactSheetManifest.groups??[]).map(group=>[group.screenshot_sha256,group]));
const currentReviewItems=[];
for(const [screenshotSha,records] of rowsByScreenshot){
 const classes=new Set(records.map(record=>record.visual_review?.method==='direct-image-vision-review'&&record.visual_review?.screenshot_sha256===screenshotSha&&record.visual_review?.candidate_sha256===record.candidate_sha256&&record.visual_review?.candidate_source_sha256===record.candidate_source_sha256?record.classification:'INVALID'));
 const review=sourceReviews.get(screenshotSha);
 const rowReview=records.find(record=>record.visual_review?.method==='direct-image-vision-review'&&record.visual_review?.screenshot_sha256===screenshotSha)?.visual_review;
 if(!rowReview){failures.push(`required screenshot has no direct review ${screenshotSha}`);continue}
 if(classes.has('INVALID')||classes.size!==1||!['PASS_NATURAL','PASS_INTENTIONAL_DIVERGENCE'].includes(rowReview.classification??records[0].classification)||!classes.has(rowReview.classification??records[0].classification))failures.push(`direct-review binding/classification mismatch ${screenshotSha}`);
 const delta=deltaReviews.get(screenshotSha);
 const identities=[...new Map(records.map(row=>[`${row.theme}|${row.candidate_sha256}|${row.candidate_source_sha256}`,{theme:row.theme,candidate_sha256:row.candidate_sha256,candidate_source_sha256:row.candidate_source_sha256}])).values()];
 const deltaSheet=(deltaContactSheetManifest.contact_sheets??[]).find(sheet=>sheet.path.endsWith(`/${delta?.sheet??''}`));
 currentReviewItems.push({screenshot_sha256:screenshotSha,classification:records[0].classification,note:rowReview.note,reviewer:rowReview.reviewer??'Codex visual review',contact_sheet:delta&&deltaSheet?{path:path.relative(portsDir,path.resolve(themeLabDir,deltaSheet.path)),sha256:deltaSheet.sha256,tile_index:delta.tile_index}:review?.contact_sheet??null,candidate_identities:identities,subjects:[...new Set(records.map(row=>`${row.theme} / ${row.browser_engine} ${row.viewport}`))].sort(),states:[...new Set(records.map(row=>`${row.surface}.${row.state}`))].sort()});
}

const filteredGroups=[...rowsByScreenshot.entries()].map(([screenshotSha,records])=>({
 screenshot_sha256:screenshotSha,
 screenshot:screenshotsBySha.get(screenshotSha)?.path,
 paths:[...new Set(records.map(row=>row.screenshot))].sort(),
 records:records.map(row=>({theme:row.theme,browser_engine:row.browser_engine,viewport:row.viewport,surface:row.surface,state:row.state,policy_class:visualGatePolicyRow(row)?.class??null,risk_triggers:row.visual_gate?.risk_triggers??[],candidate_sha256:row.candidate_sha256,candidate_source_sha256:row.candidate_source_sha256})).sort((a,b)=>a.theme.localeCompare(b.theme)||a.browser_engine.localeCompare(b.browser_engine)||a.viewport.localeCompare(b.viewport)||a.surface.localeCompare(b.surface)||a.state.localeCompare(b.state))
})).sort((a,b)=>a.records[0].theme.localeCompare(b.records[0].theme)||a.records[0].browser_engine.localeCompare(b.records[0].browser_engine)||a.records[0].viewport.localeCompare(b.records[0].viewport)||a.records[0].surface.localeCompare(b.records[0].surface)||a.records[0].state.localeCompare(b.records[0].state));
const worklistRows=filteredGroups.reduce((sum,group)=>sum+group.records.length,0);
if(worklistRows!==visualRows.length)failures.push(`review worklist covers ${worklistRows} rows but ${visualRows.length} visual rows are required`);
if(filteredGroups.length!==requiredScreenshotShas.size)failures.push('review worklist unique-image groups do not match the active visual gate');

const outputWorklist={schema:'theme_lab_visual_review_worklist.v1',generated_at:new Date().toISOString(),audit_path:'current-acceptance/artifacts/interactive-visual-audit.json',audit_sha256:auditSha,candidate_set_sha256:contract.candidate_set_sha256,run_contract_sha256:contractSha,rows:worklistRows,unique_images:filteredGroups.length,deduplicated_rows:worklistRows-filteredGroups.length,missing:[],stale:[],groups:filteredGroups};
const worklistBytes=Buffer.from(JSON.stringify(outputWorklist,null,2)+'\n');
await fs.writeFile(outputWorklistPath,worklistBytes);
const deltaSheetEntries=(deltaContactSheetManifest.contact_sheets??[]).map(sheet=>({index:null,path:path.relative(portsDir,path.resolve(themeLabDir,sheet.path)),sha256:sheet.sha256,bytes:sheet.bytes,first_group_index:null,last_group_index:null,reviewed_at:deltaContactSheetManifest.generated_at}));
const contactSheetPartition={...(oldReview.contact_sheet_partition??{}),sheets:[...(oldReview.contact_sheet_partition?.sheets??[]),...deltaSheetEntries],reviewed_sheet_count:(oldReview.contact_sheet_partition?.reviewed_sheet_count??0)+deltaSheetEntries.length};
let contactSheetFailures=0;
for(const sheet of contactSheetPartition.sheets??[]){
 try{const bytes=await fs.readFile(path.resolve(portsDir,sheet.path));if(sha(bytes)!==sheet.sha256)throw new Error('contact-sheet SHA mismatch')}
 catch(error){contactSheetFailures++;failures.push(`direct-review contact sheet unavailable: ${sheet.path}: ${error.message}`)}
}
if((contactSheetPartition.reviewed_sheet_count??0)!==(contactSheetPartition.sheets?.length??0))failures.push('not every partitioned contact sheet has a direct review record');
const reviewEvidence={...oldReview,generated_at:new Date().toISOString(),audit_sha256:auditSha,worklist_path:'current-acceptance/final-sigma9-visual-review-worklist-final-20261006.json',worklist_sha256:sha(worklistBytes),worklist_rows:visualRows.length,unique_screenshots:currentReviewItems.length,deduplicated_rows:visualRows.length-currentReviewItems.length,intentional_divergences:currentReviewItems.filter(item=>item.classification==='PASS_INTENTIONAL_DIVERGENCE').length,contact_sheet_partition:contactSheetPartition,delta_contact_sheet_manifest:{path:path.relative(portsDir,deltaContactSheetManifestPath),sha256:sha(deltaContactSheetManifestBytes),input_audit_sha256:deltaContactSheetManifest.audit_sha256},reviews:currentReviewItems};
const reviewBytes=Buffer.from(JSON.stringify(reviewEvidence,null,2)+'\n');
await fs.writeFile(outputReviewPath,reviewBytes);

let screenshotReadFailures=0;
const imageEntries=[...screenshotsBySha.values()];
for(let offset=0;offset<imageEntries.length;offset+=8){
 const batch=imageEntries.slice(offset,offset+8);
 await Promise.all(batch.map(async image=>{
  try{
   const absolute=path.resolve(portsDir,image.path);
   if(!absolute.startsWith(portsDir+path.sep))throw new Error('screenshot path escapes ports');
   const bytes=await fs.readFile(absolute);
   if(sha(bytes)!==image.sha256)throw new Error('screenshot SHA mismatch');
  }catch(error){screenshotReadFailures++;failures.push(`required screenshot is not exact or readable: ${image.path}: ${error.message}`)}
 }));
}

const reviewStatus=failures.length?'fail':'pass';
const aggregate={
 ...oldAggregate,
 status:reviewStatus,
 generated_at:new Date().toISOString(),
 audit:{...oldAggregate.audit,sha256:auditSha,bytes:auditBytes.length,row_count:audit.records.length,unique_canonical_row_count:rowKeys.size,theme_count:themes.size,rows_per_theme:145},
 candidate_binding:{...oldAggregate.candidate_binding,candidate_set_sha256:frozen.candidate_set_sha256,run_contract_sha256:contractSha,frozen_manifest_whole_file_sha256:freezeFileSha},
 runtime_binding:{expected_runtime_source_sha256:contract.expected_runtime_source_sha256,measured_runtime_source_sha256s:[...runtimeShas].filter(Boolean),expected_deepwell_identity_sha256:expectedBackend.identity_sha256,measured_deepwell_identity_sha256s:[...backendShas]},
 visual_gate:{policy_sha256:VISUAL_GATE_POLICY_SHA256,classes:classCounts,required_visual_rows:visualRows.length,unique_direct_review_screenshots:currentReviewItems.length,deduplicated_direct_review_rows:visualRows.length-currentReviewItems.length,machine_only_success_rows:machineOnlySuccessRows,machine_only_success_screenshots:machineOnlySuccessScreenshots,risk_triggers:classTriggerCounts,direct_visual_review_status:reviewStatus,review_evidence:{path:'current-acceptance/final-sigma9-visual-review-final-20261006.json',sha256:sha(reviewBytes),worklist_path:'current-acceptance/final-sigma9-visual-review-worklist-final-20261006.json',worklist_sha256:sha(worklistBytes),contact_sheets_reviewed:contactSheetPartition.reviewed_sheet_count??0,contact_sheet_failures:contactSheetFailures,screenshot_hashes_revalidated:imageEntries.length,screenshot_hash_failures:screenshotReadFailures}},
 publication_candidate_freeze_validation:{status:failures.some(item=>item.includes('frozen publication')||item.includes('candidate set')||item.includes('attachment'))?'fail':'pass',candidate_set_sha256:frozen.candidate_set_sha256},
 validation_failures:failures
};
await fs.writeFile(aggregatePath,JSON.stringify(aggregate,null,2)+'\n');
console.log(JSON.stringify({status:reviewStatus,rows:audit.records.length,themes:themes.size,classes:classCounts,required_visual_rows:visualRows.length,unique_direct_review_screenshots:currentReviewItems.length,machine_only_success_rows:machineOnlySuccessRows,machine_only_success_screenshots:machineOnlySuccessScreenshots,contact_sheets:contactSheetPartition.reviewed_sheet_count,screenshot_hash_failures:screenshotReadFailures,validation_failures:failures.length,aggregate_path:path.relative(themeLabDir,aggregatePath),review_path:path.relative(themeLabDir,outputReviewPath),worklist_path:path.relative(themeLabDir,outputWorklistPath)}));
if(failures.length)process.exitCode=1;
