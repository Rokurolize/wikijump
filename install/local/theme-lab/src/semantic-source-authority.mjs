import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {planBrowserAcceptance, semanticSourceRenderings} from './semantic-browser-acceptance.mjs';
import {NAVIGATION_OVERLAY_SOURCE} from './navigation-overlay-provenance.mjs';
import {resolveExistingContainedFile} from './package-path.mjs';

const validHash = value => /^[a-f0-9]{64}$/u.test(value ?? '');

export function semanticSourceReferenceHtmlSha(root, audit, theme) {
  const questions = planBrowserAcceptance(audit).visual_questions
    .filter(question => question.kind === 'source_visual_identity' && question.theme === theme);
  if (!questions.length) throw new Error(`${theme}: no current source visual identity question`);
  const hashes = new Set();
  for (const question of questions) {
    const review=audit.semantic_reviews?.[question.id];
    for(const rendering of semanticSourceRenderings(question,review)){
    if (!validHash(rendering.source_html?.sha256)) throw new Error(`${theme}: source visual identity review lacks a frozen source HTML binding`);
    const file=resolveExistingContainedFile(root,rendering.source_rendering_receipt?.path??'',`${theme}: source rendering receipt`);
    const bytes=fs.readFileSync(file);
    if(crypto.createHash('sha256').update(bytes).digest('hex')!==rendering.source_rendering_receipt?.sha256)throw new Error(`${theme}: stale source rendering receipt`);
    const document=JSON.parse(bytes), result=document.result??document;
    let value;
    if(document.schema==='theme_lab_wikidot_adaptation_ab.v1'){
      const match=document.snapshot?.entry?.match(/^\/o\/([a-f0-9]{64})$/u);
      if(!match)throw new Error(`${theme}: retained source rendering lacks a frozen root HTML object`);
      value=match[1];
    }else{
      value=result.reference_identity?.original_html_sha256;
      if(value!==rendering.source_html.sha256)throw new Error(`${theme}: source rendering receipt disagrees with its frozen source HTML`);
    }
    if (!validHash(value)) throw new Error(`${theme}: source rendering receipt lacks an original HTML identity`);
    hashes.add(value);
    }
  }
  if (hashes.size !== 1) throw new Error(`${theme}: source visual identity reviews disagree on frozen source HTML`);
  return [...hashes][0];
}

// Opening a hash-bound artifact is necessary but insufficient: a candidate
// source or another theme's source must not impersonate the upstream oracle.
export function validateSemanticSourceAuthority(root, audit) {
  const failures = [];
  const read = file => JSON.parse(fs.readFileSync(resolveExistingContainedFile(root,file,`Source authority input ${file}`), 'utf8'));
  const normalize = url => new URL(url).href.replace(/^http:/u, 'https:');
  const opened = new Map();
  const open = binding => {
    const file = resolveExistingContainedFile(root,binding?.path??'','Source artifact');
    if (!opened.has(file)) {
      const bytes = fs.readFileSync(file);
      opened.set(file, {bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex')});
    }
    const artifact = opened.get(file);
    if (artifact.sha256 !== binding?.sha256) throw new Error('Stale source action artifact');
    return artifact.bytes;
  };
  const plan=planBrowserAcceptance(audit);
  const sourceApplicabilityRows=(audit.records??[]).filter(row=>row.action_contract_observation?.mode==='source-navigation-replaces-sidebar');
  for(const row of sourceApplicabilityRows){
    try{
      const action=row.action_contract_observation, document=JSON.parse(open(action.source_authority));
      if(document.schema!=='theme_lab_source_action_applicability.v1'||document.theme!==row.theme||
        row.surface!=='nav.sidebar'||!['open','open-submenu'].includes(row.state)||row.viewport!=='mobile'||
        action.schema!==document.schema||action.surface!==row.surface||action.state!==row.state||action.viewport!==row.viewport||
        action.expected_failure!==row.failure||action.candidate_sha256!==row.candidate_sha256||
        action.candidate_source_sha256!==row.candidate_source_sha256)throw new Error('Inapplicable sidebar action is not bound to its failed observation');
      const manifest=read(`ports/${row.theme}/manifest.json`), source=document.source_identity, candidate=document.candidate_identity;
      if(source?.url!==(manifest.source_url??manifest.reference_url)||source?.path!==`ports/${row.theme}/${manifest.source_identity?.en?.source_path}`||
        source?.sha256!==manifest.source_identity?.en?.sha256||candidate?.css_path!==`ports/${row.theme}/${manifest.candidate_css}`||
        candidate?.source_path!==`ports/${row.theme}/candidate.wikidot.source.txt`||candidate?.css_sha256!==row.candidate_sha256||
        candidate?.source_sha256!==row.candidate_source_sha256)throw new Error('Sidebar exception belongs to another maintained candidate/source identity');
      const css=open({path:candidate.css_path,sha256:candidate.css_sha256}).toString('utf8');
      const candidateSource=open({path:candidate.source_path,sha256:candidate.source_sha256}).toString('utf8');
      if(!/#top-bar\s+\.mobile-top-bar\s+\.open-menu\s*,\s*#side-bar\s+a\.close-menu\s*\{\s*display:\s*none\s*;/u.test(css)||
        !/#side-bar\s*\{[^}]*z-index:\s*-1\s*;/su.test(css)||
        !/nix the sidebar button in favor of my own/u.test(candidateSource)||
        !/@media[^{}]*\{[\s\S]{0,1200}#top-bar div\.mobile-top-bar\s*\{\s*display:\s*block\s*;[\s\S]{0,300}#top-bar div\.top-bar\s*\{\s*display:\s*none\s*;/u.test(css))
        throw new Error('Candidate source does not declare the replacement navigation behavior');
      const sourceRendering=JSON.parse(open(document.source_rendering).toString('utf8'));
      const sourceResult=sourceRendering.result??sourceRendering;
      if(sourceRendering.schema!=='theme_lab_source_rendering_receipt.v1'||
        sourceRendering.source_url!==(manifest.source_url??manifest.reference_url)||
        sourceRendering.source_snapshot?.sha256!==source?.sha256||
        sourceRendering.frozen_html?.sha256!==document.source_rendering?.source_html_sha256||
        sourceResult.reference_identity?.original_html_sha256!==document.source_rendering?.source_html_sha256||
        sourceResult.reference_identity?.offline!==true||
        sourceResult.visual?.viewports?.mobile?.reference_screenshot_sha256!==document.source_rendering?.reference_screenshot_sha256)
        throw new Error('Source rendering does not bind the maintained mobile navigation identity');
      const replacement=document.observations?.replacement, replacementRow=(audit.records??[]).find(candidateRow=>
        JSON.stringify([candidateRow.theme,candidateRow.browser_engine,candidateRow.viewport,candidateRow.surface,candidateRow.state])===replacement?.key);
      const replacementPlan=plan.observations.find(candidateRow=>candidateRow.key===replacement?.key);
      if(!replacementRow||replacementRow.theme!==row.theme||replacementRow.browser_engine!=='webkit'||replacementRow.viewport!=='mobile'||
        replacementRow.surface!=='nav.mobile-top'||replacementRow.state!=='submenu-expanded'||replacementRow.failure||
        replacementRow.screenshot_sha256!==replacement?.screenshot_sha256||
        replacementPlan?.dependencies_sha256!==replacement?.dependencies_sha256||
        action.replacement?.key!==replacement.key||action.replacement?.screenshot_sha256!==replacement.screenshot_sha256||
        action.replacement?.dependencies_sha256!==replacement.dependencies_sha256)
        throw new Error('Source-owned replacement navigation lacks its exact WebKit action observation');
      const replacementScreenshot=fs.readFileSync(resolveExistingContainedFile(root,`ports/${replacementRow.screenshot}`,'Replacement navigation screenshot'));
      if(crypto.createHash('sha256').update(replacementScreenshot).digest('hex')!==replacementRow.screenshot_sha256)
        throw new Error('Replacement navigation screenshot is stale');
      if(!document.observations?.inapplicable?.some(item=>item.engine===row.browser_engine&&item.state===row.state&&
        item.expected_failure===row.failure&&item.screenshot_sha256===row.screenshot_sha256))
        throw new Error('Inapplicable action failure is absent from source applicability evidence');
      const screenshot=fs.readFileSync(resolveExistingContainedFile(root,`ports/${row.screenshot}`,'Inapplicable sidebar screenshot'));
      if(crypto.createHash('sha256').update(screenshot).digest('hex')!==row.screenshot_sha256)
        throw new Error('Inapplicable sidebar screenshot is stale');
    }catch(error){failures.push(`${row.theme}/${row.browser_engine}/${row.viewport}/${row.surface}.${row.state}: source action applicability unavailable: ${error.message}`)}
  }
  if(plan.observations.some(row=>row.source_fact_authority)) {
    try {
      const proof=JSON.parse(open(NAVIGATION_OVERLAY_SOURCE));
      const prefix=path.dirname(NAVIGATION_OVERLAY_SOURCE.path);
      for(const row of proof.rows)for(const [name,hash]of [['screenshot','screenshot_sha256'],['dom','dom_sha256']])open({path:`${prefix}/${row[name]}`,sha256:row[hash]});
      for(const binding of proof.archived_sources)open({path:`${prefix}/${binding.path}`,sha256:binding.sha256});
      for(const binding of proof.fixture_bindings)open(binding);
      for(const digest of proof.snapshot.object_digests)open({path:`ports/authority-evidence/replay/objects/${digest.slice(0,2)}/${digest}`,sha256:digest});
    }catch(error){failures.push(`Transient navigation source authority unavailable: ${error.message}`);}
  }
  for (const row of audit.records ?? []) {
    const action = row.action_contract_observation;
    if (action?.mode !== 'source-hidden-submit') continue;
    try {
      const document = JSON.parse(open(action.source_authority));
      const baselineAuthority=document.schema==='theme_lab_wikidot_baseline_search_control.v1';
      let sourceUrl,sourceHash;
      if(baselineAuthority){
        const binding=document.target_baseline;
        if(binding?.name!=='Sigma-10'||binding.source_manifest?.path!=='sigma10-migration/source-manifest.json'||binding.css?.path!=='sigma10-migration/sigma10-offline.css'||binding.run_contract_path!=='sigma10-migration/current-campaign/run-contract.json')throw new Error('Noncanonical baseline search authority');
        const sources=JSON.parse(open(binding.source_manifest)),contract=read(binding.run_contract_path),source=sources.pages?.['pseudo-scp-jp:sigma-10:main'];
        if(!source||contract.schema!=='scp_jp_sigma10_migration_run.v1'||row.baseline_theme!=='Sigma-10'||row.baseline_theme_mode!=='replacement'||row.target_site!==contract.target_site.slug||row.baseline_theme_css_sha256!==binding.css.sha256||contract.baseline_theme.replacement_css_sha256!==binding.css.sha256)throw new Error('Hidden query authority belongs to another target baseline');
        const baselineCss=open(binding.css).toString('utf8');sourceUrl=source.source_url;sourceHash=source.sha256;
        if(document.source_snapshot?.path!=='sigma10-migration/'+source.file||document.source_snapshot.sha256!==sourceHash)throw new Error('Baseline search source snapshot differs');
        open(document.source_snapshot);
        const names=new Set(baselineCss.match(/[a-f0-9]{64}\.[a-z0-9]+/gu)??[]);
        const supplied=new Map((document.target_css_dependencies??[]).map(dependency=>[dependency.path,dependency]));
        for(const name of names){const assetPath='ports/shared-replay-assets/'+name,dependency=supplied.get(assetPath);if(!dependency||dependency.sha256!==name.slice(0,64))throw new Error('Missing baseline search CSS dependency');const bytes=open(dependency);if(name.endsWith('.css'))for(const nested of bytes.toString('utf8').match(/[a-f0-9]{64}\.[a-z0-9]+/gu)??[])names.add(nested);}
        if(supplied.size!==names.size)throw new Error('Noncanonical baseline search CSS dependencies');
      }else{
        const manifest = read(`ports/${row.theme}/manifest.json`);
        sourceUrl = manifest.source_url ?? manifest.reference_url;
        sourceHash = manifest.source_sha256 ?? manifest.en_source_sha256;
      }
      const source = document.source_measurements?.find(item => item.viewport === row.viewport);
      const hidden = query => query?.display === 'none' || query?.visibility === 'hidden' || query?.width === 0 || query?.height === 0;
      if ((!baselineAuthority&&(document.schema !== 'theme_lab_wikidot_search_control.v1' || document.theme !== row.theme)) ||
          normalize(document.source_url) !== normalize(sourceUrl) || document.source_sha256 !== sourceHash ||
          document.public_writes !== 0 || document.external_requests_sent !== 0 || document.offline !== true ||
          source?.source_sha256 !== sourceHash || source?.original_html_sha256 !== document.original_html_sha256 ||
          source?.loaded?.offline !== true || !(document.measurement_programs?.length >= 1) ||
          JSON.stringify(source?.viewport_size) !== JSON.stringify(row.viewport_size) || !hidden(source?.after_focus) ||
          source?.action_error || source?.navigation !== '/search:site/q/' + encodeURIComponent(source?.after_focus?.value) ||
          !source?.handler?.events?.some(event => event.type === 'submit' && event.fn === source.handler.search) ||
          !document.artifacts?.some(binding => binding.sha256 === document.original_html_sha256) ||
          !document.artifacts?.some(binding => '/o/' + binding.sha256 === document.replay_entry)) {
        throw new Error('Hidden query alternative lacks the matching frozen source action');
      }
      for (const binding of document.artifacts ?? []) open(binding);
      for (const binding of document.measurement_programs ?? []) open(binding);
    } catch (error) {
      failures.push(`${row.theme}/${row.viewport}: hidden query source authority unavailable: ${error.message}`);
    }
  }
  for (const question of plan.visual_questions) {
    const review = audit.semantic_reviews?.[question.id];
    if (!review) continue; // The question validator reports missing reviews.
    try {
      let authorities;
      if (question.theme === 'sigma10-baseline') {
        authorities = Object.values(read('sigma10-migration/source-manifest.json').pages)
          .map(row => ({url: row.source_url, sha256: row.sha256}));
      } else {
        const manifest = read(`ports/${question.theme}/manifest.json`);
        authorities = [{url: manifest.source_url ?? manifest.reference_url,
          sha256: manifest.source_sha256 ?? manifest.en_source_sha256}];
      }
      if (!authorities.some(row => /^[a-f0-9]{64}$/u.test(row.sha256 ?? '') &&
          normalize(row.url) === normalize(review.source_url) && row.sha256 === review.source_snapshot?.sha256)) {
        failures.push(`${question.theme}: visual review does not bind the maintained upstream source authority`);
      }
      for (const rendering of semanticSourceRenderings(question, review)) {
      const binding = rendering.source_rendering_receipt;
      const file = resolveExistingContainedFile(root,binding?.path ?? '','Source rendering receipt');
      const bytes = fs.readFileSync(file);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== binding?.sha256) throw new Error('Stale source rendering receipt');
      const document = JSON.parse(bytes), result = document.result ?? document;
      const identity = result.reference_identity;
      const archivedSource = document.schema === 'theme_lab_wikidot_adaptation_ab.v1' &&
        normalize(document.url) === normalize(review.source_url) && document.public_writes === 0 &&
        document.external_browser_requests === 0 && document.snapshot?.replay_complete === true &&
        /^\/o\/[a-f0-9]{64}$/u.test(document.snapshot?.entry ?? '') &&
        document.rows?.some(row => row.variant === 'without' &&
          row.css_sha256 === crypto.createHash('sha256').update('').digest('hex') &&
          row.width === (audit.records.find(row => row.theme === question.theme && row.viewport === rendering.viewport)?.viewport_size?.width) &&
          row.dom_sha256 === rendering.source_html?.sha256 && row.screenshot_sha256 === rendering.source_rendering?.sha256);
      if (!archivedSource && (normalize(identity?.source_url) !== normalize(review.source_url) ||
          !/^[a-f0-9]{64}$/u.test(identity?.original_html_sha256 ?? '') ||
          identity.original_html_sha256 !== rendering.source_html?.sha256 ||
          !/^\/o\/[a-f0-9]{64}$/u.test(identity?.replay_entry ?? '') ||
          !/^[a-f0-9]{64}$/u.test(identity?.snapshot_sha256 ?? '') || identity.offline !== true ||
          result.visual?.viewports?.[rendering.viewport]?.reference_screenshot_sha256 !== rendering.source_rendering?.sha256)) {
        failures.push(`${question.theme}/${rendering.viewport}: source rendering lacks its exact frozen reference replay provenance`);
      }
      }
    } catch (error) {
      failures.push(`${question.theme}: upstream source authority unavailable: ${error.message}`);
    }
  }
  return failures;
}
