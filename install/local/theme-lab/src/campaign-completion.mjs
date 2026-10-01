import {runtimeSurfaceContractSha} from './browser-runtime-contract.mjs';
import {readCurrentBrowserContracts,observationHasCurrentActionAndFixture} from './current-browser-contracts.mjs';
import {validateSemanticSourceAuthority} from './semantic-source-authority.mjs';
// Promotion is distinct from read-only inspection of historical evidence.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import browserContract from '../fixtures/browser-acceptance-states.json' with {type:'json'};
import {candidateIdentity} from '../ports/scripts/candidate-identity.mjs';
import {ACCEPTANCE_VIEWPORT_IDS} from './acceptance-viewports.mjs';
import {overallAcceptance} from './verdict.mjs';
import {SEMANTIC_BROWSER_MODEL, validateSemanticBrowserAcceptance, semanticReviewArtifactBindings} from './semantic-browser-acceptance.mjs';
import {captureRunContractIsCurrent} from './scoped-run-contract.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const accepted = value => ['pass', 'warn'].includes(value);

export function validateCurrentSigma10Contract(root){
 const failures=[];const read=file=>fs.readFileSync(path.join(root,file));
 try{
  const contract=JSON.parse(read('sigma10-migration/current-campaign/run-contract.json'));
  const ledger=JSON.parse(read('ports/adaptation-authority.json'));
  const expected=[...Object.keys(ledger.packages),'sigma10-baseline'].sort();
  const inventory=contract.current_candidate_inventory??[];
  if(inventory.length!==expected.length||inventory.map(row=>row.package).sort().join('\0')!==expected.join('\0'))failures.push('Sigma-10 current candidate inventory does not enumerate every maintained candidate plus baseline');
  if(JSON.stringify(Object.keys(contract.additional_candidates??{}).sort())!==JSON.stringify(expected))failures.push('Sigma-10 capture candidates do not match the explicit current inventory');
  for(const row of inventory){
   const capture=contract.additional_candidates?.[row.package];
   if(!capture||capture.directory!==row.directory||capture.candidate_sha256!==row.candidate_sha256||capture.source_sha256!==row.source_sha256)failures.push(`${row.package}: capture identity differs from the declared current inventory`);
   const dir=path.resolve(path.dirname(path.join(root,'sigma10-migration/current-campaign/run-contract.json')),row.directory);
   let base=Buffer.alloc(0);try{base=fs.readFileSync(path.join(dir,'candidate-base.css'))}catch{}
   const css=fs.readFileSync(path.join(dir,'candidate.css'));
   const sourceFile=ledger.packages[row.package]?.source_file??'candidate.wikidot.source.txt';
   let source;try{source=fs.readFileSync(path.join(dir,sourceFile))}catch{source=fs.readFileSync(path.join(dir,'candidate.wikidot.txt'))}
   if(candidateIdentity(css,base).candidateSha!==row.candidate_sha256||sha(source)!==row.source_sha256)failures.push(`${row.package}: current Sigma-10 contract candidate identity is stale`);
  }
  for(const binding of Object.values(contract.frozen_sigma10_authority?.artifacts??{}))if(sha(read(binding.path))!==binding.sha256)failures.push(`Frozen Sigma-10 authority changed: ${binding.path}`);
  const manifestBytes=read(contract.frozen_sigma10_authority.source_manifest);
  if(sha(manifestBytes)!==contract.frozen_sigma10_authority.source_manifest_sha256)failures.push('Frozen Sigma-10 source manifest changed');
  const manifest=JSON.parse(manifestBytes);
  for(const [identity,page] of Object.entries(manifest.pages??{}))if(sha(read(path.join('sigma10-migration',page.file)))!==page.sha256)failures.push(`Frozen Sigma-10 source changed: ${identity}`);
  const saved=JSON.parse(read('sigma10-migration/current-campaign/saved-credit-component.json'));
  if(saved.schema!=='theme_lab_frozen_component_css.v1'||saved.css_sha256!==contract.saved_component_css?.sha256||JSON.stringify(saved.cascade)!==JSON.stringify(contract.saved_component_css?.cascade)||sha(read('sigma10-migration/current-campaign/saved-credit-component.css'))!==saved.css_sha256)failures.push('Saved-page Credit cascade or CSS binding is invalid');
 }catch(error){failures.push(`Current Sigma-10 contract invalid: ${error.message}`)}
 return failures;
}

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

export function checkCampaignCompletion(root, {captureContractReader = readCurrentBrowserContracts} = {}) {
  const failures = validateCurrentSigma10Contract(root);
  const runtimeHashes = new Map();
  const currentRuntime = row => {
    const key = JSON.stringify([row.surface,row.viewport]);
    if(!runtimeHashes.has(key))runtimeHashes.set(key,runtimeSurfaceContractSha(path.resolve(root,'../../..'),row.surface,row.viewport));
    return row.runtime_surface_contract_sha256===runtimeHashes.get(key);
  };
  const captureContracts = new Map();
  const currentCapture = (row, contract) => {
    if(!captureContracts.has(contract))captureContracts.set(contract,captureContractReader(root,contract));
    return observationHasCurrentActionAndFixture(row,captureContracts.get(contract));
  };
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
  catch { return {status: 'inconclusive', failures: ['Current campaign acceptance receipt is missing; historical integrity cannot authorize completion.',...failures]}; }
  if (document.schema !== 'theme_lab_current_campaign_acceptance.v1') failures.push('Invalid current campaign receipt schema');
  const ledger = read('ports/adaptation-authority.json');
  const names = Object.keys(ledger.packages).sort();
  const expectedTargetFixtures=Object.fromEntries(Object.entries({baseline:'fixtures/scp-jp-sigma9-offline.css',sidebar:'fixtures/scp-jp-sidebar.html',header:'fixtures/scp-jp-header.html',navigation:'fixtures/scp-jp-navigation.html'}).map(([name,file])=>[name,sha(fs.readFileSync(path.join(root,file)))]));
  const currentRunContract=fs.readFileSync(path.join(root,'ports/current-acceptance/run-contract.json'));
  const currentRunContractSha=sha(currentRunContract),currentRunSpec=JSON.parse(currentRunContract);
  const currentMigrationContract=fs.readFileSync(path.join(root,'sigma10-migration/current-campaign/run-contract.json'));
  const currentMigrationContractSha=sha(currentMigrationContract),currentMigrationSpec=JSON.parse(currentMigrationContract);
  const currentInventory=currentMigrationSpec.current_candidate_inventory??[];
  const expectedMigrationNames=[...names,'sigma10-baseline'].sort();
  if(currentInventory.length!==expectedMigrationNames.length||currentInventory.map(item=>item.package).sort().join('\0')!==expectedMigrationNames.join('\0'))failures.push('Sigma-10 current candidate inventory does not enumerate every maintained candidate plus baseline');
  const inventoryByName=new Map(currentInventory.map(item=>[item.package,item]));
  for(const name of expectedMigrationNames){
    const item=inventoryByName.get(name);if(!item)continue;
    const dir=name==='sigma10-baseline'?path.join(root,'sigma10-migration/baseline-probe'):path.join(root,'ports',name);
    const sourceName=ledger.packages[name]?.source_file??'candidate.wikidot.source.txt';
    try{
      let base=Buffer.alloc(0);try{base=fs.readFileSync(path.join(dir,'candidate-base.css'))}catch{}
      const css=fs.readFileSync(path.join(dir,'candidate.css'));
      let source;try{source=fs.readFileSync(path.join(dir,sourceName))}catch{source=fs.readFileSync(path.join(dir,'candidate.wikidot.txt'))}
      if(candidateIdentity(css,base).candidateSha!==item.candidate_sha256||sha(source)!==item.source_sha256)failures.push(`${name}: current Sigma-10 contract candidate identity is stale`);
    }catch(error){failures.push(`${name}: cannot bind current Sigma-10 candidate: ${error.message}`)}
  }
  for(const binding of Object.values(currentMigrationSpec.frozen_sigma10_authority?.artifacts??[])){
    try{bind(binding,`Frozen Sigma-10 authority ${binding.path}`)}catch(error){failures.push(error.message)}
  }
  try{
    const sourceManifestBytes=bind({path:currentMigrationSpec.frozen_sigma10_authority.source_manifest,sha256:currentMigrationSpec.frozen_sigma10_authority.source_manifest_sha256},'Frozen Sigma-10 source manifest');
    const sourceManifest=JSON.parse(sourceManifestBytes);
    for(const [identity,page] of Object.entries(sourceManifest.pages??[])){
      const sourceBytes=fs.readFileSync(path.resolve(root,'sigma10-migration',page.file));
      if(sha(sourceBytes)!==page.sha256)failures.push(`Frozen Sigma-10 source changed: ${identity}`);
    }
  }catch(error){failures.push(`Frozen Sigma-10 source authority invalid: ${error.message}`)}
  try{
    const saved=read('sigma10-migration/current-campaign/saved-credit-component.json');
    if(saved.schema!=='theme_lab_frozen_component_css.v1'||saved.css_sha256!==currentMigrationSpec.saved_component_css?.sha256||JSON.stringify(saved.cascade)!==JSON.stringify(currentMigrationSpec.saved_component_css?.cascade))failures.push('Saved-page Credit cascade differs from the reviewed frozen component contract');
    bind({path:'sigma10-migration/current-campaign/saved-credit-component.css',sha256:saved.css_sha256},'Saved-page Credit CSS');
  }catch(error){failures.push(`Saved-page Credit cascade contract invalid: ${error.message}`)}
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
        if(!accepted(visual?.status)||visual?.review?.candidate_screenshot_sha256!==visual?.candidate_screenshot_sha256||visual?.review?.reference_screenshot_sha256!==visual?.reference_screenshot_sha256)failures.push(`${row.package}: unbound paired image review at ${viewport}`);
        for(const side of ['candidate','reference']){
          const file=visual?.[`${side}_path`];
          // Retained captures may use absolute checkout paths; the file must
          // still resolve within this checkout and match the reviewed bytes.
          if(typeof file!=='string')continue;
          const relative=path.relative(root,path.resolve(root,file));
          bind({path:relative,sha256:visual[`${side}_screenshot_sha256`]},`${row.package}/${viewport}/${side}`);
        }
      }
      const audit = JSON.parse(bind(row.browser_audit, `${row.package}/browser audit`));
      const semantic = audit.acceptance_model === SEMANTIC_BROWSER_MODEL;
      if (semantic) {
        failures.push(...validateSemanticBrowserAcceptance(audit).failures, ...validateSemanticSourceAuthority(root,audit));
        for (const artifact of semanticReviewArtifactBindings(audit)) bind(artifact.binding, artifact.label);
      }
      const records = audit.records?.filter(record => record.theme === row.package) ?? [];
      failures.push(...validateBrowserCoverage(audit,[row.package]));
      let base=Buffer.alloc(0);try{base=fs.readFileSync(path.join(root,'ports',row.package,'candidate-base.css'))}catch{}
      const currentCandidate=candidateIdentity(fs.readFileSync(path.join(root,'ports',row.package,'candidate.css')),base).candidateSha;
      for (const record of records) {
        if(semantic&&!currentRuntime(record))failures.push(`${row.package}: superseded browser runtime surface ${record.surface}`);
        if(semantic&&!currentCapture(record,'ports/current-acceptance/run-contract.json'))failures.push(`${row.package}: superseded browser action/fixture ${record.surface}.${record.state}`);
        if(!captureRunContractIsCurrent(record,currentRunSpec,currentRunContractSha)||record.baseline_theme_mode!=='replacement'||record.baseline_theme_css_sha256!==currentRunSpec.baseline_theme.replacement_css_sha256)failures.push(`${row.package}: browser capture uses superseded target baseline/contract`);
        if(!Array.isArray(record.unconfirmed_items)||!Array.isArray(record.asset_failures)||!Array.isArray(record.page_errors)||!Array.isArray(record.action_responses))failures.push(`${row.package}: browser capture lacks explicit safety results`);
        if (!semantic && (!['PASS_NATURAL', 'PASS_INTENTIONAL_DIVERGENCE'].includes(record.classification) || !record.reviewed_after_last_change || record.unconfirmed_items?.length || record.asset_failures?.length || record.page_errors?.length || record.external_requests_sent !== 0 || record.failure || record.action_responses?.some(response=>response.type==='failure'||response.status>=400||response.error_message))) failures.push(`${row.package}: unresolved browser state ${record.surface}.${record.state}`);
        if(record.candidate_sha256!==currentCandidate)failures.push(`${row.package}: superseded browser CSS identity`);
        if (record.candidate_source_sha256 !== row.inputs.source.sha256) failures.push(`${row.package}: superseded browser source identity`);
        const screenshot = bind({path: `ports/${record.screenshot}`, sha256: record.screenshot_sha256}, row.package);
        if (!semantic && sha(screenshot) !== record.visual_review?.screenshot_sha256) failures.push(`${row.package}: missing current image review`);
      }
    } catch (error) { failures.push(error.message); }
  }
  try {
    const migration = JSON.parse(bind(document.migration?.receipt, 'Sigma-10 migration'));
    if (!accepted(migration.overall_acceptance?.status)) failures.push(`Current Sigma-10 migration acceptance is ${migration.overall_acceptance?.status ?? 'missing'}`);
    const audit = JSON.parse(bind(document.migration?.browser_audit, 'Sigma-10 migration audit'));
    const semantic = audit.acceptance_model === SEMANTIC_BROWSER_MODEL;
    if (semantic) {
      failures.push(...validateSemanticBrowserAcceptance(audit).failures, ...validateSemanticSourceAuthority(root,audit));
      for (const artifact of semanticReviewArtifactBindings(audit)) bind(artifact.binding, artifact.label);
    }
    failures.push(...validateBrowserCoverage(audit,[...names,'sigma10-baseline'],{migration:true}));
    if(migration.browser_audit_sha256!==document.migration.browser_audit.sha256)failures.push('Migration decision is not bound to current browser audit');
    for(const record of audit.records??[]){
      if(semantic&&!currentRuntime(record))failures.push(`Sigma-10: superseded browser runtime surface ${record.theme}/${record.surface}`);
      if(semantic&&!currentCapture(record,'sigma10-migration/current-campaign/run-contract.json'))failures.push(`Sigma-10: superseded browser action/fixture ${record.theme}/${record.surface}.${record.state}`);
      const expected=inventoryByName.get(record.theme);
      if(!expected||record.candidate_sha256!==expected.candidate_sha256||record.candidate_source_sha256!==expected.source_sha256)failures.push(`Sigma-10 capture uses an undeclared or superseded candidate identity: ${record.theme}`);
      if(!captureRunContractIsCurrent(record,currentMigrationSpec,currentMigrationContractSha)||record.baseline_theme_mode!=='replacement'||record.baseline_theme_css_sha256!==currentMigrationSpec.baseline_theme.replacement_css_sha256)failures.push('Sigma-10 capture uses superseded baseline/contract');
      if(!Array.isArray(record.unconfirmed_items)||!Array.isArray(record.asset_failures)||!Array.isArray(record.page_errors)||!Array.isArray(record.action_responses)||record.action_responses.some(response=>response.type==='failure'||response.status>=400||response.error_message))failures.push('Sigma-10 capture lacks clean explicit safety results');
      if(!semantic && (record.unconfirmed_items?.length||record.asset_failures?.length||record.page_errors?.length||record.external_requests_sent!==0||!record.reviewed_after_last_change||record.migration_review?.screenshot_sha256!==record.screenshot_sha256))failures.push(`Unresolved Sigma-10 state ${record.theme}/${record.surface}.${record.state}`);
      if(!semantic && (!['PASS_NATURAL','PASS_INTENTIONAL_DIVERGENCE','EXTERNAL_CONTRACT_UNVERIFIABLE','NOT_APPLICABLE'].includes(record.classification)||record.migration_review?.classification!==record.classification||record.visual_review?.screenshot_sha256!==record.screenshot_sha256))failures.push(`Sigma-10 state lacks a current accepted visual review: ${record.theme}/${record.surface}.${record.state}`);
      bind({path:`ports/${record.screenshot}`,sha256:record.screenshot_sha256},'Sigma-10 screenshot');
      if(!semantic && !['PASS_NATURAL','PASS_INTENTIONAL_DIVERGENCE','EXTERNAL_CONTRACT_UNVERIFIABLE','NOT_APPLICABLE'].includes(record.classification)&&!migration.nonblocking_observations?.some(item=>item.screenshot_sha256===record.screenshot_sha256&&item.blocker===false&&item.authority!=='WIKIDOT_RUNTIME_PARITY'))failures.push(`Unresolved Sigma-10 classification ${record.theme}/${record.surface}.${record.state}`);
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
