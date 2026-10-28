import crypto from 'node:crypto';
import fs from 'node:fs';
import {bindVisualAcceptance} from './visual-acceptance.mjs';
import {overallAcceptance,summarizeVisual} from './verdict.mjs';
import {ACCEPTANCE_VIEWPORT_IDS} from './acceptance-viewports.mjs';
import {TARGET_ACCEPTANCE_CONTRACT_SHA256} from './target-acceptance-contract.mjs';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
// Faithful-design exemption ledger (TAIL-PLAN TL-05). An entry waives one
// measured finding only while every recorded measurement, selector set and
// candidate/contract binding still matches exactly; any drift re-fails the
// finding. Waivers are reported as explanations naming the entry, never as
// silent passes, and with an empty or absent ledger every validator output
// is byte-identical to the pre-ledger behavior.
export const FAITHFUL_DESIGN_EXEMPTIONS_SCHEMA='theme_lab_faithful_design_exemptions.v1';
const FAITHFUL_DESIGN_EXEMPTIONS_URL=new URL('../ports/current-acceptance/faithful-design-exemptions.json',import.meta.url);
let faithfulDesignExemptionsCache=null;
export function faithfulDesignExemptionsState(){
 let stat=null;try{stat=fs.statSync(FAITHFUL_DESIGN_EXEMPTIONS_URL)}catch{}
 if(!stat)return {document:null,sha256:null};
 const cacheKey=`${stat.mtimeMs}:${stat.size}`;
 if(faithfulDesignExemptionsCache?.key===cacheKey)return faithfulDesignExemptionsCache.state;
 const bytes=fs.readFileSync(FAITHFUL_DESIGN_EXEMPTIONS_URL);
 const document=JSON.parse(bytes.toString('utf8'));
 if(document?.schema!==FAITHFUL_DESIGN_EXEMPTIONS_SCHEMA||!Array.isArray(document.entries))throw new Error('Faithful-design exemption ledger is malformed');
 const state={document,sha256:sha(bytes)};
 faithfulDesignExemptionsCache={key:cacheKey,state};
 return state;
}
export function loadFaithfulDesignExemptions(){return faithfulDesignExemptionsState().document??{schema:FAITHFUL_DESIGN_EXEMPTIONS_SCHEMA,entries:[]};}
const FULL_CHECK_MEASUREMENT_KEYS=['overflow_px','document_overflow_px','viewport_escape_px','baseline_overflow_px','baseline_document_overflow_px','baseline_viewport_escape_px'];
function fullCheckFindingMatches(entry,result,finding){
 if(entry?.instrument!=='full_check_target'||finding?.severity!=='error')return false;
 if(entry.candidate_css_sha256!==result?.candidate_css_sha256||entry.candidate_source_sha256!==result?.candidate_source_sha256)return false;
 if(entry.target_acceptance_contract_sha256!==result?.target_acceptance_contract_sha256)return false;
 if(entry.full_check_input_bindings_sha256!==result?.full_check_input_bindings?.sha256)return false;
 const spec=(entry.findings??[]).find(row=>row.viewport===finding.viewport&&row.kind===finding.kind);
 if(!spec)return false;
 if(FULL_CHECK_MEASUREMENT_KEYS.some(key=>spec[key]!==finding[key]))return false;
 const selectors=[...new Set((finding.overflow_sources??[]).map(row=>row.selector))].sort();
 const expected=[...(spec.selectors??[])].sort();
 return JSON.stringify(selectors)===JSON.stringify(expected);
}
export function matchFullCheckWaivers(document,result){
 const target=result?.local_target_acceptance??result?.target_acceptance;
 const waivers=[];
 for(const finding of target?.findings??[]){
  if(finding?.severity!=='error')continue;
  const entry=(document?.entries??[]).find(candidate=>fullCheckFindingMatches(candidate,result,finding));
  if(entry)waivers.push({entry,finding});
 }
 return waivers;
}
export function matchFaithfulDesignContainment(document,{theme,observationKey: key,candidateOverflowPx,baselineOverflowPx,dependenciesSha256}){
 return (document?.entries??[]).find(entry=>entry?.instrument==='semantic_document_containment'&&entry.package===theme&&
  entry.match?.observation_key===key&&entry.match?.candidate_overflow_px===candidateOverflowPx&&
  entry.match?.baseline_overflow_px===baselineOverflowPx&&entry.match?.dependencies_sha256===dependenciesSha256)??null;
}
function viewportExplainedByWaivers(result,viewport,waivers){
 const rows=waivers.filter(waiver=>waiver.finding.viewport===viewport);
 if(!rows.length)return false;
 const row=result.viewport_status?.[viewport];
 if(!row)return false;
 return row.viewport_escape_px===Math.max(...rows.map(waiver=>waiver.finding.viewport_escape_px))&&
        row.document_overflow_px===Math.max(...rows.map(waiver=>waiver.finding.document_overflow_px));
}
export function verifyFaithfulDesignWaivers(result,packageName){
 const failures=[];
 const block=result?.faithful_design_exemptions;
 const target=result?.local_target_acceptance??result?.target_acceptance;
 const marked=(target?.findings??[]).filter(finding=>finding?.exemption);
 if(!block){
  if(marked.length)failures.push(`${packageName}: target findings carry exemption marks without a faithful-design exemption block`);
  return failures;
 }
 if(block.schema!==FAITHFUL_DESIGN_EXEMPTIONS_SCHEMA)failures.push(`${packageName}: faithful-design exemptions use an unknown schema`);
 const {document,sha256:ledgerSha256}=faithfulDesignExemptionsState();
 if(!document||block.ledger_sha256!==ledgerSha256)failures.push(`${packageName}: faithful-design exemptions are bound to a superseded exemption ledger`);
 if(!Array.isArray(block.waivers)||!block.waivers.length)failures.push(`${packageName}: faithful-design exemption block lists no waivers`);
 const scoped=document?{...document,entries:document.entries.filter(entry=>entry.package===packageName)}:null;
 const recomputed=matchFullCheckWaivers(scoped,result).map(waiver=>waiver.entry.id).sort();
 const recorded=(block.waivers??[]).map(waiver=>waiver.entry_id).sort();
 if(JSON.stringify(recomputed)!==JSON.stringify(recorded))failures.push(`${packageName}: recorded faithful-design waivers do not match the current ledger`);
 for(const waiver of block.waivers??[]){
  const finding=(target?.findings??[]).find(row=>row?.exemption?.entry_id===waiver.entry_id&&row.viewport===waiver.viewport&&row.kind===waiver.kind);
  if(!finding)failures.push(`${packageName}: waiver ${waiver.entry_id} has no matching exempted finding`);
  else if(finding.exemption.decision!==waiver.decision)failures.push(`${packageName}: waiver ${waiver.entry_id} records a different decision than its finding`);
  const row=result.viewport_status?.[waiver.viewport];
  if(!row||!(row.exemption_entry_ids??[]).includes(waiver.entry_id))failures.push(`${packageName}: viewport ${waiver.viewport} does not record exemption ${waiver.entry_id}`);
 }
 for(const finding of marked)if(!recorded.includes(finding.exemption.entry_id))failures.push(`${packageName}: finding exemption ${finding.exemption.entry_id} is not recorded in the waiver block`);
 return failures;
}
export function reviewCompletionTime(review){
 const times=ACCEPTANCE_VIEWPORT_IDS.map(viewport=>review?.viewports?.[viewport]?.reviewed_at).filter(value=>typeof value==='string'&&!Number.isNaN(Date.parse(value))).sort();
 if(times.length!==ACCEPTANCE_VIEWPORT_IDS.length)throw new Error('Current paired review must provide a valid reviewed_at timestamp for every required viewport');
 return times.at(-1);
}
// Review completes the image dimension of a captured full check. It does not
// rerender unchanged surfaces or reinterpret any failed/unknown port dimension.
export async function finalizeVisualAcceptance({result,review,css,baseCss='',source,preview,fullCheckInputBindings=null}){
 if(result.target_acceptance_contract_sha256!==TARGET_ACCEPTANCE_CONTRACT_SHA256)throw new Error('Current full check uses a superseded target acceptance contract');
 if(fullCheckInputBindings&&result.full_check_input_bindings?.sha256!==fullCheckInputBindings.sha256)throw new Error('Current full check uses superseded package check inputs');
 for(const [key,bytes] of [['candidate_css_sha256',css],['candidate_source_sha256',source],['candidate_preview_sha256',preview]])if(result[key]!==sha(bytes))throw new Error(`Current full check uses superseded ${key}`);
 if((result.candidate_base_css_sha256??null)!==(baseCss?sha(baseCss):null))throw new Error('Current full check uses superseded base CSS');
 if(result.verification_scope?.mode!=='full'||result.verification_scope.deferred?.length)throw new Error('Iteration/deferred checks cannot finish acceptance');
 const target=result.local_target_acceptance??result.target_acceptance;
 const exemptionState=faithfulDesignExemptionsState();
 const waivers=matchFullCheckWaivers(exemptionState.document,result);
 const errorFindings=(target?.findings??[]).filter(row=>row.severity==='error');
 const unwaivedErrorFindings=errorFindings.filter(finding=>!waivers.some(waiver=>waiver.finding===finding));
 // A target that fails only through exactly waived findings has no unresolved
 // nonvisual work: its remaining dimension is the visual review itself, the
 // same state an inconclusive target is finalized from. Any unwaived error
 // finding keeps the raw status, so this cannot weaken the gate.
 const effectiveTargetStatus=target?.status==='fail'&&errorFindings.length&&!unwaivedErrorFindings.length&&target?.visual_status==='inconclusive'?'inconclusive':target?.status;
 const tortureVerdict=typeof result.torture==='string'?result.torture:result.torture?.verdict;
 if(result.verdict!==overallAcceptance(result.port_decision.verdict,target?.status)||result.overall_acceptance?.port_verdict!==result.port_decision.verdict||result.overall_acceptance?.target_status!==target?.status)throw new Error('Captured combined acceptance dimensions disagree');
 if(ACCEPTANCE_VIEWPORT_IDS.some(viewport=>!result.viewport_status?.[viewport]))throw new Error('Full viewport acceptance is incomplete');
 if(result.font_diagnostics?.status!=='measured'||!result.font_diagnostics.fonts?.some(font=>font.glyph_count>0))throw new Error('Japanese glyph acceptance is incomplete');
 if(!['pass','warn'].includes(result.port_decision?.verdict))throw new Error('Unresolved or failed port decision cannot be accepted by image review');
 if(!['pass','warn','inconclusive'].includes(effectiveTargetStatus)||effectiveTargetStatus==='inconclusive'&&target.visual_status!=='inconclusive')throw new Error('Target acceptance has unresolved nonvisual work');
 if(unwaivedErrorFindings.length||(Array.isArray(result.next_actions)?result.next_actions.length:result.next_actions)||result.missing_candidate_assets||result.external_requests||result.image_diagnostics?.broken?.length||Object.entries(result.viewport_status??{}).some(([viewport,row])=>row.status!=='pass'&&!viewportExplainedByWaivers(result,viewport,waivers))||Object.values(result.interaction_diagnostics??{}).some(row=>row.status==='fail')||!['pass','warn'].includes(tortureVerdict))throw new Error('Image review cannot override failed target checks');
 const captures={};
 for(const viewport of ACCEPTANCE_VIEWPORT_IDS){
  const row=result.visual?.viewports?.[viewport];if(!row?.candidate_path||!row.reference_path)throw new Error(`Missing paired visual capture: ${viewport}`);
  captures[viewport]={...row,comparison:{status:row.comparison_status,normalized_rmse:row.normalized_rmse}};
 }
 await bindVisualAcceptance(captures,review,{css,baseCss,wikitext:preview,source});
 const visual=summarizeVisual(captures);if(!['pass','warn'].includes(visual.status))throw new Error(`Image review is ${visual.status}`);
 const output=structuredClone(result);
 output.visual={...visual,decision_authority:'SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY'};
 const targetStatus=visual.status==='warn'||target.issue_count>0||target.style_change_count>0||target.torture_changed_component_count>0||tortureVerdict==='warn'?'warn':'pass';
 const finalizedTarget={...target,status:targetStatus,visual_status:visual.status};
 if(waivers.length){
  const waivedEntries=new Map(waivers.map(waiver=>[waiver.finding,waiver.entry]));
  finalizedTarget.findings=(target.findings??[]).map(finding=>waivedEntries.has(finding)?{...finding,exemption:{entry_id:waivedEntries.get(finding).id,decision:waivedEntries.get(finding).decision}}:finding);
 }
 // Preserve whichever target-acceptance field shape the captured full check
 // uses. Current checks emit `target_acceptance`; older fixtures/tests may use
 // `local_target_acceptance`. Leaving an existing field stale makes the
 // combined-acceptance validator prefer the old inconclusive value.
 if(result.target_acceptance)output.target_acceptance=finalizedTarget;
 if(result.local_target_acceptance)output.local_target_acceptance=finalizedTarget;
 if(!result.target_acceptance&&!result.local_target_acceptance)output.local_target_acceptance=finalizedTarget;
 output.local_target_acceptance_status=targetStatus;
 const overall=overallAcceptance(result.port_decision.verdict,targetStatus);
 output.overall_acceptance={status:overall,port_verdict:result.port_decision.verdict,target_status:targetStatus};
 output.verdict=overall;output.status=overall==='warn'?'warn-no-actionable-issues':'pass';
 output.image_review_provenance={schema:'theme_lab_visual_acceptance.v1',review_sha256:sha(JSON.stringify(review)),raw_result_sha256:sha(JSON.stringify(result)),candidate_css_sha256:sha(css),candidate_source_sha256:sha(source),candidate_preview_sha256:sha(preview),candidate_base_css_sha256:baseCss?sha(baseCss):null,scope:'Only exact reviewed image acceptance completed; port decisions and measured target findings are preserved.'};
 if(waivers.length){
  for(const viewport of new Set(waivers.map(waiver=>waiver.finding.viewport))){
   if(viewportExplainedByWaivers(result,viewport,waivers)){
    output.viewport_status[viewport]={...output.viewport_status[viewport],status:'pass',exemption_entry_ids:waivers.filter(waiver=>waiver.finding.viewport===viewport).map(waiver=>waiver.entry.id)};
   }
  }
  output.faithful_design_exemptions={schema:FAITHFUL_DESIGN_EXEMPTIONS_SCHEMA,ledger_sha256:exemptionState.sha256,waivers:waivers.map(({entry,finding})=>({entry_id:entry.id,decision:entry.decision,kind:finding.kind,viewport:finding.viewport,measured:Object.fromEntries(FULL_CHECK_MEASUREMENT_KEYS.map(key=>[key,finding[key]??null])),viewport_status_original:result.viewport_status?.[finding.viewport]?.status??null,target_status_original:target.status}))};
 }
 return output;
}
