#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  deepwellRuntimeSourceIdentity,
  readRunningDeepwellRuntimeIdentity,
} from '../src/deepwell-runtime-identity.mjs';
import {framerailSourceFingerprintSync} from '../src/framerail-source-fingerprint.mjs';
import {
  buildSigma10RuntimeContract,
  sigma10CanonicalOutput,
  writeSigma10RuntimeContract,
} from '../src/sigma10-runtime-contract-builder.mjs';
import {validateCurrentSigma10Contract} from '../src/campaign-completion.mjs';

// Sigma-10 sibling of prepare-current-runtime-contract.mjs (Sigma-9). It
// measures the task-owned runtime checkout and Deepwell container, then builds
// a task run contract for migration/sigma10-<run-id>. Check-only performs
// read-only git and docker queries and writes nothing.

const themeLabRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'usage: prepare-sigma10-runtime-contract.mjs --runtime-repo=/absolute/checkout --required-head=40-hex-git-commit --run-id=task-identity --port=task-owned-port [--backend-project=wikijump-theme-lab-<namespace>] [--check-only=true] [--output=<canonical sigma10-migration/current-campaign/run-contract-<run-id>.json>]';
const flags = new Map();
for (const value of process.argv.slice(2)) {
  const match = value.match(/^--([a-z-]+)=(.+)$/u);
  if (!match || flags.has(match[1])) throw new Error(`invalid or duplicate option: ${value}\n${usage}`);
  flags.set(match[1], match[2]);
}
const required = ['run-id', 'port', 'runtime-repo', 'required-head'];
const allowed = new Set([...required, 'check-only', 'backend-project', 'output']);
if ([...flags.keys()].some(flag => !allowed.has(flag)) || required.some(flag => !flags.has(flag)))
  throw new Error(usage);
if (flags.has('check-only') && !['true', 'false'].includes(flags.get('check-only')))
  throw new Error('check-only must be true or false');
const checkOnly = flags.get('check-only') === 'true';
if (!checkOnly && !flags.has('output'))
  throw new Error('write mode needs an explicit --output (canonical task contract path); use --check-only=true to measure without writing');
const runId = flags.get('run-id');
const canonicalPath = sigma10CanonicalOutput(themeLabRoot, runId);
if (flags.has('output') && path.resolve(flags.get('output')) !== canonicalPath)
  throw new Error(`--output must be ${canonicalPath}; the completion gate only accepts this path`);
const port = Number(flags.get('port'));
if (!Number.isInteger(port)) throw new Error('port must be an integer');

const runtimeRepo = path.resolve(flags.get('runtime-repo'));
if (runtimeRepo !== flags.get('runtime-repo') || !fs.statSync(runtimeRepo).isDirectory())
  throw new Error('runtime checkout must be an absolute directory');
const requestedHead = flags.get('required-head');
if (!/^[a-f0-9]{40}$/u.test(requestedHead)) throw new Error('required-head must be an exact 40-digit Git commit');
const git = (...args) => execFileSync('git', ['-C', runtimeRepo, ...args], {encoding: 'utf8'}).trim();
if (git('rev-parse', 'HEAD') !== requestedHead)
  throw new Error('running checkout HEAD differs from the explicitly required revision; cannot claim current source');
const status = git('status', '--porcelain=v1', '--untracked-files=no', '--',
  'framerail', 'deepwell', '.cargo', 'locales', 'install/local/deepwell', 'install/common/deepwell');
if (status) throw new Error('running checkout contains modified source inputs; cannot seal a current contract');

const localDeepwell = deepwellRuntimeSourceIdentity(runtimeRepo);
const backendProject = flags.get('backend-project') ?? 'wikijump-local-development';
if (backendProject !== 'wikijump-local-development' && !/^wikijump-theme-lab-[a-z][a-z0-9-]{2,30}$/u.test(backendProject))
  throw new Error('backend Compose project must be task-owned');
const running = readRunningDeepwellRuntimeIdentity(runtimeRepo, {
  composeProject: backendProject,
  containerName: `${backendProject}-deepwell-1`,
});
if (localDeepwell.source_sha256 !== running.identity.source_sha256 || localDeepwell.ftml_git_revision !== running.identity.ftml_git_revision)
  throw new Error('current Deepwell source inputs changed during the runtime identity probe');
const framerailSourceSha = framerailSourceFingerprintSync(runtimeRepo);

const built = buildSigma10RuntimeContract({
  themeLabRoot,
  runId,
  port,
  framerailSourceSha,
  backendRuntimeIdentity: running.identity,
});
const summary = {
  run_id: runId,
  required_git_head: requestedHead,
  backend_project: backendProject,
  contract_path: canonicalPath,
  expected_runtime_source_sha256: framerailSourceSha,
  expected_backend_identity_sha256: running.identity.identity_sha256,
  transport_origin: `https://scpaiueouiuiuiui.wikijump.localhost:${port}`,
  report: built.report,
};
if (!built.ok) {
  console.log(JSON.stringify({status: 'fail', ...summary, failures: built.failures}, null, 2));
  process.exitCode = 1;
} else if (checkOnly) {
  const blockers = built.report.capture_blockers;
  console.log(JSON.stringify({
    status: blockers.length ? 'source-bound-readiness-pass-with-capture-blockers' : 'source-bound-readiness-pass',
    write: false,
    ...summary,
  }, null, 2));
} else {
  const written = writeSigma10RuntimeContract({
    themeLabRoot,
    runId,
    output: flags.get('output'),
    contract: built.contract,
    validateGate: validateCurrentSigma10Contract,
  });
  console.log(JSON.stringify({
    status: 'new-capture-contract-written',
    write: true,
    ...summary,
    contract_sha256: written.sha256,
  }, null, 2));
}
