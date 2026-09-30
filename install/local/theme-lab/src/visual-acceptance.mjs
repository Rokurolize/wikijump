import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export async function bindVisualAcceptance(captures,review,{css,baseCss="",wikitext}) {
 if(!captures)return null;
 const matches=review?.schema==='theme_lab_visual_acceptance.v1' && review.candidate_css_sha256===sha(Buffer.from(css)) && review.candidate_preview_sha256===sha(Buffer.from(wikitext??'')) && (review.candidate_base_css_sha256??null)===(baseCss?sha(Buffer.from(baseCss)):null);
 for(const [viewport,capture] of Object.entries(captures)) {
  const candidateSha=sha(await fs.readFile(capture.candidate_path));
  const referenceSha=capture.reference_path?sha(await fs.readFile(capture.reference_path)):null;
  const row=matches?review.viewports?.[viewport]:null;
  const bound=row?.candidate_screenshot_sha256===candidateSha && row?.reference_screenshot_sha256===referenceSha && typeof row?.note==='string' && row.note.trim().length>=12 && typeof row?.reviewed_at==='string' && typeof row?.reviewer==='string';
  capture.candidate_screenshot_sha256=candidateSha;
  capture.reference_screenshot_sha256=referenceSha;
  capture.acceptance={status:bound&&['pass','warn','fail'].includes(row.status)?row.status:'inconclusive',reason:bound?row.note:'Different source/target content requires exact image review; pixel RMSE alone is diagnostic.',...(bound?{review:row}:{})};
 }
 return captures;
}
