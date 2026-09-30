// Promotion is distinct from read-only inspection of historical evidence.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import browserContract from '../fixtures/browser-acceptance-states.json' with {type:'json'};
import {candidateIdentity} from '../ports/scripts/candidate-identity.mjs';
import {overallAcceptance} from './verdict.mjs';
import {ACCEPTANCE_VIEWPORT_IDS} from './acceptance-viewports.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const accepted = value => ['pass', 'warn'].includes(value);

export function validateCombinedAcceptance(result, label) {
  const overall = result?.overall_acceptance;
  const target = result?.target_acceptance ?? result?.local_target_acceptance;
  const port = result?.port_decision;
  const failures = [];
  if (!accepted(overall?.status)) failures.push(`${label}: current overall acceptance is ${overall?.status ?? 'missing'}`);
  if (!accepted(port?.verdict)) failures.push(`${label}: current port decision is ${port?.verdict ?? 'missing'}`);
  if (!accepted(target?.status)) failures.push(`${label}: current target acceptance is ${target?.status ?? 'missing'}`);
  if (overall?.port_verdict !== port?.verdict || overall?.target_status !== target?.status) failures.push(`${label}: combined acceptance dimensions disagree`);
  if(overall?.status!==overallAcceptance(port?.verdict,target?.status))failures.push(`${label}: overall result does not combine both acceptance dimensions`);
  if (result?.verdict !== overall?.status) failures.push(`${label}: public verdict disagrees with combined acceptance`);
  return failures;
}

const matrix=[['chromium','desktop'],['chromium','laptop'],['chromium','tablet'],['chromium','mobile'],['chromium','narrow-mobile'],['firefox','desktop'],['firefox','mobile'],['webkit','desktop'],['webkit','mobile']];
const crossEngineCore=new Set(['page.normal.settled','credit.view.open','page.history.list','page.source.open','nav.sidebar.open','nav.sidebar.open-submenu','shell.interwiki.visible']);

export function validateBrowserCoverage(audit,packages,{migration=false}={}) {
 const failures=[];
 const records=audit.records??[];
 const keys=new Set(records.map(row=>`${row.theme}|${row.browser_engine}|${row.viewport}|${row.surface}.${row.state}`));
 const states=audit.state_applicability??[];
 if(JSON.stringify(states)!==JSON.stringify(browserContract.states))failures.push('Browser state applicability differs from the maintained acceptance contract');
 for(const name of packages)for(const [engine,viewport] of matrix) {
  const required=migration&&name!=='sigma10-baseline'?[{surface:'page.normal',state:'settled',applicable_viewports:[viewport]}]:browserContract.states;
  for(const state of required) {
   const id=`${state.surface}.${state.state}`;
   if(!state.applicable_viewports?.includes(viewport) || engine!=='chromium'&&!crossEngineCore.has(id))continue;
   const key=`${name}|${engine}|${viewport}|${id}`;
   if(!keys.has(key))failures.push(`Missing current browser state ${key}`);
  }
 }
 if(keys.size!==records.length)failures.push('Duplicate browser acceptance rows');
 return failures;
}

export function checkCampaignCompletion(root) {
  const failures = [];
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const bind = (binding, label) => {
    if (!binding || typeof binding.path !== 'string' || !/^[0-9a-f]{64}$/u.test(binding.sha256 ?? '')) throw new Error(`${label}: missing exact artifact binding`);
    const file = path.resolve(root, binding.path);
    if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error(`${label}: artifact escapes Theme Lab`);
    const bytes = fs.readFileSync(file);
    if (sha(bytes) !== binding.sha256) throw new Error(`${label}: stale artifact ${binding.path}`);
    return bytes;
  };
  let document;
  try { document = read('current-campaign-acceptance.json'); }
  catch { return {status: 'inconclusive', failures: ['Current campaign acceptance receipt is missing; historical integrity cannot authorize completion.']}; }
  if (document.schema !== 'theme_lab_current_campaign_acceptance.v1') failures.push('Invalid current campaign receipt schema');
  const ledger = read('ports/adaptation-authority.json');
  const names = Object.keys(ledger.packages).sort();
  const expectedTargetFixtures=Object.fromEntries(Object.entries({baseline:'fixtures/scp-jp-sigma9-offline.css',sidebar:'fixtures/scp-jp-sidebar.html',header:'fixtures/scp-jp-header.html',navigation:'fixtures/scp-jp-navigation.html'}).map(([name,file])=>[name,sha(fs.readFileSync(path.join(root,file)))]));
  const currentRunContract=fs.readFileSync(path.join(root,'ports/current-acceptance/run-contract.json'));
  const currentRunContractSha=sha(currentRunContract),currentRunSpec=JSON.parse(currentRunContract);
  const currentMigrationContract=fs.readFileSync(path.join(root,'sigma10-migration/current-campaign/run-contract.json'));
  const currentMigrationContractSha=sha(currentMigrationContract),currentMigrationSpec=JSON.parse(currentMigrationContract);
  const rows = document.packages ?? [];
  if (rows.length !== names.length || new Set(rows.map(row => row.package)).size !== rows.length || rows.map(row => row.package).sort().join('\0') !== names.join('\0')) failures.push('Current package acceptance inventory does not match maintained packages');
  for (const row of rows) {
    try {
      const result = JSON.parse(bind(row.receipt, row.package));
      failures.push(...validateCombinedAcceptance(result, row.package));
      if(Object.entries(expectedTargetFixtures).some(([name,hash])=>result.target_fixture_identity?.[name]!==hash))failures.push(`${row.package}: paired check uses superseded target fixtures`);
      if(result.verification_scope?.mode!=='full'||result.verification_scope?.deferred?.length)failures.push(`${row.package}: completion requires a full, non-deferred check`);
      if(ACCEPTANCE_VIEWPORT_IDS.some(viewport=>result.viewport_status?.[viewport]?.status!=='pass'))failures.push(`${row.package}: current viewport acceptance is incomplete`);
      if(result.font_diagnostics?.status!=='measured'||!result.font_diagnostics?.fonts?.some(font=>font.glyph_count>0))failures.push(`${row.package}: Japanese glyph acceptance is incomplete`);
      for (const [key, filename] of [['css', 'candidate.css'], ['source', ledger.packages[row.package]?.source_file ?? 'candidate.wikidot.source.txt'], ['preview', 'candidate.wikidot.txt']]) {
        const bytes = bind(row.inputs?.[key], `${row.package}/${key}`);
        const expected = path.join(root, 'ports', row.package, filename);
        if (sha(fs.readFileSync(expected)) !== sha(bytes)) failures.push(`${row.package}: acceptance uses a superseded ${key}`);
        const resultKey={css:'candidate_css_sha256',source:'candidate_source_sha256',preview:'candidate_preview_sha256'}[key];
        if(result[resultKey]!==sha(bytes))failures.push(`${row.package}: accepted result is not bound to current ${key}`);
      }
      for(const viewport of ACCEPTANCE_VIEWPORT_IDS){
        const visual=result.visual?.viewports?.[viewport];
        const review=visual?.review;
        if(!accepted(visual?.status)||review?.candidate_screenshot_sha256!==visual?.candidate_screenshot_sha256||review?.reference_screenshot_sha256!==visual?.reference_screenshot_sha256||typeof review?.note!=='string'||review.note.trim().length<12||typeof review?.reviewer!=='string'||!review.reviewer.trim()||typeof review?.reviewed_at!=='string'||!Number.isFinite(Date.parse(review.reviewed_at)))failures.push(`${row.package}: unbound paired image review at ${viewport}`);
        for(const side of ['candidate','reference']){
          const file=visual?.[`${side}_path`];
          // Retained captures may use absolute checkout paths; the file must
          // still resolve within this checkout and match the reviewed bytes.
          if(typeof file!=='string')continue;
          const relative=path.relative(root,path.resolve(root,file));
          bind({path:relative,sha256:visual[`${side}_screenshot_sha256`]},`${row.package}/${viewport}/${side}`);
        }
      }
      const reviewProvenance=result.image_review_provenance;
      if(reviewProvenance?.schema!=='theme_lab_visual_acceptance.v1'||reviewProvenance.candidate_css_sha256!==result.candidate_css_sha256||reviewProvenance.candidate_source_sha256!==result.candidate_source_sha256||reviewProvenance.candidate_preview_sha256!==result.candidate_preview_sha256)failures.push(`${row.package}: image review identity is not bound to the accepted inputs`);
      const audit = JSON.parse(bind(row.browser_audit, `${row.package}/browser audit`));
      const records = audit.records?.filter(record => record.theme === row.package) ?? [];
      failures.push(...validateBrowserCoverage(audit,[row.package]));
      let base=Buffer.alloc(0);try{base=fs.readFileSync(path.join(root,'ports',row.package,'candidate-base.css'))}catch{}
      const currentCandidate=candidateIdentity(fs.readFileSync(path.join(root,'ports',row.package,'candidate.css')),base).candidateSha;
      for (const record of records) {
        if(record.run_contract_sha256!==currentRunContractSha||record.baseline_theme_mode!=='replacement'||record.baseline_theme_css_sha256!==currentRunSpec.baseline_theme.replacement_css_sha256)failures.push(`${row.package}: browser capture uses superseded target baseline/contract`);
        if(!Array.isArray(record.unconfirmed_items)||!Array.isArray(record.asset_failures)||!Array.isArray(record.page_errors)||!Array.isArray(record.action_responses))failures.push(`${row.package}: browser capture lacks explicit safety results`);
        if (!['PASS_NATURAL', 'PASS_INTENTIONAL_DIVERGENCE'].includes(record.classification) || !record.reviewed_after_last_change || record.unconfirmed_items?.length || record.asset_failures?.length || record.page_errors?.length || record.external_requests_sent !== 0 || record.failure || record.action_responses?.some(response=>response.type==='failure'||response.status>=400||response.error_message)) failures.push(`${row.package}: unresolved browser state ${record.surface}.${record.state}`);
        if(record.candidate_sha256!==currentCandidate)failures.push(`${row.package}: superseded browser CSS identity`);
        if (record.candidate_source_sha256 !== row.inputs.source.sha256) failures.push(`${row.package}: superseded browser source identity`);
        if (sha(bind({path: `ports/${record.screenshot}`, sha256: record.screenshot_sha256}, row.package)) !== record.visual_review?.screenshot_sha256) failures.push(`${row.package}: missing current image review`);
      }
    } catch (error) { failures.push(error.message); }
  }
  try {
    const migration = JSON.parse(bind(document.migration?.receipt, 'Sigma-10 migration'));
    if (!accepted(migration.overall_acceptance?.status)) failures.push(`Current Sigma-10 migration acceptance is ${migration.overall_acceptance?.status ?? 'missing'}`);
    const audit = JSON.parse(bind(document.migration?.browser_audit, 'Sigma-10 migration audit'));
    failures.push(...validateBrowserCoverage(audit,[...names,'sigma10-baseline'],{migration:true}));
    if(migration.browser_audit_sha256!==document.migration.browser_audit.sha256)failures.push('Migration decision is not bound to current browser audit');
    for(const record of audit.records??[]){
      if(record.run_contract_sha256!==currentMigrationContractSha||record.baseline_theme_mode!=='replacement'||record.baseline_theme_css_sha256!==currentMigrationSpec.baseline_theme.replacement_css_sha256)failures.push('Sigma-10 capture uses superseded baseline/contract');
      if(!Array.isArray(record.unconfirmed_items)||!Array.isArray(record.asset_failures)||!Array.isArray(record.page_errors)||!Array.isArray(record.action_responses)||record.action_responses.some(response=>response.type==='failure'||response.status>=400||response.error_message))failures.push('Sigma-10 capture lacks clean explicit safety results');
      if(record.unconfirmed_items?.length||record.asset_failures?.length||record.page_errors?.length||record.external_requests_sent!==0||!record.reviewed_after_last_change||record.migration_review?.screenshot_sha256!==record.screenshot_sha256)failures.push(`Unresolved Sigma-10 state ${record.theme}/${record.surface}.${record.state}`);
      bind({path:`ports/${record.screenshot}`,sha256:record.screenshot_sha256},'Sigma-10 screenshot');
      if(!['PASS_NATURAL','PASS_INTENTIONAL_DIVERGENCE','EXTERNAL_CONTRACT_UNVERIFIABLE','NOT_APPLICABLE'].includes(record.classification)&&!migration.nonblocking_observations?.some(item=>item.screenshot_sha256===record.screenshot_sha256&&item.blocker===false&&item.authority!=='WIKIDOT_RUNTIME_PARITY'))failures.push(`Unresolved Sigma-10 classification ${record.theme}/${record.surface}.${record.state}`);
    }
    for (const row of rows) {
      const records = audit.records?.filter(record => record.theme === row.package) ?? [];
      if (!records.length) failures.push(`${row.package}: missing current Sigma-10 migration evidence`);
      let base=Buffer.alloc(0);try{base=fs.readFileSync(path.join(root,'ports',row.package,'candidate-base.css'))}catch{}
      const currentCandidate=candidateIdentity(fs.readFileSync(path.join(root,'ports',row.package,'candidate.css')),base).candidateSha;
      if(records.some(record=>record.candidate_sha256!==currentCandidate))failures.push(`${row.package}: Sigma-10 matrix uses superseded CSS`);
      if (records.some(record => record.candidate_source_sha256 !== row.inputs.source.sha256)) failures.push(`${row.package}: Sigma-10 matrix uses a superseded candidate`);
    }
  } catch (error) { failures.push(error.message); }
  return {status: failures.length ? 'fail' : 'pass', packages: rows.length, failures};
}
