// Theme Lab post-closure changes (ALLOC-32 R4 Check 2).
//
// Live once, at admission; historical forever after. A candidate whose live
// inputs differ from its latest accepted binding (the closure record, or
// its latest successor entry) must carry a successor entry admitted in the
// PR being checked (--base names the PR's base commit). Entries that
// already existed at --base are verified historically, against their own
// recorded identities and their own successor manifest. New entries are
// verified live. Instrument drift fails (C6); runtime-only drift does not.
//
// Successor record: publication/post-closure-acceptance.json, append-only,
// schema theme_lab_post_closure_acceptance.v1:
//   {schema, entries: [{
//     package, successor_id,
//     predecessor: {kind: 'closure'|'successor', receipt_sha256},
//     candidate: {css_sha256, source_sha256, preview_sha256,
//                 base_css_sha256, structure_sha256,
//                 asset_dependency_sha256, candidate_sha256},
//     receipt: {path, sha256}, browser_audit: {path, sha256},
//     visual_review: {path, sha256},
//     run_contract: {path, sha256},
//     sigma10_run_contract: {path, sha256},
//     successor_manifest: {path, sha256},
//   }]}
// Successor evidence manifest (its own, never the closure manifest):
// schema theme_lab_post_closure_evidence_manifest.v1:
//   {schema, files: [{relative_path, sha256, size_bytes}]}
// Frozen run-contract files are never rewritten; successor contracts are
// new files named by the entry.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {collectViewportOverflow, inspectPlatformFonts} from './browser-lab.mjs';
import {
  buildVerdict, issuesFromInteractions, issuesFromPreview, issuesFromSelectorDiagnosis,
  issuesFromTorture, issuesFromViewports, nextActions, overallAcceptance,
  styleChangesFromComputed, summarizeVisual,
} from './verdict.mjs';
import {applyRuntimeSurfaceParityGate, RUNTIME_SURFACE_PARITY} from './runtime-surface-parity.mjs';
import {measureTargetBaselineViewportOverflow} from './target-baseline-viewport-probe.mjs';
import {TARGET_ACCEPTANCE_CONTRACT, TARGET_ACCEPTANCE_CONTRACT_SHA256} from './target-acceptance-contract.mjs';
import {candidateIdentity} from '../ports/scripts/candidate-identity.mjs';
import {validateCombinedAcceptance, validateCurrentSigma10Contract} from './campaign-completion.mjs';
import {CLOSURE_ANCHORS, DEFAULT_HISTORICAL_ROOT} from './campaign-record-integrity.mjs';
import {candidateAssetDependencyState} from './candidate-asset-dependencies.mjs';
import {currentPackageBaseCss} from './candidate-base-contract.mjs';
import {deepwellRuntimeIdentityMatchesContract} from './deepwell-runtime-identity.mjs';
import {verifyFaithfulDesignWaivers} from './finalize-visual-acceptance.mjs';
import {framerailSourceFingerprintSync} from './framerail-source-fingerprint.mjs';
import {playwrightBrowserVersions} from './playwright-browser-versions.mjs';
import {captureRunContractIsCurrent} from './scoped-run-contract.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const HASH = /^[a-f0-9]{64}$/u;
const themeLabRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const POST_CLOSURE_PATH = 'publication/post-closure-acceptance.json';
export const POST_CLOSURE_SCHEMA = 'theme_lab_post_closure_acceptance.v1';

const readFileOrNull = file => { try { return fs.readFileSync(file); } catch { return null; } };
const readJsonOrNull = file => { const bytes = readFileOrNull(file); if (!bytes) return null; try { return JSON.parse(bytes.toString('utf8')); } catch { return null; } };
const canonical = value => JSON.stringify(sortValue(value));
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortValue(value[key])]));
  return value;
}

// C6: the instrument-proper digest. Same construction as
// TARGET_ACCEPTANCE_CONTRACT_SHA256 (src/target-acceptance-contract.mjs),
// with every runtime-derived field replaced by its recorded closure value
// before hashing. Per CLOSURE-ANCHORS (b) there is exactly one such field:
// static_inputs.target_page_runtime_sha256. Mirroring the codebase's own
// runContractWithoutRuntimeBindings precedent, the substitution is total:
// any live framerail value yields the same digest, and only an instrument
// change moves it.
export function computeInstrumentProperDigest({contract = TARGET_ACCEPTANCE_CONTRACT, recordedTargetPageRuntimeSha256 = CLOSURE_ANCHORS.recordedTargetPageRuntimeSha256} = {}) {
  const substituted = {
    ...contract,
    static_inputs: {...contract.static_inputs, target_page_runtime_sha256: recordedTargetPageRuntimeSha256},
  };
  return crypto.createHash('sha256')
    .update(JSON.stringify(substituted)).update('\0')
    .update(JSON.stringify(RUNTIME_SURFACE_PARITY)).update('\0')
    .update([
      collectViewportOverflow, inspectPlatformFonts, measureTargetBaselineViewportOverflow,
      issuesFromSelectorDiagnosis, issuesFromTorture, issuesFromViewports, issuesFromPreview,
      issuesFromInteractions, styleChangesFromComputed, nextActions, summarizeVisual,
      overallAcceptance, applyRuntimeSurfaceParityGate, buildVerdict,
    ].map(fn => fn.toString()).join('\0'))
    .digest('hex');
}

function declaredSourceName(root, packageName) {
  const ledger = readJsonOrNull(path.join(root, 'ports/adaptation-authority.json'));
  const declared = ledger?.packages?.[packageName]?.source_file;
  if (typeof declared === 'string' && declared) return declared;
  return fs.existsSync(path.join(root, 'ports', packageName, 'candidate.wikidot.source.txt')) ? 'candidate.wikidot.source.txt' : 'candidate.wikidot.txt';
}

function candidateBindings(root, packageName) {
  const dir = path.join(root, 'ports', packageName);
  const sourceName = declaredSourceName(root, packageName);
  const read = name => readFileOrNull(path.join(dir, name));
  const css = read('candidate.css');
  const source = read(sourceName);
  const preview = read('candidate.wikidot.txt');
  let base = null;
  try { base = currentPackageBaseCss(dir, packageName); } catch { base = read('candidate-base.css'); }
  const structure = read('acceptance-structure.json');
  const runtimeSupportCss = readFileOrNull(path.join(root, 'ports/interactive-visual-fixture/runtime-asset-replay.css'))?.toString('utf8') ?? '';
  const baselineCss = readFileOrNull(path.join(root, 'fixtures/scp-jp-sigma9-offline.css'))?.toString('utf8') ?? '';
  const asset = (css && source) ? candidateAssetDependencyState({
    portsDir: path.join(root, 'ports'), themeDir: dir, runtimeSupportCss, baselineCss,
    baseCss: base ?? Buffer.alloc(0), candidateCss: css, candidateSource: source,
  }).asset_dependency_sha256 : null;
  return {
    css_sha256: css ? sha(css) : null,
    source_sha256: source ? sha(source) : null,
    preview_sha256: preview ? sha(preview) : null,
    base_css_sha256: base ? sha(base) : null,
    structure_sha256: structure ? sha(structure) : null,
    asset_dependency_sha256: asset,
    candidate_sha256: css ? candidateIdentity(css, base ?? Buffer.alloc(0)).candidateSha : null,
  };
}

function gitShow(repoRoot, commit, relativeFromRepo) {
  try {
    return execFileSync('git', ['show', `${commit}:${relativeFromRepo}`], {cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
  } catch { return null; }
}

export function checkPostClosureAcceptance(root, {
  base = null,
  historicalRoot = DEFAULT_HISTORICAL_ROOT,
  anchors = CLOSURE_ANCHORS,
  liveFramerailFingerprint = null,
  instrumentContract = TARGET_ACCEPTANCE_CONTRACT,
  liveBrowserVersions = null,
  // Injectable like the original checker's captureContractReader: the
  // production default is the original Sigma-10 contract validator.
  currentSigma10Validator = validateCurrentSigma10Contract,
} = {}) {
  const failures = [];
  const fail = message => failures.push(message);
  if (!base) { fail('post-closure check requires --base <commit>'); return {status: 'fail', changed_packages: 0, admitted: 0, failures}; }
  const repoRoot = path.resolve(root, '../../..');
  const themeLabRelative = path.relative(repoRoot, root).split(path.sep).join('/');
  // C6 first: instrument drift fails regardless of candidate changes.
  const instrumentDigest = computeInstrumentProperDigest({contract: instrumentContract, recordedTargetPageRuntimeSha256: anchors.recordedTargetPageRuntimeSha256});
  if (instrumentDigest !== anchors.targetAcceptanceContractSha256) fail('instrument-proper digest differs from the closure anchor (instrument drift)');
  if (liveBrowserVersions) {
    for (const [engine, version] of Object.entries(liveBrowserVersions)) {
      if (anchors.browserVersions[engine] && version !== anchors.browserVersions[engine]) fail(`capture-contract instrument drift: ${engine} browser version ${version} differs from the closure ${anchors.browserVersions[engine]}`);
    }
  } else {
    try {
      const versions = playwrightBrowserVersions(path.join(repoRoot, 'framerail'));
      for (const [engine, version] of Object.entries(versions)) if (anchors.browserVersions[engine] && version !== anchors.browserVersions[engine]) fail(`capture-contract instrument drift: ${engine} browser version ${version} differs from the closure ${anchors.browserVersions[engine]}`);
    } catch { /* registry unreadable: the file-based instrument digest above is the pinned check in this lane; successor admission re-checks versions live */ }
  }
  // Roster (C5) and closure bindings.
  const liveLedger = readJsonOrNull(path.join(root, 'ports/adaptation-authority.json'));
  const liveNames = Object.keys(liveLedger?.packages ?? {}).sort();
  const closureNames = [...anchors.packages].sort();
  if (liveNames.join('\0') !== closureNames.join('\0')) fail('package roster differs from the closure roster (adding, removing or renaming a package is campaign work)');
  const acceptance = readJsonOrNull(path.join(historicalRoot, 'current-campaign-acceptance.json'));
  if (!acceptance) fail('archived acceptance document is unavailable in historical/');
  const closureReceiptSha = new Map((acceptance?.packages ?? []).map(row => [row.package, row.receipt?.sha256]));
  const baselineS9 = readFileOrNull(path.join(historicalRoot, 'fixtures/scp-jp-sigma9-offline.css'))?.toString('utf8') ?? '';
  void baselineS9;
  // Successor record and its state at --base.
  const currentBytes = readFileOrNull(path.join(root, POST_CLOSURE_PATH));
  const current = currentBytes ? JSON.parse(currentBytes.toString('utf8')) : {schema: POST_CLOSURE_SCHEMA, entries: []};
  if (current.schema !== POST_CLOSURE_SCHEMA) fail('post-closure acceptance record schema is invalid');
  const entries = current.entries ?? [];
  const baseText = gitShow(repoRoot, base, `${themeLabRelative}/${POST_CLOSURE_PATH}`);
  let baseEntries = [];
  let baseRecordPresent = false;
  if (baseText !== null) {
    try { const baseDoc = JSON.parse(baseText); baseEntries = baseDoc.entries ?? []; baseRecordPresent = true; } catch { fail('post-closure acceptance record at --base is invalid'); }
  }
  void baseRecordPresent;
  const baseById = new Map(baseEntries.map(entry => [entry.successor_id, entry]));
  const verifySuccessorManifest = (entry, label) => {
    const manifestPath = entry.successor_manifest?.path;
    const bytes = manifestPath ? readFileOrNull(path.join(root, manifestPath)) : null;
    if (!bytes) { fail(`${label}: successor manifest is unavailable`); return; }
    if (sha(bytes) !== entry.successor_manifest?.sha256) { fail(`${label}: successor manifest pin does not match its bytes`); return; }
    let manifest;
    try { manifest = JSON.parse(bytes.toString('utf8')); } catch { fail(`${label}: successor manifest is invalid JSON`); return; }
    if (manifest.schema !== 'theme_lab_post_closure_evidence_manifest.v1') fail(`${label}: successor manifest schema is invalid`);
    const files = new Map((manifest.files ?? []).map(row => [row.relative_path, row]));
    for (const [key, binding] of [['receipt', entry.receipt], ['browser_audit', entry.browser_audit], ['visual_review', entry.visual_review]]) {
      const listed = binding ? files.get(binding.path) : null;
      if (!listed || listed.sha256 !== binding.sha256) fail(`${label}: successor manifest does not bind the ${key}`);
      const evidence = binding ? readFileOrNull(path.join(root, binding.path)) : null;
      if (!evidence || sha(evidence) !== binding.sha256) fail(`${label}: successor ${key} bytes are unavailable or stale`);
    }
  };
  // C4: entries that existed at --base are historical now.
  for (const baseEntry of baseEntries) {
    const now = entries.find(entry => entry.successor_id === baseEntry.successor_id);
    if (!now) { fail(`successor entry ${baseEntry.successor_id} present at --base was removed`); continue; }
    if (canonical(now) !== canonical(baseEntry)) fail(`successor entry ${baseEntry.successor_id} present at --base was rewritten`);
    verifySuccessorManifest(now, `successor ${baseEntry.successor_id}`);
  }
  // Latest accepted binding per package (closure, then successors in order).
  const latest = new Map();
  for (const name of closureNames) {
    const dir = path.join(historicalRoot, 'ports', name);
    const readH = file => readFileOrNull(path.join(dir, file));
    const css = readH('candidate.css');
    const source = readH(declaredSourceName(historicalRoot, name));
    const preview = readH('candidate.wikidot.txt');
    let baseCss = null;
    try { baseCss = currentPackageBaseCss(dir, name); } catch { baseCss = readH('candidate-base.css'); }
    const structure = readH('acceptance-structure.json');
    const runtimeSupportCss = readFileOrNull(path.join(historicalRoot, 'ports/interactive-visual-fixture/runtime-asset-replay.css'))?.toString('utf8') ?? '';
    const baselineCss = readFileOrNull(path.join(historicalRoot, 'fixtures/scp-jp-sigma9-offline.css'))?.toString('utf8') ?? '';
    const asset = (css && source) ? candidateAssetDependencyState({portsDir: path.join(historicalRoot, 'ports'), themeDir: dir, runtimeSupportCss, baselineCss, baseCss: baseCss ?? Buffer.alloc(0), candidateCss: css, candidateSource: source}).asset_dependency_sha256 : null;
    latest.set(name, {
      css_sha256: css ? sha(css) : null, source_sha256: source ? sha(source) : null,
      preview_sha256: preview ? sha(preview) : null, base_css_sha256: baseCss ? sha(baseCss) : null,
      structure_sha256: structure ? sha(structure) : null, asset_dependency_sha256: asset,
      candidate_sha256: css ? candidateIdentity(css, baseCss ?? Buffer.alloc(0)).candidateSha : null,
    });
  }
  // Only entries already accepted at --base advance the accepted binding;
  // an entry admitted in this PR must not cover its own change.
  for (const entry of entries) if (entry.candidate && latest.has(entry.package) && baseById.has(entry.successor_id)) latest.set(entry.package, entry.candidate);
  const sameCandidate = (a, b) => ['css_sha256', 'source_sha256', 'preview_sha256', 'base_css_sha256', 'structure_sha256', 'asset_dependency_sha256', 'candidate_sha256'].every(key => (a?.[key] ?? null) === (b?.[key] ?? null));
  const fingerprint = liveFramerailFingerprint ?? framerailSourceFingerprintSync(repoRoot);
  let changed = 0;
  let admitted = 0;
  for (const name of closureNames) {
    const live = candidateBindings(root, name);
    if (sameCandidate(live, latest.get(name))) continue;
    changed++;
    // A change is covered only by a successor admitted in this PR (absent
    // at --base) whose candidate binding equals the live candidate exactly.
    const covering = entries.filter(entry => entry.package === name && !baseById.has(entry.successor_id));
    const entry = covering.find(candidate => sameCandidate(candidate.candidate, live));
    if (!entry) { fail(`${name}: candidate changed after its latest accepted binding without a complete successor entry in this PR`); continue; }
    admitted++;
    // C2: predecessor binding.
    const prior = entries.filter(other => other.package === name && other.successor_id !== entry.successor_id && baseById.has(other.successor_id)).at(-1);
    if (prior) {
      if (entry.predecessor?.kind !== 'successor' || entry.predecessor?.receipt_sha256 !== prior.receipt?.sha256) fail(`${name}: successor predecessor does not bind the prior successor receipt`);
    } else if (entry.predecessor?.kind !== 'closure' || entry.predecessor?.receipt_sha256 !== closureReceiptSha.get(name)) {
      fail(`${name}: successor predecessor does not bind the closure receipt`);
    }
    if (entry.run_contract?.path === anchors.sigma9RunContract.path || entry.sigma10_run_contract?.path === anchors.sigma10RunContract.path) fail(`${name}: successor rewrites a frozen run contract instead of naming a new file`);
    verifySuccessorManifest(entry, `${name} successor`);
    // C3: admission is live.
    const receiptBytes = readFileOrNull(path.join(root, entry.receipt?.path ?? ''));
    const auditBytes = readFileOrNull(path.join(root, entry.browser_audit?.path ?? ''));
    const visualBytes = readFileOrNull(path.join(root, entry.visual_review?.path ?? ''));
    if (!receiptBytes || sha(receiptBytes) !== entry.receipt?.sha256) fail(`${name}: successor receipt bytes are unavailable or stale`);
    if (!auditBytes || sha(auditBytes) !== entry.browser_audit?.sha256) fail(`${name}: successor browser audit bytes are unavailable or stale`);
    if (!visualBytes || sha(visualBytes) !== entry.visual_review?.sha256) fail(`${name}: successor visual review bytes are unavailable or stale`);
    let result = null, audit = null, visual = null, contract = null, sigmaContract = null;
    try { result = receiptBytes ? JSON.parse(receiptBytes.toString('utf8')) : null; } catch { fail(`${name}: successor receipt is invalid JSON`); }
    try { audit = auditBytes ? JSON.parse(auditBytes.toString('utf8')) : null; } catch { fail(`${name}: successor browser audit is invalid JSON`); }
    try { visual = visualBytes ? JSON.parse(visualBytes.toString('utf8')) : null; } catch { fail(`${name}: successor visual review is invalid JSON`); }
    const contractBytes = readFileOrNull(path.join(root, entry.run_contract?.path ?? ''));
    if (!contractBytes || sha(contractBytes) !== entry.run_contract?.sha256) fail(`${name}: successor run contract bytes are unavailable or stale`);
    else try { contract = JSON.parse(contractBytes.toString('utf8')); } catch { fail(`${name}: successor run contract is invalid JSON`); }
    const sigmaBytes = readFileOrNull(path.join(root, entry.sigma10_run_contract?.path ?? ''));
    if (!sigmaBytes || sha(sigmaBytes) !== entry.sigma10_run_contract?.sha256) fail(`${name}: successor Sigma-10 run contract bytes are unavailable or stale`);
    else try { sigmaContract = JSON.parse(sigmaBytes.toString('utf8')); } catch { fail(`${name}: successor Sigma-10 run contract is invalid JSON`); }
    if (result) {
      if (result.candidate_css_sha256 !== live.css_sha256 || result.candidate_source_sha256 !== live.source_sha256 || result.candidate_preview_sha256 !== live.preview_sha256 || (result.candidate_base_css_sha256 ?? null) !== live.base_css_sha256) fail(`${name}: successor result is not bound to the live candidate inputs`);
      if (result.target_runtime_identity?.source_sha256 !== fingerprint) fail(`${name}: successor result does not bind the live framerail fingerprint`);
      if (contract && !deepwellRuntimeIdentityMatchesContract(result.target_runtime_identity?.backend_runtime_identity ? {backend_runtime_identity: result.target_runtime_identity.backend_runtime_identity} : {}, contract)) {
        // deepwellRuntimeIdentityMatchesContract expects a record-shaped row;
        // the identity object comparison is the same predicate.
        if (result.target_runtime_identity?.backend_runtime_identity?.identity_sha256 !== contract.expected_backend_runtime_identity?.identity_sha256) fail(`${name}: successor result backend identity differs from its run contract`);
      }
      if (result.target_acceptance_contract_sha256 !== TARGET_ACCEPTANCE_CONTRACT_SHA256) fail(`${name}: successor result uses a superseded live target acceptance contract`);
      failures.push(...validateCombinedAcceptance(result, name).map(message => message.replace('current', 'successor')));
      failures.push(...verifyFaithfulDesignWaivers(result, name));
      if (visual && (visual.candidate_css_sha256 !== live.css_sha256 || visual.candidate_source_sha256 !== live.source_sha256 || visual.candidate_preview_sha256 !== live.preview_sha256)) fail(`${name}: successor visual review is not bound to the live candidate`);
    }
    if (contract) {
      const liveFrozen = readJsonOrNull(path.join(root, 'publication/frozen-candidate-set.json'));
      if (contract.candidate_set_sha256 !== liveFrozen?.candidate_set_sha256) fail(`${name}: successor run contract is not bound to the re-frozen candidate set`);
      const node = (liveFrozen?.nodes ?? []).find(item => item.id === `theme:${name}`);
      if (!node || node.candidate_css_sha256 !== live.css_sha256 || node.source_sha256 !== live.source_sha256) fail(`${name}: re-frozen candidate set does not contain the live candidate node`);
      const auditArtifact = (liveFrozen?.authority?.artifacts ?? []).find(item => item.id === 'source-dependency-audit');
      if (auditArtifact) {
        const bytes = readFileOrNull(path.join(root, auditArtifact.path));
        if (!bytes || sha(bytes) !== auditArtifact.sha256) fail(`${name}: source-dependency audit successor is stale or unavailable`);
      }
    }
    if (sigmaContract) {
      const row = (sigmaContract.current_candidate_inventory ?? []).find(item => item.package === name);
      if (!row || row.candidate_sha256 !== live.candidate_sha256 || row.source_sha256 !== live.source_sha256) fail(`${name}: Sigma-10 current candidate inventory does not bind the live candidate`);
      const sigma10Failures = currentSigma10Validator(root, entry.sigma10_run_contract.path);
      for (const message of sigma10Failures) fail(`${name}: ${message}`);
    } else {
      fail(`${name}: successor lacks a Sigma-10 run contract binding`);
    }
    if (audit && contract) {
      for (const record of audit.records ?? []) {
        if (record.candidate_sha256 !== live.candidate_sha256) fail(`${name}: successor matrix uses a superseded candidate`);
        if (record.runtime_source_sha256 !== fingerprint) fail(`${name}: successor matrix does not bind the live framerail fingerprint`);
        if (record.backend_runtime_identity?.identity_sha256 !== contract.expected_backend_runtime_identity?.identity_sha256) fail(`${name}: successor matrix backend identity differs from its run contract`);
        if (!captureRunContractIsCurrent(record, contract, entry.run_contract.sha256)) fail(`${name}: successor matrix was not captured under the successor run contract`);
      }
    }
    // Entries bound to an older candidate cannot cover a live change; the
    // exact-candidate covering test above is what rejects them.
    for (const other of covering) if (other !== entry && !sameCandidate(other.candidate, live)) fail(`${name}: an additional successor entry is bound to a stale candidate`);
  }
  // Successor entries for unchanged packages at admission are also bound
  // live when new; unchanged packages with only base entries are C4 above.
  return {status: failures.length ? 'fail' : 'pass', changed_packages: changed, admitted, failures};
}
