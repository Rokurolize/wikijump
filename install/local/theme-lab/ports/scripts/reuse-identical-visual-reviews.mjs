#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withAuditLock} from './audit-lock.mjs';
import {pngPixelSha256File} from './png-pixel-hash.mjs';
import {
 applyExactVisualReviewReuse,
 buildExactVisualReviewIndex,
 currentRowAllowsVisualReuse,
 reusableVisualReview,
 visualReviewRowKey,
 verifyExactReviewSources
} from './visual-review-reuse.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const auditPath=process.env.THEME_LAB_INTERACTIVE_AUDIT_PATH
 ? path.resolve(process.env.THEME_LAB_INTERACTIVE_AUDIT_PATH)
 : path.join(root,'interactive-visual-audit.json');
const dryRun=process.argv.includes('--dry-run');
const allowPixelIdentical=process.argv.includes('--pixel-identical');
for(const arg of process.argv.slice(2)){
 if(arg==='--dry-run'||arg==='--pixel-identical'||arg==='--help')continue;
 throw new Error(`unknown argument: ${arg}`);
}
if(process.argv.includes('--help')){
 console.log('Usage: reuse-identical-visual-reviews.mjs [--dry-run] [--pixel-identical]');
 process.exit(0);
}

const fileShaCache=new Map();
const pixelShaCache=new Map();
async function verifiedFile(row){
 if(!row?.screenshot||!row?.screenshot_sha256)return null;
 const file=path.join(root,row.screenshot);
 let fileSha=fileShaCache.get(file);
 if(!fileSha){
  const bytes=await fs.readFile(file).catch(()=>null);
  if(!bytes)return null;
  fileSha=crypto.createHash('sha256').update(bytes).digest('hex');
  fileShaCache.set(file,fileSha);
 }
 return fileSha===row.screenshot_sha256?file:null;
}
async function pixelSha(row){
 const file=await verifiedFile(row);
 if(!file)return null;
 if(pixelShaCache.has(file))return pixelShaCache.get(file);
 const value=await pngPixelSha256File(file).catch(()=>null);
 pixelShaCache.set(file,value);
 return value;
}

await withAuditLock(auditPath,async()=>{
 const audit=JSON.parse(await fs.readFile(auditPath,'utf8'));
 const rows=audit.records??[];
 const priorRows=[...(audit.superseded_records??[]),...rows];
 const exactIndex=buildExactVisualReviewIndex(await verifyExactReviewSources(priorRows,rows,root));
 const reviewedCandidatesByKey=new Map();
 const reviewedByKey=new Map();
 for(const row of priorRows){
  if(!row.reviewed_after_last_change||!row.screenshot)continue;
  const key=visualReviewRowKey(row);
  const reviewedMatches=reviewedCandidatesByKey.get(key)??[];
  reviewedMatches.push(row);
  reviewedCandidatesByKey.set(key,reviewedMatches);
  if(!reusableVisualReview(row))continue;
  const matches=reviewedByKey.get(key)??[];
  matches.push(row);
  reviewedByKey.set(key,matches);
 }
 let reused=0,byteIdentical=0,pixelIdentical=0,skippedNoPrior=0,skippedChangedPixels=0,skippedIncompleteReview=0,skippedCurrentIneligible=0,skippedCurrentFileInvalid=0,skippedPriorFileUnavailable=0;
 const byTheme={};
 for(const row of rows){
  if(row.reviewed_after_last_change&&row.classification!=='UNCONFIRMED')continue;
  const currentFile=await verifiedFile(row);
  if(!currentFile){skippedCurrentFileInvalid++;continue}
  if(!currentRowAllowsVisualReuse(row)){skippedCurrentIneligible++;continue}
  if(applyExactVisualReviewReuse(row,exactIndex)){
   byteIdentical++;reused++;byTheme[row.theme]=(byTheme[row.theme]??0)+1;continue;
  }
  const key=visualReviewRowKey(row);
  const reviewedCandidates=reviewedCandidatesByKey.get(key)??[];
  const reusableCandidates=reviewedByKey.get(key)??[];
  if(!reviewedCandidates.length){skippedNoPrior++;continue}
  if(!reusableCandidates.length){skippedIncompleteReview++;continue}
  if(!allowPixelIdentical){
   skippedChangedPixels++;
   continue;
  }
  const currentPixels=await pixelSha(row);
  let prior=null;
  let verifiedPriorFile=false;
  for(let index=reusableCandidates.length-1;index>=0;index--){
   const candidate=reusableCandidates[index];
   if(!await verifiedFile(candidate))continue;
   verifiedPriorFile=true;
   if(currentPixels&&currentPixels===await pixelSha(candidate)){prior=candidate;break}
  }
  if(!prior){
   if(verifiedPriorFile)skippedChangedPixels++;
   else skippedPriorFileUnavailable++;
   continue;
  }
  const review=reusableVisualReview(prior);
  if(!review){skippedIncompleteReview++;continue}
  Object.assign(row,structuredClone(review),{
   reviewed_after_last_change:true,
   unconfirmed_items:[],
   screenshot_pixel_sha256:currentPixels,
   visual_review_reuse:{
    reason:'pixel-identical',
    source_screenshot_sha256:prior.screenshot_sha256,
    source_candidate_sha256:prior.candidate_sha256??null,
    source_classification:prior.classification,
    source_reviewed_at:review.review_provenance.reviewed_at,
    source_reviewer:review.review_provenance.reviewer,
    source_review_method:review.review_provenance.method,
    source_review_screenshot_sha256:review.review_provenance.screenshot_sha256
   }
  });
  delete row.visual_review;
  pixelIdentical++;reused++;byTheme[row.theme]=(byTheme[row.theme]??0)+1;
 }
 const summary={schema:'theme_lab_identical_visual_review_reuse.v1',dry_run:dryRun,pixel_identical_enabled:allowPixelIdentical,reused,byte_identical:byteIdentical,pixel_identical:pixelIdentical,skipped_no_prior:skippedNoPrior,skipped_changed_pixels:skippedChangedPixels,skipped_incomplete_review:skippedIncompleteReview,skipped_current_ineligible:skippedCurrentIneligible,skipped_current_file_invalid:skippedCurrentFileInvalid,skipped_prior_file_unavailable:skippedPriorFileUnavailable,by_theme:byTheme};
 if(!dryRun&&reused){
  audit.updated_at=new Date().toISOString();
  audit.visual_review_reuse_updates=(audit.visual_review_reuse_updates??0)+reused;
  const temp=`${auditPath}.${process.pid}.tmp`;
  await fs.writeFile(temp,JSON.stringify(audit)+'\n');
  await fs.rename(temp,auditPath);
 }
 console.log(JSON.stringify(summary));
});
