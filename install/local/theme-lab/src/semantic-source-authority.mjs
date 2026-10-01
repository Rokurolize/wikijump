import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {planBrowserAcceptance} from './semantic-browser-acceptance.mjs';

// Opening a hash-bound artifact is necessary but insufficient: a candidate
// source or another theme's source must not impersonate the upstream oracle.
export function validateSemanticSourceAuthority(root, audit) {
  const failures = [];
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const normalize = url => new URL(url).href.replace(/^http:/u, 'https:');
  const opened = new Map();
  const open = binding => {
    const file = path.resolve(root, binding?.path ?? '');
    if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('Source artifact escapes Theme Lab');
    if (!opened.has(file)) {
      const bytes = fs.readFileSync(file);
      opened.set(file, {bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex')});
    }
    const artifact = opened.get(file);
    if (artifact.sha256 !== binding?.sha256) throw new Error('Stale source action artifact');
    return artifact.bytes;
  };
  for (const row of audit.records ?? []) {
    const action = row.action_contract_observation;
    if (action?.mode !== 'source-hidden-submit') continue;
    try {
      const document = JSON.parse(open(action.source_authority));
      const manifest = read(`ports/${row.theme}/manifest.json`);
      const sourceUrl = manifest.source_url ?? manifest.reference_url;
      const sourceHash = manifest.source_sha256 ?? manifest.en_source_sha256;
      const source = document.source_measurements?.find(item => item.viewport === row.viewport);
      const hidden = query => query?.display === 'none' || query?.visibility === 'hidden' || query?.width === 0 || query?.height === 0;
      if (document.schema !== 'theme_lab_wikidot_search_control.v1' || document.theme !== row.theme ||
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
  for (const question of planBrowserAcceptance(audit).visual_questions) {
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
      const binding = review.source_rendering_receipt;
      const file = path.resolve(root, binding?.path ?? '');
      if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('Source rendering receipt escapes Theme Lab');
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
          row.dom_sha256 === review.source_html?.sha256 && row.screenshot_sha256 === review.source_rendering?.sha256);
      if (!archivedSource && (normalize(identity?.source_url) !== normalize(review.source_url) ||
          !/^[a-f0-9]{64}$/u.test(identity?.original_html_sha256 ?? '') ||
          identity.original_html_sha256 !== review.source_html?.sha256 ||
          !/^\/o\/[a-f0-9]{64}$/u.test(identity?.replay_entry ?? '') ||
          !/^[a-f0-9]{64}$/u.test(identity?.snapshot_sha256 ?? '') || identity.offline !== true ||
          !Object.values(result.visual?.viewports ?? {}).some(row => row.reference_screenshot_sha256 === review.source_rendering?.sha256))) {
        failures.push(`${question.theme}: source rendering lacks its exact frozen reference replay provenance`);
      }
    } catch (error) {
      failures.push(`${question.theme}: upstream source authority unavailable: ${error.message}`);
    }
  }
  return failures;
}
