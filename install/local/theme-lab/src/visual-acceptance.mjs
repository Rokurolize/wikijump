import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export async function bindVisualAcceptance(captures,review,{css,baseCss="",wikitext,source=null}) {
 if(!captures)return null;
 const cssSha=typeof css==='string'||Buffer.isBuffer(css)?sha(Buffer.from(css)):null;
 const sourceSha=typeof source==='string'||Buffer.isBuffer(source)?sha(Buffer.from(source)):null;
 const previewSha=typeof wikitext==='string'||Buffer.isBuffer(wikitext)?sha(Buffer.from(wikitext)):null;
 const baseSha=baseCss?sha(Buffer.from(baseCss)):null;
 const matches=review?.schema==='theme_lab_visual_acceptance.v1' && cssSha!==null && previewSha!==null && review.candidate_css_sha256===cssSha && review.candidate_preview_sha256===previewSha && (review.candidate_base_css_sha256??null)===baseSha && (sourceSha===null || review.candidate_source_sha256===sourceSha);
 for(const [viewport,capture] of Object.entries(captures)) {
  const candidateSha=sha(await fs.readFile(capture.candidate_path));
  const referenceSha=capture.reference_path?sha(await fs.readFile(capture.reference_path)):null;
  const row=matches?review.viewports?.[viewport]:null;
   const bound=row?.candidate_screenshot_sha256===candidateSha && row?.reference_screenshot_sha256===referenceSha && typeof row?.note==='string' && row.note.trim().length>=12 && typeof row?.reviewed_at==='string' && Number.isFinite(Date.parse(row.reviewed_at)) && typeof row?.reviewer==='string' && row.reviewer.trim().length>0;
  capture.candidate_screenshot_sha256=candidateSha;
  capture.reference_screenshot_sha256=referenceSha;
  capture.acceptance={status:bound&&['pass','warn','fail'].includes(row.status)?row.status:'inconclusive',reason:bound?row.note:'Different source/target content requires exact image review; pixel RMSE alone is diagnostic.',...(bound?{review:row}:{})};
 }
 return captures;
}
