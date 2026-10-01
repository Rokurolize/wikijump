import {runtimeFilesForObservation,runtimeSurfaceContractSha} from '../src/browser-runtime-contract.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
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
import {SEMANTIC_BROWSER_MODEL,planBrowserAcceptance} from '../src/semantic-browser-acceptance.mjs';
import {BASELINE_DOCUMENT_CONTAINMENT_CONTRACT_SHA256,BASELINE_DOCUMENT_CONTAINMENT_SCHEMA} from '../src/baseline-document-containment.mjs';
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const matrix=[['chromium','desktop'],['chromium','laptop'],['chromium','tablet'],['chromium','mobile'],['chromium','narrow-mobile'],['firefox','desktop'],['firefox','mobile'],['webkit','desktop'],['webkit','mobile']];
const core=new Set(['page.normal.settled','credit.view.open','page.history.list','page.source.open','nav.sidebar.open','nav.sidebar.open-submenu','shell.interwiki.visible']);
function mockCampaign(){
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-current-campaign-'));
 const root=path.join(workspace,'install/local/theme-lab');fs.mkdirSync(root,{recursive:true});
 for(const surface of new Set(browserContract.states.map(row=>row.surface)))for(const viewport of ['desktop','mobile'])for(const file of runtimeFilesForObservation(surface,viewport)){const target=path.join(workspace,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'mock runtime input');}
 const write=(name,content)=>{const bytes=typeof content==='string'?content:JSON.stringify(content);const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return {path:name,sha256:digest(bytes)}};
 write('ports/adaptation-authority.json',{packages:{testtheme:{}}});
 const css=write('ports/testtheme/candidate.css','body { color: black; }');
 const source=write('ports/testtheme/candidate.wikidot.source.txt','Theme source');
 const preview=write('ports/testtheme/candidate.wikidot.txt','JP preview');
 const fixtureIdentity=Object.fromEntries(Object.entries({baseline:'fixtures/scp-jp-sigma9-offline.css',sidebar:'fixtures/scp-jp-sidebar.html',header:'fixtures/scp-jp-header.html',navigation:'fixtures/scp-jp-navigation.html'}).map(([name,file])=>[name,write(file,'frozen target '+name).sha256]));
 const baselineCss=write('sigma10-migration/baseline-probe/candidate.css','body { color: black; }');
 const baselineSource=write('sigma10-migration/baseline-probe/candidate.wikidot.source.txt','Theme source');
 const savedCss=write('sigma10-migration/current-campaign/saved-credit-component.css','/* saved cascade */');
 const sourceManifest=write('sigma10-migration/source-manifest.json',{pages:{}});
 const cascade={schema:'theme_lab_saved_credit_cascade.v1',order:['baseline','credit:style imports info:style','credit:start inline style'],semantics:'saved page'};
 write('sigma10-migration/current-campaign/saved-credit-component.json',{schema:'theme_lab_frozen_component_css.v1',css_sha256:savedCss.sha256,cascade});
 const inventory=[{package:'testtheme',directory:'../../ports/testtheme',candidate_sha256:candidateIdentity(fs.readFileSync(path.join(root,css.path)),Buffer.alloc(0)).candidateSha,source_sha256:source.sha256},{package:'sigma10-baseline',directory:'../baseline-probe',candidate_sha256:candidateIdentity(fs.readFileSync(path.join(root,baselineCss.path)),Buffer.alloc(0)).candidateSha,source_sha256:baselineSource.sha256}];
 const contract={baseline_theme:{replacement_css_sha256:fixtureIdentity.baseline},current_candidate_inventory:inventory,additional_candidates:Object.fromEntries(inventory.map(row=>[row.package,{directory:row.directory,candidate_sha256:row.candidate_sha256,source_sha256:row.source_sha256}])),frozen_sigma10_authority:{schema:'theme_lab_frozen_sigma10_authority.v1',source_manifest:'sigma10-migration/source-manifest.json',source_manifest_sha256:sourceManifest.sha256,artifacts:{manifest:sourceManifest}},saved_component_css:{sha256:savedCss.sha256,cascade}};
 const runContract=write('ports/current-acceptance/run-contract.json',contract),migrationContract=write('sigma10-migration/current-campaign/run-contract.json',contract);
 const shot=write('ports/captures/test.png','controlled mock screenshot');
 const row=(theme,engine,viewport,state,runSha=runContract.sha256)=>({run_contract_sha256:runSha,baseline_theme_mode:'replacement',baseline_theme_css_sha256:fixtureIdentity.baseline,action_responses:[],theme,browser_engine:engine,viewport,surface:state.surface,state:state.state,candidate_sha256:candidateIdentity(fs.readFileSync(path.join(root,css.path)),Buffer.alloc(0)).candidateSha,candidate_source_sha256:source.sha256,classification:'PASS_NATURAL',reviewed_after_last_change:true,unconfirmed_items:[],asset_failures:[],page_errors:[],external_requests_sent:0,screenshot:'captures/test.png',screenshot_sha256:shot.sha256,visual_review:{screenshot_sha256:shot.sha256},migration_review:{classification:'PASS_NATURAL',screenshot_sha256:shot.sha256}});
 const rows=(theme,normalOnly=false,runSha=runContract.sha256)=>matrix.flatMap(([engine,viewport])=>browserContract.states.filter(state=>state.applicable_viewports.includes(viewport)&&(engine==='chromium'||core.has(`${state.surface}.${state.state}`))&&(!normalOnly||state.surface==='page.normal')).map(state=>row(theme,engine,viewport,state,runSha)));
 write('ports/testtheme/manifest.json',{reference_url:'https://scp-wiki.wikidot.com/theme:testtheme',en_source_sha256:source.sha256});
 const audit={state_applicability:browserContract.states,records:rows('testtheme')};
 const migrationAudit={state_applicability:browserContract.states,records:[...rows('testtheme',true,migrationContract.sha256),...rows('sigma10-baseline',false,migrationContract.sha256)]};
 const full={target_fixture_identity:fixtureIdentity,...result('pass','pass','pass'),candidate_css_sha256:css.sha256,candidate_source_sha256:source.sha256,candidate_preview_sha256:preview.sha256,verification_scope:{mode:'full',deferred:[]},viewport_status:Object.fromEntries(['desktop','laptop','tablet','mobile','narrow-mobile'].map(viewport=>[viewport,{status:'pass'}])),font_diagnostics:{status:'measured',fonts:[{glyph_count:20}]},visual:{viewports:Object.fromEntries(['desktop','laptop','tablet','mobile','narrow-mobile'].map(viewport=>[viewport,{status:'pass',candidate_path:shot.path,reference_path:shot.path,candidate_screenshot_sha256:shot.sha256,reference_screenshot_sha256:shot.sha256,review:{candidate_screenshot_sha256:shot.sha256,reference_screenshot_sha256:shot.sha256}}]))}};
 const receipt=write('package-result.json',full);
 const migrationBinding=write('migration-audit.json',migrationAudit);
 const migrationResult={overall_acceptance:{status:'pass'},browser_audit_sha256:migrationBinding.sha256};
 const document={schema:'theme_lab_current_campaign_acceptance.v1',packages:[{package:'testtheme',inputs:{css,source,preview},receipt,browser_audit:write('package-audit.json',audit)}],migration:{receipt:write('migration-result.json',migrationResult),browser_audit:migrationBinding}};
 const save=()=>write('current-campaign-acceptance.json',document);save();return{root,workspace,document,write,save,audit,migrationResult,full};
}
test('promotion requires current identities, complete browser coverage and accepted migration',()=>{
 const mock=mockCampaign();try{
  assert.deepEqual(checkCampaignCompletion(mock.root).failures,[]);
  fs.appendFileSync(path.join(mock.root,'ports/testtheme/candidate.css'),' /* changed */');
  assert.equal(checkCampaignCompletion(mock.root).status,'fail');
 }finally{fs.rmSync(mock.workspace,{recursive:true,force:true})}
});
test('compressed browser evidence retains both physical and native acceptance bindings',()=>{
 const mock=mockCampaign();try{
  const compress=binding=>{
   const bytes=fs.readFileSync(path.join(mock.root,binding.path));
   const stored=gzipSync(bytes),target=binding.path+'.gz';
   fs.writeFileSync(path.join(mock.root,target),stored);
   return {path:target,sha256:digest(stored),encoding:'gzip',uncompressed_sha256:binding.sha256};
  };
  mock.document.packages[0].browser_audit=compress(mock.document.packages[0].browser_audit);
  mock.document.migration.browser_audit=compress(mock.document.migration.browser_audit);mock.save();
  assert.deepEqual(checkCampaignCompletion(mock.root).failures,[]);
  mock.document.migration.browser_audit.uncompressed_sha256=digest('wrong native evidence');mock.save();
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('stale expanded artifact')));
  mock.document.migration.browser_audit.sha256=digest('wrong compressed evidence');mock.save();
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('stale artifact')));
 }finally{fs.rmSync(mock.workspace,{recursive:true,force:true})}
});
test('promotion rejects iteration checks and missing exact paired image review',()=>{
 const mock=mockCampaign();try{
  mock.full.verification_scope.mode='iteration';delete mock.full.visual.viewports.mobile.review;
  mock.document.packages[0].receipt=mock.write('package-result.json',mock.full);mock.save();
  const failures=checkCampaignCompletion(mock.root).failures;
  assert.ok(failures.some(value=>value.includes('full, non-deferred')));
  assert.ok(failures.some(value=>value.includes('unbound paired image review')));
 }finally{fs.rmSync(mock.workspace,{recursive:true,force:true})}
});
test('historical integrity cannot promote an unresolved current migration',()=>{
 const mock=mockCampaign();try{
  mock.migrationResult.overall_acceptance.status='inconclusive';mock.document.migration.receipt=mock.write('migration-result.json',mock.migrationResult);mock.save();
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('migration acceptance is inconclusive')));
 }finally{fs.rmSync(mock.workspace,{recursive:true,force:true})}
});
test('current Sigma-10 contract must enumerate maintained candidates and baseline',()=>{
 const mock=mockCampaign();try{
  const contract=JSON.parse(fs.readFileSync(path.join(mock.root,'sigma10-migration/current-campaign/run-contract.json'),'utf8'));
  contract.current_candidate_inventory.pop();mock.write('sigma10-migration/current-campaign/run-contract.json',contract);
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('Sigma-10 current candidate inventory')));
 }finally{fs.rmSync(mock.workspace,{recursive:true,force:true})}
});
test('current Sigma-10 completion rejects a capture without a bound current visual review',()=>{
 const mock=mockCampaign();try{
  delete mock.audit.records[0].migration_review.classification;
  const binding=mock.write('migration-audit.json',mock.audit);
  mock.document.migration.browser_audit=binding;mock.migrationResult.browser_audit_sha256=binding.sha256;
  mock.document.migration.receipt=mock.write('migration-result.json',mock.migrationResult);mock.save();
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('current accepted visual review')));
 }finally{fs.rmSync(mock.workspace,{recursive:true,force:true})}
});
test('promotion rejects a omitted state even when remaining screenshots have been reviewed',()=>{
 const mock=mockCampaign();try{
  mock.audit.records.pop();mock.document.packages[0].browser_audit=mock.write('package-audit.json',mock.audit);mock.save();
  assert.ok(checkCampaignCompletion(mock.root).failures.some(value=>value.includes('Missing current browser state')));
 }finally{fs.rmSync(mock.workspace,{recursive:true,force:true})}
});

test('semantic completion accepts bound questions and measured facts, not a PASS on every screenshot',()=>{
 const mock=mockCampaign();try{
  mock.audit.acceptance_model=SEMANTIC_BROWSER_MODEL;
  for(const row of mock.audit.records){
   row.classification='UNCONFIRMED';row.reviewed_after_last_change=false;delete row.visual_review;
   row.unconfirmed_items=['screenshot captured but awaiting image review'];
   Object.assign(row,{asset_dependency_sha256:digest('assets'),fixture_contract_sha256:digest('fixture'),
    capture_state_action_contract_sha256:digest('action'),runtime_surface_contract_sha256:runtimeSurfaceContractSha(mock.workspace,row.surface,row.viewport),
    visual_diagnostics:{viewport:{width:1440,documentWidth:1440},title_overlaps:[]}});
  }
  const referenceHtml=mock.write('source.html','<!doctype html><p>Frozen foreign theme</p>');
  const sourceViewports=[...new Set(mock.audit.records.filter(row=>row.surface==='page.normal').map(row=>row.viewport))];
  const referenceCapture=mock.write('source-rendering.json',{reference_identity:{source_url:'https://scp-wiki.wikidot.com/theme:testtheme',original_html_sha256:referenceHtml.sha256,replay_entry:'/o/'+referenceHtml.sha256,snapshot_sha256:digest('snapshot'),offline:true},visual:{viewports:Object.fromEntries(sourceViewports.map(viewport=>[viewport,{reference_screenshot_sha256:mock.audit.records[0].screenshot_sha256}]))}});
  mock.audit.semantic_reviews=Object.fromEntries(planBrowserAcceptance(mock.audit).visual_questions.map(q=>[q.id,
   {question:q.question,evidence_sha256:q.evidence_sha256,status:'pass',method:'direct-visual-question-review',
    note:'Frozen source imagery and typography were compared across the declared responsive evidence.',
    reviewer:'test',reviewed_at:'2026-10-01T00:00:00Z',source_url:'https://scp-wiki.wikidot.com/theme:testtheme',
    source_snapshot:mock.document.packages[0].inputs.source,source_renderings:Object.fromEntries(sourceViewports.map(viewport=>[viewport,{source_html:referenceHtml,source_rendering_receipt:referenceCapture,source_rendering:{path:'ports/captures/test.png',sha256:mock.audit.records[0].screenshot_sha256}}])),
    decision_authority:'SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY',port_conclusion_eligible:false}]));
  mock.document.packages[0].browser_audit=mock.write('package-audit.json',mock.audit);mock.save();
  assert.deepEqual(checkCampaignCompletion(mock.root,{captureContractReader:()=>new Map(browserContract.states.map(state=>[`${state.surface}.${state.state}`,{action_contract_sha256:digest('action'),legacy_action_contract_sha256:digest('action'),fixture_contract_sha256:digest('fixture')}]))}).failures,[]);
  mock.audit.records[0].capture_state_action_contract_sha256=digest('superseded action');
  mock.document.packages[0].browser_audit=mock.write('package-audit.json',mock.audit);mock.save();
  assert.ok(checkCampaignCompletion(mock.root,{captureContractReader:()=>new Map(browserContract.states.map(state=>[`${state.surface}.${state.state}`,{action_contract_sha256:digest('action'),legacy_action_contract_sha256:digest('action'),fixture_contract_sha256:digest('fixture')}]))}).failures.some(value=>value.includes('superseded browser action/fixture')));
  mock.audit.records[0].capture_state_action_contract_sha256=digest('action');
  mock.document.packages[0].browser_audit=mock.write('package-audit.json',mock.audit);mock.save();
  const historyRuntime=path.join(mock.workspace,'framerail/src/lib/wikidot-history-contract.js');
  const previousRuntime=fs.readFileSync(historyRuntime);
  fs.appendFileSync(historyRuntime,' changed historical source primitive');
  const runtimeFailures=checkCampaignCompletion(mock.root,{captureContractReader:()=>new Map(browserContract.states.map(state=>[`${state.surface}.${state.state}`,{action_contract_sha256:digest('action'),legacy_action_contract_sha256:digest('action'),fixture_contract_sha256:digest('fixture')}]))}).failures;
  assert.ok(runtimeFailures.length>0);
  assert.ok(runtimeFailures.every(value=>value.includes('superseded browser runtime surface page.history')));
  fs.writeFileSync(historyRuntime,previousRuntime);
  mock.audit.records[0].visual_diagnostics.viewport.documentWidth=1500;
  mock.document.packages[0].browser_audit=mock.write('package-audit.json',mock.audit);mock.save();
  assert.ok(checkCampaignCompletion(mock.root,{captureContractReader:()=>new Map(browserContract.states.map(state=>[`${state.surface}.${state.state}`,{action_contract_sha256:digest('action'),legacy_action_contract_sha256:digest('action'),fixture_contract_sha256:digest('fixture')}]))}).failures.some(value=>value.includes('missing structured evidence document_containment')));
  mock.audit.records[0].baseline_document_containment_contract_sha256=BASELINE_DOCUMENT_CONTAINMENT_CONTRACT_SHA256;
  mock.audit.records[0].baseline_document_containment_measurement={schema:BASELINE_DOCUMENT_CONTAINMENT_SCHEMA,complete:true,viewport_width:1440,document_width:1440,body_width:1440};
  mock.document.packages[0].browser_audit=mock.write('package-audit.json',mock.audit);mock.save();
  assert.ok(checkCampaignCompletion(mock.root,{captureContractReader:()=>new Map(browserContract.states.map(state=>[`${state.surface}.${state.state}`,{action_contract_sha256:digest('action'),legacy_action_contract_sha256:digest('action'),fixture_contract_sha256:digest('fixture')}]))}).failures.some(value=>value.includes('machine failure document_containment')));
 }finally{fs.rmSync(mock.workspace,{recursive:true,force:true})}
});

test('semantic completion rejects a candidate snapshot impersonating another upstream source',()=>{
 const mock=mockCampaign();try{
  mock.audit.acceptance_model=SEMANTIC_BROWSER_MODEL;
  const q=planBrowserAcceptance(mock.audit).visual_questions[0];
  mock.audit.semantic_reviews={[q.id]:{source_url:'https://scp-wiki.wikidot.com/theme:another',source_snapshot:mock.document.packages[0].inputs.source}};
  mock.document.packages[0].browser_audit=mock.write('package-audit.json',mock.audit);mock.save();
  assert.ok(checkCampaignCompletion(mock.root,{captureContractReader:()=>new Map(browserContract.states.map(state=>[`${state.surface}.${state.state}`,{action_contract_sha256:digest('action'),legacy_action_contract_sha256:digest('action'),fixture_contract_sha256:digest('fixture')}]))}).failures.some(value=>value.includes('maintained upstream source authority')));
 }finally{fs.rmSync(mock.workspace,{recursive:true,force:true})}
});
