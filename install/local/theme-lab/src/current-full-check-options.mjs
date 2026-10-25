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

// Which Deepwell the full check authenticates to. The shared development flow
// keeps reading the token from the local-development container and the daemon's
// default loopback RPC port. A task-owned backend has no host ports, so it must
// name its Compose project and an explicit loopback relay to that backend's RPC;
// the shared :2747 endpoint is never accepted for a task project.
const TASK_PROJECT = /^wikijump-theme-lab-[a-z][a-z0-9-]{2,30}$/u;
export function currentFullCheckBackend({ backendProject, rpcUrl } = {}) {
  if (backendProject === undefined && rpcUrl === undefined)
    return { containerName: 'wikijump-local-development-deepwell-1', rpcUrl: null };
  if (backendProject === undefined || rpcUrl === undefined)
    throw new Error('--backend-project and --rpc-url must be supplied together');
  if (!TASK_PROJECT.test(backendProject))
    throw new Error('--backend-project must be a task-owned Theme Lab Compose project');
  let url;
  try { url = new URL(rpcUrl); } catch { throw new Error('--rpc-url must be an absolute loopback URL'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
      !url.port || url.username || url.password || url.pathname !== '/jsonrpc' || url.search || url.hash)
    throw new Error('--rpc-url must be an uncredentialed loopback http://127.0.0.1:PORT/jsonrpc endpoint');
  if (url.port === '2747') throw new Error('--rpc-url must not be the shared development Deepwell port for a task backend');
  return { containerName: `${backendProject}-deepwell-1`, rpcUrl: url.href };
}
