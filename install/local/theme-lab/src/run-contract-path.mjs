import fs from 'node:fs';
import path from 'node:path';

/** Resolve a run-contract path relative to its directory, then Theme Lab root.
 * Both forms are used by maintained contracts. Existing contract-relative
 * paths retain precedence; all accepted paths must stay inside Theme Lab.
 */
export function resolveRunContractPath(themeLabDir, contractDir, relative, label = 'run-contract path') {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  const root = path.resolve(themeLabDir);
  const candidates = [path.resolve(contractDir, relative), path.resolve(root, relative)];
  for (const candidate of [...new Set(candidates)]) {
    if (candidate !== root && !candidate.startsWith(root + path.sep)) continue;
    try {
      fs.accessSync(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  // Output paths may not exist yet. Retain the historical contract-relative
  // destination when neither path base currently contains the artifact.
  const contractCandidate = candidates[0];
  if (contractCandidate === root || contractCandidate.startsWith(root + path.sep)) return contractCandidate;
  throw new Error(`${label} does not resolve to an existing Theme Lab path`);
}
