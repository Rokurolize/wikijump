import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateCombinedAcceptance,checkCampaignCompletion} from '../src/campaign-completion.mjs';
const result=(port,target,overall)=>({verdict:overall,overall_acceptance:{status:overall,port_verdict:port,target_status:target},port_decision:{verdict:port},target_acceptance:{status:target}});
test('completion rejects target failure despite port pass',()=>assert.ok(validateCombinedAcceptance(result('pass','fail','pass'),'port').length));
test('completion rejects inconclusive port and migration results',()=>assert.ok(validateCombinedAcceptance(result('inconclusive','pass','inconclusive'),'port').length));
test('completion accepts consistent combined pass and warn dimensions',()=>{
 assert.deepEqual(validateCombinedAcceptance(result('pass','pass','pass'),'port'),[]);
 assert.deepEqual(validateCombinedAcceptance(result('pass','warn','warn'),'port'),[]);
});
test('historical integrity cannot substitute for missing current campaign acceptance',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-completion-'));
 try {const checked=checkCampaignCompletion(dir);assert.equal(checked.status,'inconclusive');assert.match(checked.failures[0],/historical integrity/)}
 finally {fs.rmSync(dir,{recursive:true,force:true})}
});

import crypto from 'node:crypto';
import browserContract from '../fixtures/browser-acceptance-states.json' with {type:'json'};
import {candidateIdentity} from '../ports/scripts/candidate-identity.mjs';
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const matrix=[['chromium','desktop'],['chromium','laptop'],['chromium','tablet'],['chromium','mobile'],['chromium','narrow-mobile'],['firefox','desktop'],['firefox','mobile'],['webkit','desktop'],['webkit','mobile']];
const core=new Set(['page.normal.settled','credit.view.open','page.history.list','page.source.open','nav.sidebar.open','nav.sidebar.open-submenu','shell.interwiki.visible']);
function mockCampaign(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-current-campaign-'));
 const write=(name,content)=>{const bytes=typeof content==='string'?content:JSON.stringify(content);const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return {path:name,sha256:digest(bytes)}};
 write('ports/adaptation-authority.json',{packages:{testtheme:{}}});
 const css=write('ports/testtheme/candidate.css','body { color: black; }');
 const source=write('ports/testtheme/candidate.wikidot.source.txt','Theme source');
 const preview=write('ports/testtheme/candidate.wikidot.txt','JP preview');
 const fixtureIdentity=Object.fromEntries(Object.entries({baseline:'fixtures/scp-jp-sigma9-offline.css',sidebar:'fixtures/scp-jp-sidebar.html',header:'fixtures/scp-jp-header.html',navigation:'fixtures/scp-jp-navigation.html'}).map(([name,file])=>[name,write(file,'frozen target '+name).sha256]));
 const baselineCss=write('sigma10-migration/baseline-probe/candidate.css','body { color: gray; }');
 const baselineSource=write('sigma10-migration/baseline-probe/candidate.wikidot.source.txt','Sigma 10 source');
 const savedCss=write('sigma10-migration/current-campaign/saved-credit-component.css','/* saved cascade */');
 const sourceManifest=write('sigma10-migration/source-manifest.json',{pages:{}});
 const cascade={schema:'theme_lab_saved_credit_cascade.v1',order:['baseline','credit:style imports info:style','credit:start inline style'],semantics:'saved page'};
 write('sigma10-migration/current-campaign/saved-credit-component.json',{schema:'theme_lab_frozen_component_css.v1',css_sha256:savedCss.sha256,cascade});
 const inventory=[{package:'testtheme',directory:'../../ports/testtheme',candidate_sha256:candidateIdentity(fs.readFileSync(path.join(root,css.path)),Buffer.alloc(0)).candidateSha,source_sha256:source.sha256},{package:'sigma10-baseline',directory:'../baseline-probe',candidate_sha256:candidateIdentity(fs.readFileSync(path.join(root,baselineCss.path)),Buffer.alloc(0)).candidateSha,source_sha256:baselineSource.sha256}];
 const contract={baseline_theme:{replacement_css_sha256:fixtureIdentity.baseline},current_candidate_inventory:inventory,additional_candidates:Object.fromEntries(inventory.map(row=>[row.package,{directory:row.directory,candidate_sha256:row.candidate_sha256,source_sha256:row.source_sha256}])),frozen_sigma10_authority:{schema:'theme_lab_frozen_sigma10_authority.v1',source_manifest:'sigma10-migration/source-manifest.json',source_manifest_sha256:sourceManifest.sha256,artifacts:{manifest:sourceManifest}},saved_component_css:{sha256:savedCss.sha256,cascade}};
 const runContract=write('ports/current-acceptance/run-contract.json',contract),migrationContract=write('sigma10-migration/current-campaign/run-contract.json',contract);
 const shot=write('ports/captures/test.png','controlled mock screenshot');
 const row=(theme,engine,viewport,state,runSha=runContract.sha256)=>{
  const isBaseline=theme==='sigma10-baseline';
  const candidateSha=candidateIdentity(fs.readFileSync(path.join(root,isBaseline?baselineCss.path:css.path)),Buffer.alloc(0)).candidateSha;
  const sourceSha=isBaseline?baselineSource.sha256:source.sha256;
  return {run_contract_sha256:runSha,baseline_theme_mode:'replacement',baseline_theme_css_sha256:fixtureIdentity.baseline,action_responses:[],theme,browser_engine:engine,viewport,surface:state.surface,state:state.state,candidate_sha256:candidateSha,candidate_source_sha256:sourceSha,classification:'PASS_NATURAL',reviewed_after_last_change:true,unconfirmed_items:[],asset_failures:[],page_errors:[],external_requests_sent:0,screenshot:'captures/test.png',screenshot_sha256:shot.sha256,visual_review:{method:'direct-image-vision-review',reviewer:'reviewer',reviewed_at:'2026-01-01T00:00:00Z',note:'Reviewed exact screenshot with no unresolved visual issue.',screenshot_sha256:shot.sha256,candidate_sha256:candidateSha,candidate_source_sha256:sourceSha},migration_review:{classification:'PASS_NATURAL',review_method:'direct-image-vision-review plus paired local contract probes',reviewer:'reviewer',reviewed_at:'2026-01-01T00:00:00Z',note:'Reviewed exact screenshot with local contract probes.',screenshot_sha256:shot.sha256}};
 };
 const rows=(theme,normalOnly=false,runSha=runContract.sha256)=>matrix.flatMap(([engine,viewport])=>browserContract.states.filter(state=>state.applicable_viewports.includes(viewport)&&(engine==='chromium'||core.has(`${state.surface}.${state.state}`))&&(!normalOnly||state.surface==='page.normal')).map(state=>row(theme,engine,viewport,state,runSha)));
 const audit={state_applicability:browserContract.states,records:rows('testtheme')};
 const migrationAudit={state_applicability:browserContract.states,records:[...rows('testtheme',true,migrationContract.sha256),...rows('sigma10-baseline',false,migrationContract.sha256)]};
 const viewports=['desktop','laptop','tablet','mobile','narrow-mobile'];
 const visualReview=Object.fromEntries(viewports.map(viewport=>[viewport,{candidate_screenshot_sha256:shot.sha256,reference_screenshot_sha256:shot.sha256,reviewed_at:'2026-01-01T00:00:00Z',reviewer:'test reviewer',note:'Reviewed exact paired screenshot bytes and preserved the target controls.'}]));
 const full={target_fixture_identity:fixtureIdentity,...result('pass','pass','pass'),candidate_css_sha256:css.sha256,candidate_source_sha256:source.sha256,candidate_preview_sha256:preview.sha256,verification_scope:{mode:'full',deferred:[]},viewport_status:Object.fromEntries(viewports.map(viewport=>[viewport,{status:'pass'}])),font_diagnostics:{status:'measured',fonts:[{glyph_count:20}]},visual:{viewports:Object.fromEntries(viewports.map(viewport=>[viewport,{status:'pass',acceptance:{status:'pass'},candidate_path:shot.path,reference_path:shot.path,candidate_screenshot_sha256:shot.sha256,reference_screenshot_sha256:shot.sha256,review:visualReview[viewport]}]))},image_review_provenance:{schema:'theme_lab_visual_acceptance.v1',candidate_css_sha256:css.sha256,candidate_source_sha256:source.sha256,candidate_preview_sha256:preview.sha256}};
 const receipt=write('package-result.json',full);
 const migrationBinding=write('migration-audit.json',migrationAudit);
 const migrationResult={schema:'theme_lab_current_sigma10_acceptance.v1',status:'pass',overall_acceptance:{status:'pass'},browser_audit_sha256:migrationBinding.sha256,run_contract_sha256:migrationContract.sha256,candidates:{testtheme:{candidate_sha256:candidateIdentity(fs.readFileSync(path.join(root,css.path)),Buffer.alloc(0)).candidateSha,source_sha256:source.sha256},'sigma10-baseline':{candidate_sha256:candidateIdentity(fs.readFileSync(path.join(root,baselineCss.path)),Buffer.alloc(0)).candidateSha,source_sha256:baselineSource.sha256}}};
 const document={schema:'theme_lab_current_campaign_acceptance.v1',packages:[{package:'testtheme',inputs:{css,source,preview},receipt,browser_audit:write('package-audit.json',audit)}],migration:{receipt:write('migration-result.json',migrationResult),browser_audit:migrationBinding}};
 const save=()=>write('current-campaign-acceptance.json',document);save();return{root,document,write,save,audit,migrationAudit,migrationResult,full};
}
test('promotion requires current identities, complete browser coverage and accepted migration',()=>{
 const mock=mockCampaign();try{
  assert.deepEqual(checkCampaignCompletion(mock.root).failures,[]);
  fs.appendFileSync(path.join(mock.root,'ports/testtheme/candidate.css'),' /* changed */');
  assert.equal(checkCampaignCompletion(mock.root).status,'fail');
 }finally{fs.rmSync(mock.root,{recursive:true,force:true})}
});
test('promotion rejects iteration checks and missing exact paired image review',()=>{
 const mock=mockCampaign();try{
  mock.full.verification_scope.mode='iteration';delete mock.full.visual.viewports.mobile.review;
  mock.document.packages[0].receipt=mock.write('package-result.json',mock.full);mock.save();
  const failures=checkCampaignCompletion(mock.root).failures;
  assert.ok(failures.some(value=>value.includes('full, non-deferred')));
  assert.ok(failures.some(value=>value.includes('unbound or incomplete paired image review')));
 }finally{fs.rmSync(mock.root,{recursive:true,force:true})}
});
test('historical integrity cannot promote an unresolved current migration',()=>{
 const mock=mockCampaign();try{
  mock.migrationResult.status='inconclusive';mock.migrationResult.overall_acceptance.status='inconclusive';mock.document.migration.receipt=mock.write('migration-result.json',mock.migrationResult);mock.save();
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('Sigma-10 migration acceptance is inconclusive')));
 }finally{fs.rmSync(mock.root,{recursive:true,force:true})}
});
test('promotion requires an explicitly current Sigma-10 candidate receipt and exact candidate matrix',()=>{
 const mock=mockCampaign();try{
  delete mock.migrationResult.schema;mock.document.migration.receipt=mock.write('migration-result.json',mock.migrationResult);mock.save();
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('not a current-candidate acceptance')));
  mock.migrationResult.schema='theme_lab_current_sigma10_acceptance.v1';mock.migrationResult.candidates.testtheme.candidate_sha256='0'.repeat(64);
  mock.document.migration.receipt=mock.write('migration-result.json',mock.migrationResult);mock.save();
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('candidate identities do not match')));
 }finally{fs.rmSync(mock.root,{recursive:true,force:true})}
});
test('current Sigma-10 contract must enumerate maintained candidates and baseline',()=>{
 const mock=mockCampaign();try{
  const contract=JSON.parse(fs.readFileSync(path.join(mock.root,'sigma10-migration/current-campaign/run-contract.json'),'utf8'));
  contract.current_candidate_inventory.pop();mock.write('sigma10-migration/current-campaign/run-contract.json',contract);
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('Sigma-10 current candidate inventory')));
 }finally{fs.rmSync(mock.root,{recursive:true,force:true})}
});
test('current Sigma-10 completion rejects a capture without a bound current visual review',()=>{
 const mock=mockCampaign();try{
  delete mock.migrationAudit.records[0].migration_review.classification;
  const binding=mock.write('migration-audit.json',mock.migrationAudit);
  mock.document.migration.browser_audit=binding;mock.migrationResult.browser_audit_sha256=binding.sha256;
  mock.document.migration.receipt=mock.write('migration-result.json',mock.migrationResult);mock.save();
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('current accepted visual review')));
 }finally{fs.rmSync(mock.root,{recursive:true,force:true})}
});
test('promotion rejects a omitted state even when remaining screenshots have been reviewed',()=>{
 const mock=mockCampaign();try{
  mock.audit.records.pop();mock.document.packages[0].browser_audit=mock.write('package-audit.json',mock.audit);mock.save();
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('Missing current browser state')));
 }finally{fs.rmSync(mock.root,{recursive:true,force:true})}
});
test('promotion rejects matching screenshot hashes without attributable visual review',()=>{
 const mock=mockCampaign();try{
  const row=mock.audit.records[0];delete row.visual_review;
  mock.document.packages[0].browser_audit=mock.write('package-audit.json',mock.audit);mock.save();
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('missing current attributable image review')));
  const visual=mock.full.visual.viewports.desktop;delete visual.review.reviewer;
  mock.document.packages[0].receipt=mock.write('package-result.json',mock.full);mock.save();
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('unbound or incomplete paired image review')));
 }finally{fs.rmSync(mock.root,{recursive:true,force:true})}
});
test('promotion rejects a stale candidate or source identity recorded in the review receipt',()=>{
 const mock=mockCampaign();try{
  mock.audit.records[0].visual_review.candidate_sha256='stale-css';
  mock.document.packages[0].browser_audit=mock.write('package-audit.json',mock.audit);mock.save();
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('image review is not bound to the current candidate identity')));
 }finally{fs.rmSync(mock.root,{recursive:true,force:true})}
});
