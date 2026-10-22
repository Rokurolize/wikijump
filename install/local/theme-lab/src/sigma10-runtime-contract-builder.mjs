import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {candidateIdentity} from '../ports/scripts/candidate-identity.mjs';
import {currentPackageBaseCss} from './candidate-base-contract.mjs';
import {requireDeepwellRuntimeIdentity} from './deepwell-runtime-identity.mjs';
import {requireRuntimeSourceSha} from './runtime-source-identity.mjs';
import {resolveRunContractPath} from './run-contract-path.mjs';
import {
  resolveExistingContainedDirectory,
  resolveExistingContainedFile,
  resolveExistingPackageDirectory,
  resolveExistingPackageFile,
} from './package-path.mjs';
import {frozenCandidateSetSha256, validatePublicationCandidateSet} from './publication-candidate-freeze.mjs';
import {VISUAL_GATE_POLICY_SHA256} from './visual-gate.mjs';

// Builds a task-owned Sigma-10 migration run contract, the input that
// checkCampaignCompletion and capture-interactive.mjs consume through
// --run-contract. The sealed 2026-10 current-campaign copy is used only as a
// template for the non-candidate fields it already binds. Every value that
// names current source, runtime or candidate identity is measured now, and
// every frozen authority value is verified against its bytes on disk. A
// mismatch fails closed; a frozen value is never re-pinned by hand.

export const SIGMA10_SCHEMA = 'scp_jp_sigma10_migration_run.v1';
export const SIGMA10_CONTRACT_DIRECTORY = 'sigma10-migration/current-campaign';
// Sealed copy e56609...: identical to eccbabe... except for the candidate
// inventory, which this builder regenerates from the current package files.
export const SIGMA10_TEMPLATE_RELATIVE = 'evidence/browser-run-contract-history/e56609adfcedd9b23c3e9290cd1748c9b8eb6a684c032dc84aa251e93d8c8f02.json';
export const SIGMA10_TEMPLATE_SHA256 = 'e56609adfcedd9b23c3e9290cd1748c9b8eb6a684c032dc84aa251e93d8c8f02';
export const SIGMA10_BASELINE = 'sigma10-baseline';
export const SIGMA10_BASELINE_DIRECTORY = 'sigma10-migration/baseline-probe';
export const SIGMA10_FIXTURE_MANIFEST = 'sigma10-migration/fixture-manifest.json';
export const SIGMA10_VISUAL_GATE_POLICY = 'ports/current-acceptance/visual-gate-policy.json';
export const SIGMA10_PUBLICATION_FREEZE = 'publication/frozen-candidate-set.json';
// The capture reads this receipt optionally from the Theme Lab root. Its
// absence is reported, not treated as a contract error.
export const SIGMA10_SEARCH_CONTROL_AUTHORITY = 'evidence/sigma10-baseline-search-controls-20261002/receipt.json';

const RUN_ID = /^[a-z][a-z0-9-]{2,55}$/u;
const ENGINES = ['chromium', 'firefox', 'webkit'];
const FORBIDDEN_PORTS = new Set([3395, 18443]);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const posix = value => value.split(path.sep).join('/');

export function sigma10CanonicalOutput(themeLabRoot, runId) {
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) throw new Error('run ID must be an isolated lowercase task ID');
  return path.join(path.resolve(themeLabRoot), SIGMA10_CONTRACT_DIRECTORY, `run-contract-${runId}.json`);
}

function requirePort(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || FORBIDDEN_PORTS.has(port))
    throw new Error('capture port must be a unique task-owned TCP port');
}

function optionalBytes(directory, file, label) {
  try { return fs.readFileSync(resolveExistingPackageFile(directory, file, label)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function candidateRow(root, contractDirectory, ledger, name) {
  const directory = name === SIGMA10_BASELINE
    ? resolveExistingContainedDirectory(root, SIGMA10_BASELINE_DIRECTORY, 'Sigma-10 baseline directory')
    : resolveExistingPackageDirectory(path.join(root, 'ports'), name, `${name}: package directory`);
  const base = (name === SIGMA10_BASELINE
    ? optionalBytes(directory, 'candidate-base.css', `${name}: Sigma-10 base CSS`)
    : currentPackageBaseCss(directory, name)) ?? Buffer.alloc(0);
  const css = fs.readFileSync(resolveExistingPackageFile(directory, 'candidate.css', `${name}: Sigma-10 candidate CSS`));
  // Mirrors validateCurrentSigma10Contract exactly: a declared ledger source is
  // mandatory; otherwise the preview source name is tried as a fallback.
  const declared = ledger.packages[name]?.source_file;
  const sourceFile = declared ?? 'candidate.wikidot.source.txt';
  let source;
  try {
    source = fs.readFileSync(resolveExistingPackageFile(directory, sourceFile, `${name}: Sigma-10 source file`));
  } catch (error) {
    if (declared) throw error;
    source = fs.readFileSync(resolveExistingPackageFile(directory, 'candidate.wikidot.txt', `${name}: Sigma-10 preview source`));
  }
  return {
    package: name,
    directory: posix(path.relative(contractDirectory, directory)),
    candidate_sha256: candidateIdentity(css, base).candidateSha,
    source_sha256: sha(source),
  };
}

function verifyFrozenAuthority(root, frozen, failures) {
  let verified = 0;
  for (const [key, binding] of Object.entries(frozen?.artifacts ?? {})) {
    try {
      const bytes = fs.readFileSync(resolveExistingContainedFile(root, binding.path, `Frozen Sigma-10 authority ${key}`));
      if (sha(bytes) !== binding.sha256) failures.push(`Frozen Sigma-10 authority changed: ${binding.path}`);
      else verified += 1;
    } catch (error) {
      failures.push(`Frozen Sigma-10 authority is unavailable: ${binding.path}: ${error.message}`);
    }
  }
  try {
    const manifestBytes = fs.readFileSync(resolveExistingContainedFile(root, frozen.source_manifest, 'Frozen Sigma-10 source manifest'));
    if (sha(manifestBytes) !== frozen.source_manifest_sha256) failures.push('Frozen Sigma-10 source manifest changed');
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    for (const [identity, page] of Object.entries(manifest.pages ?? {})) {
      try {
        const bytes = fs.readFileSync(resolveExistingContainedFile(root, page.file, `Frozen Sigma-10 source ${identity}`, path.join(root, 'sigma10-migration')));
        if (sha(bytes) !== page.sha256) failures.push(`Frozen Sigma-10 source changed: ${identity}`);
        else verified += 1;
      } catch (error) {
        failures.push(`Frozen Sigma-10 source is unavailable: ${identity}: ${error.message}`);
      }
    }
  } catch (error) {
    failures.push(`Frozen Sigma-10 source manifest is invalid: ${error.message}`);
  }
  return verified;
}

function verifySavedComponent(root, template, failures) {
  const saved_template = template.saved_component_css;
  const savedFile = path.join(root, SIGMA10_CONTRACT_DIRECTORY, 'saved-credit-component.json');
  const cssFile = path.join(root, SIGMA10_CONTRACT_DIRECTORY, saved_template.path);
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(resolveExistingContainedFile(root, posix(path.relative(root, savedFile)), 'Saved Credit cascade')).toString('utf8'));
    const css = fs.readFileSync(resolveExistingContainedFile(root, posix(path.relative(root, cssFile)), 'Saved Credit CSS'));
    if (saved.schema !== 'theme_lab_frozen_component_css.v1') failures.push('Saved-page Credit cascade schema is invalid');
    if (sha(css) !== saved.css_sha256) failures.push('Saved-page Credit CSS differs from its frozen cascade');
    if (saved.css_sha256 !== saved_template.sha256) failures.push('Saved-page Credit CSS differs from the sealed Sigma-10 template');
    if (JSON.stringify(saved.cascade) !== JSON.stringify(saved_template.cascade)) failures.push('Saved-page Credit cascade differs from the sealed Sigma-10 template');
    for (const source of saved.cascade?.sources ?? []) {
      const bytes = fs.readFileSync(resolveExistingContainedFile(root, source.path, `Saved-page Credit source ${source.identity}`));
      if (sha(bytes) !== source.sha256) failures.push(`Saved-page Credit source changed: ${source.identity}`);
    }
  } catch (error) {
    failures.push(`Saved-page Credit authority is unavailable: ${error.message}`);
    return null;
  }
  return {path: saved_template.path, sha256: saved.css_sha256, state: saved_template.state, cascade: saved.cascade};
}

function verifyContractRelativeBinding(root, contractDirectory, relative, expectedSha, label, failures) {
  try {
    const file = resolveRunContractPath(root, contractDirectory, relative, label);
    if (sha(fs.readFileSync(file)) !== expectedSha) failures.push(`${label} differs from the sealed Sigma-10 template: ${relative}`);
  } catch (error) {
    failures.push(`${label} is unavailable: ${relative}: ${error.message}`);
  }
}

// Mirrors the capture's resolution order for a path written in a manifest:
// the manifest's directory, then Theme Lab root. A miss is reported as a
// capture blocker, because the contract itself is valid.
function captureResolves(root, baseDirectory, relative) {
  for (const base of [baseDirectory, root]) {
    try { fs.accessSync(path.resolve(base, relative)); return true; }
    catch { /* try the next base */ }
  }
  return false;
}

/**
 * Builds the Sigma-10 task contract in memory. Returns {ok, failures, contract,
 * report}. A contract is returned only when ok is true, so callers cannot write
 * a contract after a failed check. Pure apart from reading the Theme Lab tree.
 */
export function buildSigma10RuntimeContract({
  themeLabRoot,
  runId,
  port,
  framerailSourceSha,
  backendRuntimeIdentity,
  templateBytes,
  templateSha256 = SIGMA10_TEMPLATE_SHA256,
  validatePublication = validatePublicationCandidateSet,
}) {
  sigma10CanonicalOutput(themeLabRoot, runId);
  requirePort(port);
  requireRuntimeSourceSha(framerailSourceSha, 'current measured Framerail source');
  requireDeepwellRuntimeIdentity(backendRuntimeIdentity, 'current measured Deepwell runtime');
  const root = fs.realpathSync(path.resolve(themeLabRoot));
  const contractDirectory = path.join(root, SIGMA10_CONTRACT_DIRECTORY);
  const failures = [];

  const templateFile = path.join(root, SIGMA10_TEMPLATE_RELATIVE);
  const bytes = templateBytes ?? fs.readFileSync(templateFile);
  if (sha(bytes) !== templateSha256) throw new Error(`sealed Sigma-10 template SHA-256 mismatch: ${sha(bytes)}`);
  const template = JSON.parse(bytes.toString('utf8'));
  if (template.schema !== SIGMA10_SCHEMA || template.baseline_theme?.name !== 'Sigma-10' ||
      template.target_site?.slug !== 'scpaiueouiuiuiui' || !ENGINES.every(engine => template.browser_engines?.includes(engine)))
    throw new Error('template is not the sealed Sigma-10 migration run contract');

  const ledger = JSON.parse(fs.readFileSync(resolveExistingContainedFile(root, 'ports/adaptation-authority.json', 'adaptation authority ledger'), 'utf8'));
  const names = [...Object.keys(ledger.packages), SIGMA10_BASELINE].sort();
  const inventory = [];
  for (const name of names) {
    try { inventory.push(candidateRow(root, contractDirectory, ledger, name)); }
    catch (error) { failures.push(`${name}: cannot bind current Sigma-10 candidate: ${error.message}`); }
  }

  const frozenAuthorityVerified = verifyFrozenAuthority(root, template.frozen_sigma10_authority, failures);
  const saved = verifySavedComponent(root, template, failures);
  verifyContractRelativeBinding(root, contractDirectory, template.baseline_theme.replacement_css_path,
    template.baseline_theme.replacement_css_sha256, 'Sigma-10 baseline replacement CSS', failures);
  for (const key of ['header_fixture', 'sidebar_fixture', 'interwiki_fixture'])
    verifyContractRelativeBinding(root, contractDirectory, template[key].path, template[key].sha256, `${key}`, failures);

  let visualGatePolicy = null;
  try {
    const policyBytes = fs.readFileSync(resolveExistingContainedFile(root, SIGMA10_VISUAL_GATE_POLICY, 'visual gate policy'));
    if (sha(policyBytes) !== VISUAL_GATE_POLICY_SHA256) failures.push('maintained 145-state visual gate policy differs from its SHA-256');
    visualGatePolicy = {path: posix(path.relative(contractDirectory, path.join(root, SIGMA10_VISUAL_GATE_POLICY))), sha256: VISUAL_GATE_POLICY_SHA256};
  } catch (error) {
    failures.push(`visual gate policy is unavailable: ${error.message}`);
  }

  const fixtureManifestBytes = fs.readFileSync(resolveExistingContainedFile(root, SIGMA10_FIXTURE_MANIFEST, 'Sigma-10 fixture manifest'));
  const fixtureManifest = JSON.parse(fixtureManifestBytes.toString('utf8'));
  const migrationDirectory = path.join(root, 'sigma10-migration');
  const captureBlockers = [];
  for (const slug of Object.values(template.migration_fixture)) {
    const fixture = fixtureManifest.fixtures?.find(item => item.slug === slug);
    if (!fixture) { failures.push(`migration fixture is absent from manifest: ${slug}`); continue; }
    try {
      const fixtureBytes = fs.readFileSync(resolveExistingContainedFile(root, fixture.file, `migration fixture ${slug}`, migrationDirectory));
      if (sha(fixtureBytes) !== fixture.sha256) failures.push(`migration fixture drift: ${slug}`);
    } catch (error) {
      failures.push(`migration fixture is unavailable: ${slug}: ${error.message}`);
    }
    // The manifest's file values are relative to sigma10-migration/, the
    // manifest's own directory. The capture resolves them from that directory.
    if (!captureResolves(root, migrationDirectory, fixture.file))
      captureBlockers.push(`capture-interactive.mjs cannot resolve migration fixture ${slug} file "${fixture.file}" from the manifest directory (sigma10-migration/) or Theme Lab root`);
  }
  if (!captureResolves(root, contractDirectory, '../fixture-manifest.json'))
    captureBlockers.push('identity manifest ../fixture-manifest.json is not resolvable');

  let candidateSetSha256 = null;
  try {
    const freezeBytes = fs.readFileSync(resolveExistingContainedFile(root, SIGMA10_PUBLICATION_FREEZE, 'Frozen publication candidate set'));
    const freeze = JSON.parse(freezeBytes.toString('utf8'));
    if (frozenCandidateSetSha256(freeze) !== freeze.candidate_set_sha256) failures.push('frozen candidate-set identity does not match its canonical content');
    candidateSetSha256 = freeze.candidate_set_sha256;
  } catch (error) {
    failures.push(`frozen publication candidate set is unavailable: ${error.message}`);
  }

  const contract = structuredClone(template);
  contract.expected_runtime_source_sha256 = framerailSourceSha;
  contract.expected_backend_runtime_identity = structuredClone(backendRuntimeIdentity);
  contract.target_site = {...template.target_site, origin: `https://scpaiueouiuiuiui.wikijump.localhost:${port}`};
  // The sealed template's identity manifest was written from sigma10-migration/.
  // From current-campaign/ the same file is ../fixture-manifest.json.
  contract.fixture_contract = {...template.fixture_contract, identity_manifest: '../fixture-manifest.json'};
  contract.artifact_namespace = `migration/sigma10-${runId}`;
  contract.audit_path = `runs/${runId}/interactive-visual-audit.json`;
  contract.additional_candidates = Object.fromEntries(inventory.map(({package: name, directory, candidate_sha256, source_sha256}) =>
    [name, {directory, candidate_sha256, source_sha256}]));
  contract.current_candidate_inventory = inventory;
  if (saved) contract.saved_component_css = saved;
  if (visualGatePolicy) contract.visual_gate_policy = visualGatePolicy;
  if (candidateSetSha256) contract.candidate_set_sha256 = candidateSetSha256;

  if (candidateSetSha256) {
    // Publication freeze validation runs on the in-memory draft, so a stale
    // candidate or freeze makes the builder refuse before any file exists.
    // Identity scope: targeted BHL evidence is captured on a runtime that needs
    // this contract. The completion gate still validates in full.
    contract.candidate_set_validation = 'identity';
    failures.push(...validatePublication(root, {
      expectedCandidateSetSha256: candidateSetSha256,
      contract,
      label: 'Sigma-10 publication candidate set',
      scope: 'identity',
    }));
  }

  const sealedInventory = new Map((template.current_candidate_inventory ?? []).map(row => [row.package, row]));
  const changedSinceSealedTemplate = inventory
    .filter(row => {
      const sealed = sealedInventory.get(row.package);
      return !sealed || sealed.candidate_sha256 !== row.candidate_sha256 || sealed.source_sha256 !== row.source_sha256;
    })
    .map(row => row.package);
  const searchPath = path.join(root, SIGMA10_SEARCH_CONTROL_AUTHORITY);
  const report = {
    candidate_count: inventory.length,
    candidate_set_sha256: candidateSetSha256,
    frozen_authority_items_verified: frozenAuthorityVerified,
    candidates_changed_since_sealed_template: changedSinceSealedTemplate,
    search_control_authority: {
      path: SIGMA10_SEARCH_CONTROL_AUTHORITY,
      present: fs.existsSync(searchPath),
    },
    capture_blockers: captureBlockers,
  };
  const ok = failures.length === 0;
  return {ok, failures, contract: ok ? contract : null, report};
}

/**
 * Writes the immutable contract with exclusive creation. The output must be the
 * canonical gate-readable location for this run ID. The completed file is
 * checked by the Sigma-10 completion validator, and removed if that check fails.
 */
export function writeSigma10RuntimeContract({
  themeLabRoot,
  runId,
  output,
  contract,
  validateGate,
}) {
  const root = fs.realpathSync(path.resolve(themeLabRoot));
  const canonical = sigma10CanonicalOutput(root, runId);
  if (!output || path.resolve(output) !== canonical)
    throw new Error(`--output must be the canonical Sigma-10 task contract ${canonical}`);
  const relative = posix(path.relative(root, canonical));
  const fd = fs.openSync(canonical, 'wx', 0o444);
  try {
    fs.writeSync(fd, JSON.stringify(contract, null, 2) + '\n');
  } finally {
    fs.closeSync(fd);
  }
  const failures = validateGate(root, relative);
  if (failures.length) {
    fs.unlinkSync(canonical);
    throw new Error(`written Sigma-10 contract failed the completion validator and was removed: ${failures.join('; ')}`);
  }
  return {path: canonical, relative, sha256: sha(fs.readFileSync(canonical))};
}
