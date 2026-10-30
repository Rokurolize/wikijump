import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

import {candidateIdentity} from '../ports/scripts/candidate-identity.mjs';
import {candidateAssetDependencyState} from '../src/candidate-asset-dependencies.mjs';
import {CLOSURE_ANCHORS} from '../src/campaign-record-integrity.mjs';
import {createDeepwellRuntimeIdentity} from '../src/deepwell-runtime-identity.mjs';
import {checkPostClosureAcceptance, computeInstrumentProperDigest} from '../src/post-closure-acceptance.mjs';
import {TARGET_ACCEPTANCE_CONTRACT, TARGET_ACCEPTANCE_CONTRACT_SHA256} from '../src/target-acceptance-contract.mjs';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (root, relative, content) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
};
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8'});

const FINGERPRINT = 'f'.repeat(64);
const BACKEND = createDeepwellRuntimeIdentity({
  source_sha256: 'd'.repeat(64), ftml_git_revision: 'f'.repeat(40),
  container_id: 'c'.repeat(64), image_id: `sha256:${'b'.repeat(64)}`,
  binary_sha256: '9'.repeat(64), config_sha256: '8'.repeat(64),
});

// Minimal live + historical fixture for one package (testtheme), with the
// anchor roster overridden to match, production defaults otherwise.
function buildFixture({candidateCss = 'body { color: black; }'} = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-lab-post-closure-'));
  const repo = path.join(workspace, 'repo');
  const root = path.join(repo, 'install/local/theme-lab');
  const historical = path.join(workspace, 'historical');
  for (const base of [root, historical]) {
    write(base, 'ports/adaptation-authority.json', {packages: {testtheme: {}}});
    write(base, 'ports/testtheme/candidate.css', candidateCss);
    write(base, 'ports/testtheme/candidate.wikidot.source.txt', 'Theme source');
    write(base, 'ports/testtheme/candidate.wikidot.txt', 'JP preview');
    write(base, 'ports/testtheme/manifest.json', {reference_url: 'https://scp-wiki.wikidot.com/theme:testtheme'});
    write(base, 'ports/interactive-visual-fixture/runtime-asset-replay.css', '');
    write(base, 'fixtures/scp-jp-sigma9-offline.css', 'baseline');
  }
  write(historical, 'current-campaign-acceptance.json', {
    schema: 'theme_lab_current_campaign_acceptance.v1',
    packages: [{package: 'testtheme', receipt: {path: 'ports/current-acceptance/testtheme/accepted-result.json', sha256: '1'.repeat(64)}}],
  });
  write(root, 'publication/frozen-candidate-set.json', {
    candidate_set_sha256: '2'.repeat(64),
    nodes: [{id: 'theme:testtheme', candidate_css_sha256: digest(candidateCss), source_sha256: digest('Theme source')}],
    authority: {artifacts: []},
  });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'test');
  const anchors = {
    ...CLOSURE_ANCHORS,
    packages: ['testtheme'],
    browserVersions: {chromium: '1.0'},
    sigma9RunContract: {path: 'ports/current-acceptance/run-contract-campaign-20261028-s9.json', sha256: '3'.repeat(64)},
    sigma10RunContract: {path: 'sigma10-migration/current-campaign/run-contract-campaign-20261028-s10b.json', sha256: '4'.repeat(64)},
  };
  const options = {
    base: null, historicalRoot: historical, anchors,
    liveFramerailFingerprint: FINGERPRINT, liveBrowserVersions: {chromium: '1.0'},
    currentSigma10Validator: () => [],
  };
  return {workspace, repo, root, historical, anchors, options};
}

const candidateOf = root => {
  const dir = path.join(root, 'ports/testtheme');
  const css = fs.readFileSync(path.join(dir, 'candidate.css'));
  const source = fs.readFileSync(path.join(dir, 'candidate.wikidot.source.txt'));
  const preview = fs.readFileSync(path.join(dir, 'candidate.wikidot.txt'));
  const asset = candidateAssetDependencyState({
    portsDir: path.join(root, 'ports'), themeDir: dir, runtimeSupportCss: '',
    baselineCss: 'baseline', baseCss: Buffer.alloc(0), candidateCss: css, candidateSource: source,
  }).asset_dependency_sha256;
  return {
    css_sha256: digest(css), source_sha256: digest(source), preview_sha256: digest(preview),
    base_css_sha256: null, structure_sha256: null, asset_dependency_sha256: asset,
    candidate_sha256: candidateIdentity(css, Buffer.alloc(0)).candidateSha,
  };
};

// Add a complete successor entry for the live candidate and commit the
// pre-PR state (without the entry) as the git base.
function addSuccessor(fixture, {candidateOverride = null} = {}) {
  const {root, repo} = fixture;
  // Base commit: the tree before the successor record exists.
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD').trim();
  const candidate = candidateOverride ?? candidateOf(root);
  const binding = (relative, content) => {
    write(root, relative, content);
    return {path: relative, sha256: digest(fs.readFileSync(path.join(root, relative)))};
  };
  const result = {
    verdict: 'pass',
    overall_acceptance: {status: 'pass', port_verdict: 'pass', target_status: 'pass'},
    port_decision: {verdict: 'pass'}, target_acceptance: {status: 'pass'},
    candidate_css_sha256: candidate.css_sha256, candidate_source_sha256: candidate.source_sha256,
    candidate_preview_sha256: candidate.preview_sha256, candidate_base_css_sha256: null,
    target_runtime_identity: {source_sha256: FINGERPRINT, backend_runtime_identity: BACKEND},
    target_acceptance_contract_sha256: TARGET_ACCEPTANCE_CONTRACT_SHA256,
    verification_scope: {mode: 'full', deferred: []},
  };
  const receipt = binding('ports/current-acceptance/testtheme/accepted-result-successor.json', result);
  const audit = binding('ports/current-acceptance/testtheme/browser-audit-successor.json', {
    records: [{candidate_sha256: candidate.candidate_sha256, runtime_source_sha256: FINGERPRINT, backend_runtime_identity: BACKEND, run_contract_sha256: '5'.repeat(64)}],
  });
  const visual = binding('ports/current-acceptance/testtheme/visual-review-successor.json', {
    schema: 'theme_lab_visual_acceptance.v1',
    candidate_css_sha256: candidate.css_sha256, candidate_source_sha256: candidate.source_sha256,
    candidate_preview_sha256: candidate.preview_sha256,
  });
  const contract = binding('ports/current-acceptance/run-contract-successor-s9.json', {
    candidate_set_sha256: '2'.repeat(64), expected_backend_runtime_identity: BACKEND,
  });
  // The fabricated audit record binds the successor contract by exact SHA.
  const auditDoc = JSON.parse(fs.readFileSync(path.join(root, audit.path), 'utf8'));
  auditDoc.records[0].run_contract_sha256 = contract.sha256;
  fs.writeFileSync(path.join(root, audit.path), JSON.stringify(auditDoc));
  audit.sha256 = digest(fs.readFileSync(path.join(root, audit.path)));
  const sigmaContract = binding('sigma10-migration/current-campaign/run-contract-successor-s10.json', {
    current_candidate_inventory: [{package: 'testtheme', candidate_sha256: candidate.candidate_sha256, source_sha256: candidate.source_sha256}],
  });
  const manifestFiles = [receipt, audit, visual].map(item => ({
    relative_path: item.path, sha256: item.sha256, size_bytes: fs.statSync(path.join(root, item.path)).size,
  }));
  const manifest = binding('publication/post-closure-evidence-testtheme.json', {
    schema: 'theme_lab_post_closure_evidence_manifest.v1', files: manifestFiles,
  });
  const entry = {
    package: 'testtheme', successor_id: 'testtheme-successor-1',
    predecessor: {kind: 'closure', receipt_sha256: '1'.repeat(64)},
    candidate, receipt, browser_audit: audit, visual_review: visual,
    run_contract: contract, sigma10_run_contract: sigmaContract, successor_manifest: manifest,
  };
  write(root, 'publication/post-closure-acceptance.json', {schema: 'theme_lab_post_closure_acceptance.v1', entries: [entry]});
  return {base, entry};
}

test('Check 2 requires --base', () => {
  const fixture = buildFixture();
  try {
    const checked = checkPostClosureAcceptance(fixture.root, {...fixture.options, base: null});
    assert.equal(checked.status, 'fail');
    assert.ok(checked.failures.some(failure => failure.includes('--base')));
  } finally { fs.rmSync(fixture.workspace, {recursive: true, force: true}); }
});

test('C7: a candidate change with no successor entry fails Check 2', () => {
  const fixture = buildFixture();
  try {
    git(fixture.repo, 'add', '-A');
    git(fixture.repo, 'commit', '-q', '-m', 'base');
    const base = git(fixture.repo, 'rev-parse', 'HEAD').trim();
    write(fixture.root, 'ports/testtheme/candidate.css', 'body { color: red; }');
    const checked = checkPostClosureAcceptance(fixture.root, {...fixture.options, base});
    assert.equal(checked.status, 'fail');
    assert.ok(checked.failures.some(failure => failure.includes('without a complete successor entry')), checked.failures.join('\n'));
  } finally { fs.rmSync(fixture.workspace, {recursive: true, force: true}); }
});

test('C7: the same change with a complete successor entry passes Check 2', () => {
  const fixture = buildFixture();
  try {
    write(fixture.root, 'ports/testtheme/candidate.css', 'body { color: red; }');
    // The re-frozen living set must contain the changed live node.
    const frozenFile = path.join(fixture.root, 'publication/frozen-candidate-set.json');
    const frozen = JSON.parse(fs.readFileSync(frozenFile, 'utf8'));
    frozen.nodes[0].candidate_css_sha256 = digest('body { color: red; }');
    fs.writeFileSync(frozenFile, JSON.stringify(frozen));
    const {base} = addSuccessor(fixture);
    // addSuccessor committed the base before the entry existed; the change
    // itself was already in that commit, which is fine: change detection
    // compares live inputs to the closure binding, not to git.
    const checked = checkPostClosureAcceptance(fixture.root, {...fixture.options, base});
    assert.equal(checked.status, 'pass', checked.failures.join('\n'));
    assert.equal(checked.changed_packages, 1);
    assert.equal(checked.admitted, 1);
  } finally { fs.rmSync(fixture.workspace, {recursive: true, force: true}); }
});

test('C7: a successor with one stale live binding at admission fails Check 2', () => {
  const fixture = buildFixture();
  try {
    write(fixture.root, 'ports/testtheme/candidate.css', 'body { color: red; }');
    const frozenFile = path.join(fixture.root, 'publication/frozen-candidate-set.json');
    const frozen = JSON.parse(fs.readFileSync(frozenFile, 'utf8'));
    frozen.nodes[0].candidate_css_sha256 = digest('body { color: red; }');
    fs.writeFileSync(frozenFile, JSON.stringify(frozen));
    const stale = {...candidateOf(fixture.root), css_sha256: '6'.repeat(64)};
    const {base} = addSuccessor(fixture, {candidateOverride: stale});
    const checked = checkPostClosureAcceptance(fixture.root, {...fixture.options, base});
    assert.equal(checked.status, 'fail');
  } finally { fs.rmSync(fixture.workspace, {recursive: true, force: true}); }
});

test('C7/C4: a successor entry rewritten after --base fails Check 2', () => {
  const fixture = buildFixture();
  try {
    const {entry} = addSuccessor(fixture);
    // Commit the record with the entry, then rewrite the entry.
    git(fixture.repo, 'add', '-A');
    git(fixture.repo, 'commit', '-q', '-m', 'admit successor');
    const base = git(fixture.repo, 'rev-parse', 'HEAD').trim();
    const recordFile = path.join(fixture.root, 'publication/post-closure-acceptance.json');
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    record.entries[0] = {...entry, successor_id: entry.successor_id, receipt: {path: entry.receipt.path, sha256: '7'.repeat(64)}};
    fs.writeFileSync(recordFile, JSON.stringify(record));
    const checked = checkPostClosureAcceptance(fixture.root, {...fixture.options, base});
    assert.equal(checked.status, 'fail');
    assert.ok(checked.failures.some(failure => failure.includes('rewritten')), checked.failures.join('\n'));
  } finally { fs.rmSync(fixture.workspace, {recursive: true, force: true}); }
});

test('C7/C6: an instrument-proper change fails Check 2', () => {
  const instrumentContract = {
    ...TARGET_ACCEPTANCE_CONTRACT,
    viewport_overflow: {...TARGET_ACCEPTANCE_CONTRACT.viewport_overflow, tolerance_px: 999},
  };
  assert.notEqual(computeInstrumentProperDigest({contract: instrumentContract}), CLOSURE_ANCHORS.targetAcceptanceContractSha256);
  const fixture = buildFixture();
  try {
    git(fixture.repo, 'add', '-A');
    git(fixture.repo, 'commit', '-q', '-m', 'base');
    const base = git(fixture.repo, 'rev-parse', 'HEAD').trim();
    const checked = checkPostClosureAcceptance(fixture.root, {...fixture.options, base, instrumentContract});
    assert.equal(checked.status, 'fail');
    assert.ok(checked.failures.some(failure => failure.includes('instrument drift')), checked.failures.join('\n'));
  } finally { fs.rmSync(fixture.workspace, {recursive: true, force: true}); }
});

test('C7/C6: a runtime-only change passes Check 2', () => {
  const runtimeMovedContract = {
    ...TARGET_ACCEPTANCE_CONTRACT,
    static_inputs: {...TARGET_ACCEPTANCE_CONTRACT.static_inputs, target_page_runtime_sha256: 'a'.repeat(64)},
  };
  assert.equal(computeInstrumentProperDigest({contract: runtimeMovedContract}), CLOSURE_ANCHORS.targetAcceptanceContractSha256);
  const fixture = buildFixture();
  try {
    git(fixture.repo, 'add', '-A');
    git(fixture.repo, 'commit', '-q', '-m', 'base');
    const base = git(fixture.repo, 'rev-parse', 'HEAD').trim();
    const checked = checkPostClosureAcceptance(fixture.root, {
      ...fixture.options, base,
      liveFramerailFingerprint: 'e'.repeat(64), instrumentContract: runtimeMovedContract,
    });
    assert.equal(checked.status, 'pass', checked.failures.join('\n'));
    assert.equal(checked.changed_packages, 0);
  } finally { fs.rmSync(fixture.workspace, {recursive: true, force: true}); }
});

test('C6: the live instrument-proper digest equals the closure anchor on this tree', () => {
  assert.equal(computeInstrumentProperDigest(), 'df8e0b532decad8636fc7d5488c44d6c08e0bdc525a02eae8330c19554487a0a');
});
