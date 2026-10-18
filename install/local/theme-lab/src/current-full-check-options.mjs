import path from 'node:path';

// A current capture must never silently overwrite the sealed 2026-10-07
// artifacts. Give every new run its own, explicit, task-owned namespace.
export function currentFullCheckPaths(labRoot, packageName, runId, runContract) {
  if (!/^[a-z][a-z0-9-]*$/u.test(packageName)) throw new Error('invalid maintained package name');
  if (typeof runId !== 'string' || !/^[a-z][a-z0-9-]{2,55}$/u.test(runId)) {
    throw new Error('a unique --run-id=<lowercase-task-id> is required for a fresh capture');
  }
  const origin = runContract?.target_site?.origin;
  let url;
  try { url = new URL(origin); } catch { throw new Error('current run contract needs an HTTPS fixture origin'); }
  if (url.protocol !== 'https:' || url.hostname !== 'scpaiueouiuiuiui.wikijump.localhost' ||
      !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('current run contract fixture origin must be the task-owned Wikijump HTTPS origin with an explicit port');
  }
  const fixtureUrl = new URL('/run-owned%3Atheme-lab-visual-acceptance-imported-20260924', url).href;
  const runDir = path.join(labRoot, 'ports', 'current-acceptance', packageName, 'runs', runId);
  return {
    fixtureUrl,
    runDir,
    artifactsDir: path.join(runDir, 'artifacts'),
    rawResultPath: path.join(runDir, 'raw-result.json'),
  };
}
