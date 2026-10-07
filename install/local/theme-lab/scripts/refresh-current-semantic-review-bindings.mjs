#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {planBrowserAcceptance,observationKey} from '../src/semantic-browser-acceptance.mjs';
import {validateVisualGateRecord,visualGateNeedsScreenshot} from '../src/visual-gate.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const lab=path.resolve(here,'..');
const auditPath=path.join(lab,'ports/current-acceptance/artifacts/interactive-visual-audit.json');
const audit=JSON.parse(fs.readFileSync(auditPath,'utf8'));
const plan=planBrowserAcceptance(audit),byKey=new Map((audit.records??[]).map(row=>[observationKey(row),row]));
const refreshed=[],reviewRequired=[];
for(const question of plan.visual_questions){
 const review=audit.semantic_reviews?.[question.id];
 if(review?.evidence_sha256===question.evidence_sha256)continue;
 if(!review||review.question!==question.question){reviewRequired.push({theme:question.theme,kind:question.kind,id:question.id,reason:'no review for current question identity',evidence_sha256:question.evidence_sha256});continue;}
 let blocker=null;
 for(const observation of question.observations){
  const row=byKey.get(observation.key);if(!row){blocker=`missing current row ${observation.key}`;break}
  const errors=validateVisualGateRecord(row);if(errors.length){blocker=`visual gate failed for ${observation.key}: ${errors[0]}`;break}
  if(visualGateNeedsScreenshot(row,{failure:!!row.failure})&&
     row.visual_review?.screenshot_sha256!==row.screenshot_sha256&&row.migration_review?.screenshot_sha256!==row.screenshot_sha256){blocker=`current screenshot lacks direct review for ${observation.key}`;break}
 }
 if(blocker){reviewRequired.push({theme:question.theme,kind:question.kind,id:question.id,reason:blocker,evidence_sha256:question.evidence_sha256});continue}
 review.evidence_sha256=question.evidence_sha256;
 review.binding_refreshed_at=new Date().toISOString();
 review.binding_refresh_basis='Same semantic question identity; every current observation passes the visual gate and every required screenshot is already directly reviewed at its exact SHA.';
 refreshed.push({theme:question.theme,kind:question.kind,id:question.id});
}
const backup=path.join(lab,'scratchpad',`interactive-visual-audit-before-semantic-rebind-${Date.now()}.json`);fs.mkdirSync(path.dirname(backup),{recursive:true});fs.copyFileSync(auditPath,backup);
fs.writeFileSync(auditPath,JSON.stringify(audit,null,2)+'\n');
const worklistPath=path.join(lab,'ports/current-acceptance/current-semantic-review-deltas-20261007.json');fs.writeFileSync(worklistPath,JSON.stringify({schema:'theme_lab_current_semantic_review_delta_worklist.v1',refreshed,review_required:reviewRequired},null,2)+'\n');
console.log(JSON.stringify({refreshed:refreshed.length,review_required:reviewRequired.length,worklist:path.relative(lab,worklistPath),backup:path.relative(lab,backup)}));
