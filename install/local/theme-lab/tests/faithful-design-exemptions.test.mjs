import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import fsp from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {faithfulDesignExemptionsState,loadFaithfulDesignExemptions,matchFullCheckWaivers,matchFaithfulDesignContainment,verifyFaithfulDesignWaivers,finalizeVisualAcceptance,FAITHFUL_DESIGN_EXEMPTIONS_SCHEMA} from '../src/finalize-visual-acceptance.mjs';
import {TARGET_ACCEPTANCE_CONTRACT_SHA256} from '../src/target-acceptance-contract.mjs';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const readPackageFile=name=>fs.readFileSync(new URL(`../ports/cosmonaut/${name}`,import.meta.url),'utf8');
const ledgerEntry=()=>loadFaithfulDesignExemptions().entries.find(entry=>entry.id==='G2-47-cosmonaut-hovertip');
const findingFromSpec=spec=>({severity:'error',kind:spec.kind,viewport:spec.viewport,overflow_px:spec.overflow_px,document_overflow_px:spec.document_overflow_px,viewport_escape_px:spec.viewport_escape_px,baseline_overflow_px:spec.baseline_overflow_px,baseline_document_overflow_px:spec.baseline_document_overflow_px,baseline_viewport_escape_px:spec.baseline_viewport_escape_px,overflow_sources:spec.selectors.map(selector=>({selector}))});
const syntheticResult=entry=>({target_acceptance_contract_sha256:entry.target_acceptance_contract_sha256,candidate_css_sha256:entry.candidate_css_sha256,candidate_source_sha256:entry.candidate_source_sha256,full_check_input_bindings:{sha256:entry.full_check_input_bindings_sha256},target_acceptance:{status:'fail',findings:entry.findings.map(findingFromSpec)}});

test('the committed ledger carries only the authorized G2-47 cosmonaut entry',()=>{
 const document=loadFaithfulDesignExemptions();
 assert.equal(document.schema,FAITHFUL_DESIGN_EXEMPTIONS_SCHEMA);
 assert.equal(document.entries.length,1);
 const entry=document.entries[0];
 assert.equal(entry.id,'G2-47-cosmonaut-hovertip');
 assert.equal(entry.decision,'G2-47');
 assert.equal(entry.package,'cosmonaut');
 assert.equal(entry.instrument,'full_check_target');
 assert.equal(entry.target_acceptance_contract_sha256,TARGET_ACCEPTANCE_CONTRACT_SHA256);
 assert.equal(entry.candidate_css_sha256,sha(readPackageFile('candidate.css')));
 assert.equal(entry.candidate_source_sha256,sha(readPackageFile('candidate.wikidot.source.txt')));
 const bytes=fs.readFileSync(new URL('../ports/current-acceptance/faithful-design-exemptions.json',import.meta.url));
 assert.equal(faithfulDesignExemptionsState().sha256,sha(bytes));
});

test('full-check waivers match exactly and any drift re-fails the finding',()=>{
 const entry=ledgerEntry();const document=loadFaithfulDesignExemptions();
 assert.equal(matchFullCheckWaivers(document,syntheticResult(entry)).length,5);
 const perturbedPx=syntheticResult(entry);perturbedPx.target_acceptance.findings[0].overflow_px=401;
 assert.equal(matchFullCheckWaivers(document,perturbedPx).length,4);
 const perturbedSelectors=syntheticResult(entry);perturbedSelectors.target_acceptance.findings[1].overflow_sources.pop();
 assert.equal(matchFullCheckWaivers(document,perturbedSelectors).length,4);
 const wrongCandidate=syntheticResult(entry);wrongCandidate.candidate_css_sha256='0'.repeat(64);
 assert.equal(matchFullCheckWaivers(document,wrongCandidate).length,0);
 assert.equal(matchFullCheckWaivers({schema:FAITHFUL_DESIGN_EXEMPTIONS_SCHEMA,entries:[]},syntheticResult(entry)).length,0);
 assert.equal(matchFullCheckWaivers(null,syntheticResult(entry)).length,0);
});

async function cosmonautFinalize(t,{perturbFindingPx=false,perturbViewportRow=false}={}){
 const entry=ledgerEntry();
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'theme-lab-ledger-'));t.after(()=>fsp.rm(dir,{recursive:true,force:true}));
 const candidate=path.join(dir,'candidate.png'),reference=path.join(dir,'reference.png');
 await fsp.writeFile(candidate,'candidate');await fsp.writeFile(reference,'reference');
 const inputs={css:readPackageFile('candidate.css'),source:readPackageFile('candidate.wikidot.source.txt'),preview:readPackageFile('candidate.wikidot.txt')};
 const viewports=['desktop','laptop','tablet','mobile','narrow-mobile'];
 const findings=entry.findings.map(findingFromSpec);
 if(perturbFindingPx)findings[2].overflow_px=401;
 const result={target_acceptance_contract_sha256:TARGET_ACCEPTANCE_CONTRACT_SHA256,next_actions:[],candidate_css_sha256:entry.candidate_css_sha256,candidate_source_sha256:entry.candidate_source_sha256,candidate_preview_sha256:sha(inputs.preview),candidate_base_css_sha256:null,full_check_input_bindings:{sha256:entry.full_check_input_bindings_sha256},verification_scope:{mode:'full',deferred:[]},port_decision:{verdict:'pass'},target_acceptance:{status:'fail',visual_status:'inconclusive',issue_count:27,style_change_count:40,torture_changed_component_count:11,findings:[...findings,{severity:'warn',kind:'local_style_delta'}]},overall_acceptance:{status:'fail',port_verdict:'pass',target_status:'fail'},verdict:'fail',viewport_status:Object.fromEntries(entry.findings.map(spec=>[spec.viewport,{status:'fail',viewport_escape_px:spec.viewport_escape_px+(perturbViewportRow&&spec.viewport==='desktop'?1:0),document_overflow_px:spec.document_overflow_px}])),font_diagnostics:{status:'measured',fonts:[{glyph_count:1}]},torture:'pass',visual:{viewports:Object.fromEntries(viewports.map(id=>[id,{candidate_path:candidate,reference_path:reference,comparison_status:'fail',normalized_rmse:.4}]))}};
 const review={schema:'theme_lab_visual_acceptance.v1',candidate_css_sha256:entry.candidate_css_sha256,candidate_source_sha256:entry.candidate_source_sha256,candidate_preview_sha256:sha(inputs.preview),viewports:Object.fromEntries(viewports.map(id=>[id,{status:'pass',candidate_screenshot_sha256:sha('candidate'),reference_screenshot_sha256:sha('reference'),reviewed_at:new Date().toISOString(),reviewer:'test reviewer',note:'Parked hovertip state reviewed against the G2-47 record.'}]))};
 return finalizeVisualAcceptance({result,review,...inputs,fullCheckInputBindings:{sha256:entry.full_check_input_bindings_sha256}});
}

test('finalize completes a target failing only through waived findings and reports the waiver',async t=>{
 const accepted=await cosmonautFinalize(t);
 assert.equal(accepted.overall_acceptance.status,'warn');
 assert.equal(accepted.target_acceptance.status,'warn');
 const marked=accepted.target_acceptance.findings.filter(finding=>finding.exemption);
 assert.equal(marked.length,5);
 assert.ok(marked.every(finding=>finding.exemption.entry_id==='G2-47-cosmonaut-hovertip'&&finding.exemption.decision==='G2-47'));
 assert.equal(accepted.target_acceptance.findings.at(-1).exemption,undefined);
 for(const viewport of ['desktop','laptop','tablet','mobile','narrow-mobile']){
  assert.equal(accepted.viewport_status[viewport].status,'pass');
  assert.deepEqual(accepted.viewport_status[viewport].exemption_entry_ids,['G2-47-cosmonaut-hovertip']);
  assert.equal(accepted.viewport_status[viewport].viewport_escape_px,400);
 }
 assert.equal(accepted.faithful_design_exemptions.schema,FAITHFUL_DESIGN_EXEMPTIONS_SCHEMA);
 assert.equal(accepted.faithful_design_exemptions.ledger_sha256,faithfulDesignExemptionsState().sha256);
 assert.equal(accepted.faithful_design_exemptions.waivers.length,5);
 assert.equal(accepted.faithful_design_exemptions.waivers[0].measured.overflow_px,400);
 assert.equal(accepted.faithful_design_exemptions.waivers[0].target_status_original,'fail');
 assert.deepEqual(verifyFaithfulDesignWaivers(accepted,'cosmonaut'),[]);
});

test('finalize still refuses when one finding or viewport row drifts from the ledger',async t=>{
 await assert.rejects(cosmonautFinalize(t,{perturbFindingPx:true}),/unresolved nonvisual work/);
 await assert.rejects(cosmonautFinalize(t,{perturbViewportRow:true}),/cannot override failed target checks/);
});

test('completion waiver verification rejects tampered or foreign waiver blocks',async t=>{
 const accepted=await cosmonautFinalize(t);
 const missing=structuredClone(accepted);missing.faithful_design_exemptions.waivers.pop();
 assert.ok(verifyFaithfulDesignWaivers(missing,'cosmonaut').length>0);
 const stale=structuredClone(accepted);stale.faithful_design_exemptions.ledger_sha256='0'.repeat(64);
 assert.ok(verifyFaithfulDesignWaivers(stale,'cosmonaut').length>0);
 assert.ok(verifyFaithfulDesignWaivers(accepted,'basalt').length>0);
 assert.deepEqual(verifyFaithfulDesignWaivers({target_acceptance:{findings:[]}},'cosmonaut'),[]);
 const unmarked=structuredClone(accepted);delete unmarked.faithful_design_exemptions;
 assert.ok(verifyFaithfulDesignWaivers(unmarked,'cosmonaut').length>0);
});

test('containment exemptions match exactly, including the certified-remedy-conflict class',()=>{
 const key=JSON.stringify(['ouroborous-theme','chromium','mobile','page.history','settled']);
 const document={schema:FAITHFUL_DESIGN_EXEMPTIONS_SCHEMA,entries:[
  {id:'OD-T1-ouroborous-history',decision:'OD-T1',package:'ouroborous-theme',instrument:'semantic_document_containment',match:{observation_key:key,candidate_overflow_px:52,baseline_overflow_px:0,dependencies_sha256:'a'.repeat(64)}},
  {id:'OD-T2-hansarp-history-fallback',decision:'certified-remedy-conflict',package:'hansarp',instrument:'semantic_document_containment',match:{observation_key:JSON.stringify(['hansarp','chromium','narrow-mobile','page.history','settled']),candidate_overflow_px:5,baseline_overflow_px:0,dependencies_sha256:'b'.repeat(64)}}]};
 const tuple={theme:'ouroborous-theme',observationKey:key,candidateOverflowPx:52,baselineOverflowPx:0,dependenciesSha256:'a'.repeat(64)};
 assert.equal(matchFaithfulDesignContainment(document,tuple)?.id,'OD-T1-ouroborous-history');
 assert.equal(matchFaithfulDesignContainment(document,{...tuple,candidateOverflowPx:53}),null);
 assert.equal(matchFaithfulDesignContainment(document,{...tuple,baselineOverflowPx:1}),null);
 assert.equal(matchFaithfulDesignContainment(document,{...tuple,dependenciesSha256:'c'.repeat(64)}),null);
 assert.equal(matchFaithfulDesignContainment(document,{...tuple,theme:'space'}),null);
 const fallback=matchFaithfulDesignContainment(document,{theme:'hansarp',observationKey:JSON.stringify(['hansarp','chromium','narrow-mobile','page.history','settled']),candidateOverflowPx:5,baselineOverflowPx:0,dependenciesSha256:'b'.repeat(64)});
 assert.equal(fallback?.decision,'certified-remedy-conflict');
});
