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
