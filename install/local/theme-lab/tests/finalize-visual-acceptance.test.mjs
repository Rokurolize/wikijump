import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {finalizeVisualAcceptance,reviewCompletionTime} from '../src/finalize-visual-acceptance.mjs';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
test('current acceptance completion time is deterministic from all exact viewport reviews',()=>{
 const review={viewports:{desktop:{reviewed_at:'2026-09-01T00:00:00Z'},laptop:{reviewed_at:'2026-09-02T00:00:00Z'},tablet:{reviewed_at:'2026-09-03T00:00:00Z'},mobile:{reviewed_at:'2026-09-04T00:00:00Z'}}};
 assert.equal(reviewCompletionTime(review),'2026-09-04T00:00:00Z');
 assert.throws(()=>reviewCompletionTime({viewports:{desktop:{reviewed_at:'not-a-date'}}}),/every required viewport/u);
});
test('exact image review completes only the visual dimension and preserves target findings',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'theme-lab-final-image-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const candidate=path.join(dir,'candidate.png'),reference=path.join(dir,'reference.png');await fs.writeFile(candidate,'candidate');await fs.writeFile(reference,'reference');
 const inputs={css:'CSS',source:'source',preview:'JP preview'};
 const viewports=['desktop','laptop','tablet','mobile'];
 const result={candidate_css_sha256:sha(inputs.css),candidate_source_sha256:sha(inputs.source),candidate_preview_sha256:sha(inputs.preview),verification_scope:{mode:'full',deferred:[]},port_decision:{verdict:'pass'},local_target_acceptance:{status:'inconclusive',visual_status:'inconclusive',findings:[{severity:'warn',kind:'local_style_delta'}],issue_count:1},overall_acceptance:{status:'inconclusive',port_verdict:'pass',target_status:'inconclusive'},verdict:'inconclusive',viewport_status:Object.fromEntries(viewports.map(id=>[id,{status:'pass'}])),font_diagnostics:{status:'measured',fonts:[{glyph_count:1}]},torture:'pass',visual:{viewports:Object.fromEntries(viewports.map(id=>[id,{candidate_path:candidate,reference_path:reference,comparison_status:'fail',normalized_rmse:.4}]))}};
 const review={schema:'theme_lab_visual_acceptance.v1',candidate_css_sha256:sha(inputs.css),candidate_preview_sha256:sha(inputs.preview),viewports:Object.fromEntries(viewports.map(id=>[id,{status:'pass',candidate_screenshot_sha256:sha('candidate'),reference_screenshot_sha256:sha('reference'),reviewed_at:new Date().toISOString(),reviewer:'test reviewer',note:'Different article content reviewed; readable controls and preserved visual identity.'}]))};
 const accepted=await finalizeVisualAcceptance({result,review,...inputs});assert.equal(accepted.overall_acceptance.status,'warn');assert.deepEqual(accepted.local_target_acceptance.findings,result.local_target_acceptance.findings);assert.equal(result.verdict,'inconclusive');
 await assert.rejects(finalizeVisualAcceptance({result,review,...inputs,css:'changed CSS'}),/superseded/);
 await assert.rejects(finalizeVisualAcceptance({result:{...result,port_decision:{verdict:'inconclusive'}},review,...inputs}),/dimensions disagree|port decision/);
 await assert.rejects(finalizeVisualAcceptance({result:{...result,local_target_acceptance:{...result.local_target_acceptance,status:'fail'}},review,...inputs}),/dimensions disagree|Target acceptance/);
 await fs.writeFile(candidate,'changed pixels');await assert.rejects(finalizeVisualAcceptance({result,review,...inputs}),/inconclusive/);
});
