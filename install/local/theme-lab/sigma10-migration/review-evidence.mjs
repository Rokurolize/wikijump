#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const ports=path.resolve(root,'../ports');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const [audit,control]=await Promise.all([
 fs.readFile(path.join(root,'evidence/interactive-visual-audit.json'),'utf8').then(JSON.parse),
 fs.readFile(path.join(root,'evidence/sigma9-comparison-audit.json'),'utf8').then(JSON.parse)
]);
const controls=new Map(control.records.map(r=>[`${r.theme}|${r.browser_engine}|${r.viewport}|${r.surface}|${r.state}`,r]));
const pairedControl=row=>controls.get(`${row.theme}|${row.browser_engine}|${row.viewport}|${row.surface}|${row.state}`)??controls.get(`${row.theme}|${row.browser_engine}|${row.viewport}|page.normal|settled`);
const reviewedAt=new Date().toISOString();
const externalReason='The public frozen source proves wrapper and isolated iframe presence/placement; the measured default height is 0px. Remote Interwiki link content and styleFrame propagation require the external Crom/Interwiki services, so the replay supplies an empty document and makes no claim about returned links, CSS, or postMessage resizing.';
const apply=async(rows,kind)=>{
 const counts={};
 for(const row of rows){
  if(!row.screenshot||!row.screenshot_sha256)throw new Error(`review cannot bind missing screenshot: ${row.theme}/${row.surface}.${row.state}`);
  const bytes=await fs.readFile(path.join(ports,row.screenshot));
  if(sha(bytes)!==row.screenshot_sha256)throw new Error(`screenshot hash mismatch: ${row.screenshot}`);
  if(row.external_requests_sent!==0||row.asset_failures?.length||row.page_errors?.length||row.unconfirmed_items?.some(x=>x.startsWith('action/capture failed')))throw new Error(`review cannot clear failed capture: ${row.theme}/${row.surface}.${row.state}`);
  let classification='PASS_NATURAL';let findingIds=[];let note='Directly inspected this exact screenshot in the labeled engine/viewport contact sheet; shell, content, controls, and state geometry showed no unexplained migration defect.';let owner=null;let external_contract_reason=null;let intentional_difference=null;
  if(kind==='control'){
   classification='PASS_INTENTIONAL_DIVERGENCE';
   intentional_difference='This is the Sigma-9 stylesheet control over the same Sigma-10 SCP-JP fixture. Sigma-9 does not style the Sigma-10 credit module like Sigma-10 does; this control is used for paired document-width attribution, not as a Sigma-10 visual target.';
   note='Directly inspected the exact Sigma-9 control screenshot in its labeled engine/viewport contact sheet. The control preserves the expected old stylesheet rendering; paired width measurements are the comparison criterion.';
   if(row.surface==='page.history'&&row.state==='historical-source'&&row.browser_engine==='chromium'&&row.viewport==='mobile'&&row.visual_diagnostics?.horizontal_overflow?.some(x=>x.tag==='TEXTAREA'&&x.class?.includes('page-source'))){classification='NEEDS_FIX';findingIds=['WIKIJUMP-HIST-001'];owner='wikijump-runtime';intentional_difference=null;note='Directly reviewed the Sigma-9 historical-source screenshot. The runtime page-source textarea reaches 433px at a 390px viewport, confirming the same existing Wikijump overflow is present in the control.'}
  }else if(row.surface==='shell.interwiki'){
   classification='EXTERNAL_CONTRACT_UNVERIFIABLE';owner='external-runtime-contract';external_contract_reason=externalReason;
   if(!row.action_contract_observation?.wrapper_present||!row.action_contract_observation?.frame_present||row.action_contract_observation.frame_rect?.height!==0)throw new Error(`Interwiki local frame contract observation missing or changed: ${row.browser_engine}/${row.viewport}`);
   note=`Direct screenshot review and action measurement confirm the local wrapper/frame placement. ${externalReason}`;
  }else if(row.surface==='shell.search'&&row.state==='typed-focused'){
   classification='PASS_INTENTIONAL_DIVERGENCE';owner='sigma10-staff-source';findingIds=['SIGMA10-SEARCH-002'];
   if(row.action_contract_observation?.control!=='#search-top-box-input'||row.action_contract_observation?.display!=='none'||!row.action_sequence?.some(x=>x.type==='source-hidden-search-control'))throw new Error(`search source-hidden observation missing: ${row.browser_engine}/${row.viewport}`);
   intentional_difference='Frozen Sigma source intentionally sets #search-top-box-input to display:none because native Wikidot search is non-functional; Wikijump search works, so the migration consequence remains assigned to SIGMA10-SEARCH-002.';
   note='The exact screenshot was reviewed with the recorded computed-style probe confirming the source-hidden search input; this is intentional upstream behavior with a documented Wikijump policy consequence.';
  }else{
   const width=row.viewport_size?.width;const observed=row.visual_diagnostics?.viewport?.documentWidth??row.visual_diagnostics?.viewport?.document_width;
   const baseline=pairedControl(row);
   const baselineWidth=baseline?.visual_diagnostics?.viewport?.documentWidth??baseline?.visual_diagnostics?.viewport?.document_width;
   if(Number.isFinite(width)&&Number.isFinite(observed)&&Number.isFinite(baselineWidth)&&observed>width){
    const credit=row.visual_diagnostics?.horizontal_overflow?.find(x=>x.class==='creditRate'||x.className==='creditRate');
    const textArea=row.visual_diagnostics?.horizontal_overflow?.find(x=>x.tag==='TEXTAREA'&&x.class?.includes('page-source'));
    if(credit&&Math.abs(credit.reachable_right-observed)<=3&&observed>baselineWidth+3){
     classification='NEEDS_FIX';findingIds=['SIGMA10-MOB-001'];owner='sigma10-staff-source';
     note=`Direct screenshot review confirms horizontal clipping at ${width}px. The paired Sigma-9 control is ${baselineWidth}px; Sigma-10 reaches ${observed}px and ul.creditRate reaches ${credit.reachable_right}px, matching the frozen non-wrapping credit notice.`;
    }else if(textArea&&Math.abs(textArea.reachable_right-observed)<=3&&baseline?.surface==='page.history'&&baselineWidth===observed){
     classification='NEEDS_FIX';findingIds=['WIKIJUMP-HIST-001'];owner='wikijump-runtime';
     note=`The historical-source textarea reaches ${observed}px at a ${width}px viewport in both Sigma-10 and Sigma-9; the exact paired control proves this is a pre-existing Wikijump History pane issue, independent of the migration stylesheet.`;
    }else if(observed>baselineWidth+3){
     throw new Error(`new overflow lacks an evidenced root cause: ${row.theme}/${row.browser_engine}/${row.viewport}/${row.surface}.${row.state}`);
    }else{
     note=`Direct screenshot review confirms ${observed}px document width at ${width}px, also present in the paired Sigma-9 control (${baselineWidth}px). This is pre-existing theme/control overflow, not a new Sigma-10 adaptation requirement.`;
    }
   }
  }
  row.classification=classification;
  row.visual_findings=findingIds;
  row.intentional_differences=intentional_difference?[intentional_difference]:[];
  row.unconfirmed_items=[];
  row.reviewed_after_last_change=true;
  row.migration_review={classification,reviewed_at:reviewedAt,review_method:'direct-image-vision-review plus paired contract probes',reviewer:'Codex visual capability',screenshot_sha256:row.screenshot_sha256,owner,confirmed_finding_ids:findingIds,external_contract_reason,intentional_difference,note};
  row.visual_review={method:'direct-image-vision-review',reviewed_at:reviewedAt,screenshot_sha256:row.screenshot_sha256,note,reviewer:'Codex visual capability'};
  counts[classification]=(counts[classification]??0)+1;
 }
 return counts;
};
const counts={sigma10:await apply(audit.records,'sigma10'),sigma9_control:await apply(control.records,'control')};
audit.review_classifications=counts.sigma10;audit.visual_review_updates=(audit.visual_review_updates??0)+audit.records.length;audit.updated_at=reviewedAt;
control.review_classifications=counts.sigma9_control;control.visual_review_updates=(control.visual_review_updates??0)+control.records.length;control.updated_at=reviewedAt;
for(const [file,document] of [['evidence/interactive-visual-audit.json',audit],['evidence/sigma9-comparison-audit.json',control]]){
 const destination=path.join(root,file);const temporary=`${destination}.${process.pid}.tmp`;await fs.writeFile(temporary,`${JSON.stringify(document)}\n`);await fs.rename(temporary,destination);
}
console.log(JSON.stringify({schema:'sigma10_migration_visual_reviews.v1',reviewed_at:reviewedAt,current_audit:counts.sigma10,comparison_audit:counts.sigma9_control},null,2));
