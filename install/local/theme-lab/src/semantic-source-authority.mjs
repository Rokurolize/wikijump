import fs from 'node:fs';
import path from 'node:path';
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
    } catch (error) {
      failures.push(`${question.theme}: upstream source authority unavailable: ${error.message}`);
    }
  }
  return failures;
}
