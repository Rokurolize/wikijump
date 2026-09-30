import crypto from 'node:crypto';
import {bindVisualAcceptance} from './visual-acceptance.mjs';
import {overallAcceptance,summarizeVisual} from './verdict.mjs';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
// Review completes the image dimension of a captured full check. It does not
// rerender unchanged surfaces or reinterpret any failed/unknown port dimension.
export async function finalizeVisualAcceptance({result,review,css,baseCss='',source,preview}){
 for(const [key,bytes] of [['candidate_css_sha256',css],['candidate_source_sha256',source],['candidate_preview_sha256',preview]])if(result[key]!==sha(bytes))throw new Error(`Current full check uses superseded ${key}`);
 if((result.candidate_base_css_sha256??null)!==(baseCss?sha(baseCss):null))throw new Error('Current full check uses superseded base CSS');
 if(result.verification_scope?.mode!=='full'||result.verification_scope.deferred?.length)throw new Error('Iteration/deferred checks cannot finish acceptance');
 const target=result.local_target_acceptance??result.target_acceptance;
 if(result.verdict!==overallAcceptance(result.port_decision.verdict,target?.status)||result.overall_acceptance?.port_verdict!==result.port_decision.verdict||result.overall_acceptance?.target_status!==target?.status)throw new Error('Captured combined acceptance dimensions disagree');
 if(['desktop','laptop','tablet','mobile'].some(viewport=>!result.viewport_status?.[viewport]))throw new Error('Full viewport acceptance is incomplete');
 if(result.font_diagnostics?.status!=='measured'||!result.font_diagnostics.fonts?.some(font=>font.glyph_count>0))throw new Error('Japanese glyph acceptance is incomplete');
 if(!['pass','warn'].includes(result.port_decision?.verdict))throw new Error('Unresolved or failed port decision cannot be accepted by image review');
 if(!['pass','warn','inconclusive'].includes(target?.status)||target.status==='inconclusive'&&target.visual_status!=='inconclusive')throw new Error('Target acceptance has unresolved nonvisual work');
 if(target.findings?.some(row=>row.severity==='error')||result.next_actions||result.missing_candidate_assets||result.external_requests||result.image_diagnostics?.broken?.length||Object.values(result.viewport_status??{}).some(row=>row.status!=='pass')||Object.values(result.interaction_diagnostics??{}).some(row=>row.status==='fail')||!['pass','warn'].includes(result.torture))throw new Error('Image review cannot override failed target checks');
 const captures={};
 for(const viewport of ['desktop','laptop','tablet','mobile']){
  const row=result.visual?.viewports?.[viewport];if(!row?.candidate_path||!row.reference_path)throw new Error(`Missing paired visual capture: ${viewport}`);
  captures[viewport]={...row,comparison:{status:row.comparison_status,normalized_rmse:row.normalized_rmse}};
 }
 await bindVisualAcceptance(captures,review,{css,baseCss,wikitext:preview});
 const visual=summarizeVisual(captures);if(!['pass','warn'].includes(visual.status))throw new Error(`Image review is ${visual.status}`);
 const output=structuredClone(result);
 output.visual={...visual,decision_authority:'SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY'};
 const targetStatus=visual.status==='warn'||target.issue_count>0||target.style_change_count>0||target.torture_changed_component_count>0||result.torture==='warn'?'warn':'pass';
 output.local_target_acceptance={...target,status:targetStatus,visual_status:visual.status};
 output.local_target_acceptance_status=targetStatus;
 const overall=overallAcceptance(result.port_decision.verdict,targetStatus);
 output.overall_acceptance={status:overall,port_verdict:result.port_decision.verdict,target_status:targetStatus};
 output.verdict=overall;output.status=overall==='warn'?'warn-no-actionable-issues':'pass';
 output.image_review_provenance={schema:'theme_lab_visual_acceptance.v1',review_sha256:sha(JSON.stringify(review)),raw_result_sha256:sha(JSON.stringify(result)),scope:'Only exact reviewed image acceptance completed; port decisions and measured target findings are preserved.'};
 return output;
}
