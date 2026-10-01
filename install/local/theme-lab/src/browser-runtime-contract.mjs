import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function runtimeFilesForObservation(surface, viewport) {
  const files = surface === 'dialog.generic'
    ? ['framerail/src/lib/popup/error.svelte', 'framerail/src/routes/[slug]/[...extra]/PageView.svelte', 'framerail/src/lib/wikidot/wikidot-locale.js']
    : surface.startsWith('page.history')
      ? ['framerail/src/routes/[slug]/[...extra]/HistoryPane.svelte', 'framerail/src/lib/wikidot-history-contract.js']
      : surface.startsWith('page.files') ? ['framerail/src/routes/[slug]/[...extra]/FileList.svelte']
        : surface.startsWith('nav.') || surface.startsWith('shell.')
          ? ['framerail/src/lib/sigma-esque/wikidot.svelte', 'framerail/src/routes/+layout.svelte']
          : ['framerail/src/routes/[slug]/[...extra]/PageView.svelte'];
  // Normal-page identity measures the header/login shell as well as article
  // content. Changes to that shell cannot reuse an older normal screenshot.
  if (surface === 'page.normal') files.push('framerail/src/lib/sigma-esque/wikidot.svelte', 'framerail/src/routes/+layout.svelte');
  if (viewport === 'mobile' || viewport === 'narrow-mobile') files.push('framerail/src/lib/sigma-esque/wikidot.svelte');
  if (surface === 'shell.search' && viewport !== 'mobile' && viewport !== 'narrow-mobile') files.push('framerail/src/lib/wikidot/wikidot-search.js');
  return [...new Set(files)];
}

export function runtimeSurfaceContractSha(repoRoot, surface, viewport) {
  const hash = crypto.createHash('sha256');
  for (const file of runtimeFilesForObservation(surface, viewport)) {
    hash.update(file); hash.update('\0'); hash.update(fs.readFileSync(path.join(repoRoot, file)));
  }
  return hash.digest('hex');
}
