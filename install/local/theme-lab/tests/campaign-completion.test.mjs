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
 const contract={baseline_theme:{replacement_css_sha256:fixtureIdentity.baseline}};
 const runContract=write('ports/current-acceptance/run-contract.json',contract),migrationContract=write('sigma10-migration/current-campaign/run-contract.json',contract);
 const shot=write('ports/captures/test.png','controlled mock screenshot');
 const row=(theme,engine,viewport,state)=>({run_contract_sha256:runContract.sha256,baseline_theme_mode:'replacement',baseline_theme_css_sha256:fixtureIdentity.baseline,action_responses:[],theme,browser_engine:engine,viewport,surface:state.surface,state:state.state,candidate_sha256:candidateIdentity(fs.readFileSync(path.join(root,css.path)),Buffer.alloc(0)).candidateSha,candidate_source_sha256:source.sha256,classification:'PASS_NATURAL',reviewed_after_last_change:true,unconfirmed_items:[],asset_failures:[],page_errors:[],external_requests_sent:0,screenshot:'captures/test.png',screenshot_sha256:shot.sha256,visual_review:{screenshot_sha256:shot.sha256},migration_review:{screenshot_sha256:shot.sha256}});
 const rows=(theme,normalOnly=false)=>matrix.flatMap(([engine,viewport])=>browserContract.states.filter(state=>state.applicable_viewports.includes(viewport)&&(engine==='chromium'||core.has(`${state.surface}.${state.state}`))&&(!normalOnly||state.surface==='page.normal')).map(state=>row(theme,engine,viewport,state)));
 const audit={state_applicability:browserContract.states,records:rows('testtheme')};
 const migrationAudit={state_applicability:browserContract.states,records:[...rows('testtheme',true),...rows('sigma10-baseline')]};
 const viewports=['desktop','laptop','tablet','mobile','narrow-mobile'];
 const visualReview=Object.fromEntries(viewports.map(viewport=>[viewport,{candidate_screenshot_sha256:shot.sha256,reference_screenshot_sha256:shot.sha256,reviewed_at:new Date().toISOString(),reviewer:'test reviewer',note:'Reviewed exact paired screenshot bytes and preserved the target controls.'}]));
 const full={target_fixture_identity:fixtureIdentity,...result('pass','pass','pass'),candidate_css_sha256:css.sha256,candidate_source_sha256:source.sha256,candidate_preview_sha256:preview.sha256,verification_scope:{mode:'full',deferred:[]},viewport_status:Object.fromEntries(viewports.map(viewport=>[viewport,{status:'pass'}])),font_diagnostics:{status:'measured',fonts:[{glyph_count:20}]},visual:{viewports:Object.fromEntries(viewports.map(viewport=>[viewport,{status:'pass',candidate_path:shot.path,reference_path:shot.path,candidate_screenshot_sha256:shot.sha256,reference_screenshot_sha256:shot.sha256,review:visualReview[viewport]}]))},image_review_provenance:{schema:'theme_lab_visual_acceptance.v1',candidate_css_sha256:css.sha256,candidate_source_sha256:source.sha256,candidate_preview_sha256:preview.sha256}};
 const receipt=write('package-result.json',full);
 const migrationBinding=write('migration-audit.json',migrationAudit);
 const migrationResult={overall_acceptance:{status:'pass'},browser_audit_sha256:migrationBinding.sha256};
 const document={schema:'theme_lab_current_campaign_acceptance.v1',packages:[{package:'testtheme',inputs:{css,source,preview},receipt,browser_audit:write('package-audit.json',audit)}],migration:{receipt:write('migration-result.json',migrationResult),browser_audit:migrationBinding}};
 const save=()=>write('current-campaign-acceptance.json',document);save();return{root,document,write,save,audit,migrationResult,full};
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
  assert.ok(failures.some(value=>value.includes('unbound paired image review')));
 }finally{fs.rmSync(mock.root,{recursive:true,force:true})}
});
test('historical integrity cannot promote an unresolved current migration',()=>{
 const mock=mockCampaign();try{
  mock.migrationResult.overall_acceptance.status='inconclusive';mock.document.migration.receipt=mock.write('migration-result.json',mock.migrationResult);mock.save();
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('migration acceptance is inconclusive')));
 }finally{fs.rmSync(mock.root,{recursive:true,force:true})}
});
test('promotion rejects a omitted state even when remaining screenshots have been reviewed',()=>{
 const mock=mockCampaign();try{
  mock.audit.records.pop();mock.document.packages[0].browser_audit=mock.write('package-audit.json',mock.audit);mock.save();
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('Missing current browser state')));
 }finally{fs.rmSync(mock.root,{recursive:true,force:true})}
});
