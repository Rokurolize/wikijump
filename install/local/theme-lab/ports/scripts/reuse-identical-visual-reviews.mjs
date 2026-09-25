#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withAuditLock} from './audit-lock.mjs';
import {pngPixelSha256File} from './png-pixel-hash.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const auditPath=path.join(root,'interactive-visual-audit.json');
const dryRun=process.argv.includes('--dry-run');
for(const arg of process.argv.slice(2)){
 if(arg==='--dry-run'||arg==='--help')continue;
 throw new Error(`unknown argument: ${arg}`);
}
if(process.argv.includes('--help')){
 console.log('Usage: reuse-identical-visual-reviews.mjs [--dry-run]');
 process.exit(0);
}

const rowKey=row=>[row.theme,row.browser_engine,row.viewport,row.surface,row.state].join('|');
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
function reusableClassification(row){
 if(row.classification==='PASS_NATURAL')return {classification:'PASS_NATURAL',visual_findings:[],intentional_differences:[]};
 if(row.classification==='PASS_INTENTIONAL_DIVERGENCE'&&(row.intentional_differences?.length??0)>0)return {classification:row.classification,visual_findings:row.visual_findings??[],intentional_differences:row.intentional_differences};
 if(row.classification==='NEEDS_FIX'&&(row.visual_findings?.length??0)>0)return {classification:'NEEDS_FIX',visual_findings:row.visual_findings,intentional_differences:row.intentional_differences??[]};
 return null;
}

await withAuditLock(auditPath,async()=>{
 const audit=JSON.parse(await fs.readFile(auditPath,'utf8'));
 const rows=audit.records??[];
 const reviewedByKey=new Map();
 for(const row of [...(audit.superseded_records??[]),...rows]){
  if(!row.reviewed_after_last_change||!row.screenshot)continue;
  if(!reusableClassification(row))continue;
  reviewedByKey.set(rowKey(row),row);
 }
 let reused=0,byteIdentical=0,pixelIdentical=0,skippedNoPrior=0,skippedChangedPixels=0,skippedIncompleteReview=0;
 const byTheme={};
 for(const row of rows){
  if(row.reviewed_after_last_change&&row.classification!=='UNCONFIRMED')continue;
  if(row.unconfirmed_items?.some(item=>String(item).startsWith('action/capture failed')))continue;
  const prior=reviewedByKey.get(rowKey(row));
  if(!prior){skippedNoPrior++;continue}
  const review=reusableClassification(prior);
  if(!review){skippedIncompleteReview++;continue}
  const currentFile=await verifiedFile(row),priorFile=await verifiedFile(prior);
  if(!currentFile||!priorFile){skippedNoPrior++;continue}
  let reason=null,currentPixelSha=null;
  if(row.screenshot_sha256===prior.screenshot_sha256){
   reason='byte-identical';byteIdentical++;
  }else{
   const [currentPixels,priorPixels]=await Promise.all([pixelSha(row),pixelSha(prior)]);
   currentPixelSha=currentPixels;
   if(!currentPixels||currentPixels!==priorPixels){skippedChangedPixels++;continue}
   reason='pixel-identical';pixelIdentical++;
  }
  Object.assign(row,review,{
   reviewed_after_last_change:true,
   unconfirmed_items:[],
   ...(currentPixelSha?{screenshot_pixel_sha256:currentPixelSha}:{}),
   visual_review_reuse:{
    reason,
    source_screenshot_sha256:prior.screenshot_sha256,
    source_candidate_sha256:prior.candidate_sha256??null,
    source_classification:prior.classification
   }
  });
  reused++;byTheme[row.theme]=(byTheme[row.theme]??0)+1;
 }
 const summary={schema:'theme_lab_identical_visual_review_reuse.v1',dry_run:dryRun,reused,byte_identical:byteIdentical,pixel_identical:pixelIdentical,skipped_no_prior:skippedNoPrior,skipped_changed_pixels:skippedChangedPixels,skipped_incomplete_review:skippedIncompleteReview,by_theme:byTheme};
 if(!dryRun&&reused){
  audit.updated_at=new Date().toISOString();
  audit.visual_review_reuse_updates=(audit.visual_review_reuse_updates??0)+reused;
  const temp=`${auditPath}.${process.pid}.tmp`;
  await fs.writeFile(temp,JSON.stringify(audit)+'\n');
  await fs.rename(temp,auditPath);
 }
 console.log(JSON.stringify(summary));
});
