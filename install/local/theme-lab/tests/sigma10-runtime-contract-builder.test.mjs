import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createDeepwellRuntimeIdentity} from '../src/deepwell-runtime-identity.mjs';
import {validateCurrentSigma10Contract} from '../src/campaign-completion.mjs';
import {frozenCandidateSetSha256} from '../src/publication-candidate-freeze.mjs';
import {VISUAL_GATE_POLICY_SHA256} from '../src/visual-gate.mjs';
import {candidateIdentity} from '../ports/scripts/candidate-identity.mjs';
import {
  SIGMA10_TEMPLATE_RELATIVE,
  SIGMA10_TEMPLATE_SHA256,
  buildSigma10RuntimeContract,
  sigma10CanonicalOutput,
  writeSigma10RuntimeContract,
} from '../src/sigma10-runtime-contract-builder.mjs';

const themeLab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(themeLab, 'scripts/prepare-sigma10-runtime-contract.mjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const identity = createDeepwellRuntimeIdentity({
  source_sha256: '1'.repeat(64),
  ftml_git_revision: '2'.repeat(40),
  container_id: '3'.repeat(64),
  image_id: `sha256:${'4'.repeat(64)}`,
  binary_sha256: '5'.repeat(64),
  config_sha256: '6'.repeat(64),
});
const RUN_ID = 'mock-sigma10-run';
const CANDIDATE_SHA = 'a'.repeat(64);

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
  return file;
}

// A minimal Theme Lab tree. Every frozen artifact is a real file here, and the
// template's bindings are computed from those files, so the completion
// validator can run against it without relying on the production evidence.
function makeMockRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-lab-sigma10-contract-'));
  write(root, 'ports/adaptation-authority.json', JSON.stringify({packages: {
    'alpha-theme': {source_file: 'source.wikidot.txt'},
    'beta-theme': {},
  }}));
  for (const [name, source] of [['alpha-theme', 'source.wikidot.txt'], ['beta-theme', 'candidate.wikidot.source.txt']]) {
    write(root, `ports/${name}/manifest.json`, '{}');
    write(root, `ports/${name}/candidate.css`, `/* ${name} */ body { color: #123; }`);
    write(root, `ports/${name}/${source}`, `[[module CSS]] ${name} source`);
  }
  write(root, 'sigma10-migration/baseline-probe/candidate.css', '/* baseline */');
  write(root, 'sigma10-migration/baseline-probe/candidate.wikidot.source.txt', 'baseline source');
  const baselineCss = write(root, 'sigma10-migration/sigma10-offline.css', '/* mock Sigma-10 baseline */');

  const savedCss = write(root, 'sigma10-migration/current-campaign/saved-credit-component.css', '/* saved credit */');
  const creditSource = write(root, 'ports/authority-evidence/credit-style.txt', 'credit style source');
  const savedCascade = {
    schema: 'theme_lab_saved_credit_cascade.v1',
    order: ['sigma10-baseline-replacement'],
    semantics: 'mock',
    sources: [{identity: 'pseudo-scp-jp:sigma-10:credit:style', path: 'ports/authority-evidence/credit-style.txt', sha256: sha(fs.readFileSync(creditSource))}],
  };
  write(root, 'sigma10-migration/current-campaign/saved-credit-component.json', JSON.stringify({
    schema: 'theme_lab_frozen_component_css.v1',
    css_sha256: sha(fs.readFileSync(savedCss)),
    cascade: savedCascade,
  }));

  const mainSource = write(root, 'sigma10-migration/sources/main.wikidot.txt', 'main source');
  const sourceManifest = write(root, 'sigma10-migration/source-manifest.json', JSON.stringify({pages: {
    'pseudo-scp-jp:sigma-10:main': {file: 'sources/main.wikidot.txt', sha256: sha(fs.readFileSync(mainSource))},
  }}));
  for (const name of ['scp-jp-header.html', 'scp-jp-sidebar.html', 'scp-jp-interwiki.html'])
    write(root, `fixtures/${name}`, `<div>${name}</div>`);

  const fixtures = [['run-owned:sigma10-main', 'main'], ['run-owned:sigma10-nav-top', 'nav-top'], ['run-owned:sigma10-nav-side', 'nav-side']]
    .map(([slug, key]) => {
      const file = `fixtures/run-owned-sigma10-${key}.wikidot.txt`;
      const bytes = `fixture ${key}`;
      write(root, `sigma10-migration/${file}`, bytes);
      return {slug, file, sha256: sha(bytes)};
    });
  write(root, 'sigma10-migration/fixture-manifest.json', JSON.stringify({fixtures}));

  // The maintained policy is the real file, because the completion validator
  // compares it to the exact SHA-256 constant.
  const realPolicy = fs.readFileSync(path.join(themeLab, 'ports/current-acceptance/visual-gate-policy.json'));
  write(root, 'ports/current-acceptance/visual-gate-policy.json', realPolicy);

  // Minimal, internally consistent freeze with no theme nodes. The real
  // validatePublicationCandidateSet still checks its identity and graph binding.
  const frozen = {
    schema: 'mock', generated_at: 'mock', state: 'frozen-before-final-acceptance',
    identity_contract: 'sha256(JSON.stringify({inventory,nodes,edges,attachments,targeted_scenarios,authority}))',
    inventory: {theme_nodes: 0, shared_nodes: 0, total_nodes: 0, edges: 0, attachments: 0},
    nodes: [], edges: [], attachments: [], targeted_scenarios: [], authority: {artifacts: []},
  };
  frozen.candidate_set_sha256 = frozenCandidateSetSha256(frozen);
  write(root, 'publication/frozen-candidate-set.json', JSON.stringify(frozen));
  write(root, 'publication/dependency-graph.json', JSON.stringify({
    candidate_freeze: {state: frozen.state, candidate_set_sha256: frozen.candidate_set_sha256},
    nodes: [], edges: [], targeted_scenarios: [],
  }));

  const realTemplate = JSON.parse(fs.readFileSync(path.join(themeLab, SIGMA10_TEMPLATE_RELATIVE), 'utf8'));
  const template = structuredClone(realTemplate);
  template.baseline_theme.replacement_css_sha256 = sha(fs.readFileSync(baselineCss));
  template.frozen_sigma10_authority = {
    schema: 'theme_lab_frozen_sigma10_authority.v1',
    source_manifest: 'sigma10-migration/source-manifest.json',
    source_manifest_sha256: sha(fs.readFileSync(sourceManifest)),
    artifacts: {
      'sigma10-migration__source-manifest.json': {path: 'sigma10-migration/source-manifest.json', sha256: sha(fs.readFileSync(sourceManifest))},
      'ports__authority-evidence__credit-style.txt': {path: 'ports/authority-evidence/credit-style.txt', sha256: sha(fs.readFileSync(creditSource))},
    },
  };
  template.saved_component_css = {
    path: 'saved-credit-component.css',
    sha256: sha(fs.readFileSync(savedCss)),
    state: 'mock saved cascade',
    cascade: savedCascade,
  };
  template.header_fixture = {path: '../../fixtures/scp-jp-header.html', sha256: sha(fs.readFileSync(path.join(root, 'fixtures/scp-jp-header.html')))};
  template.sidebar_fixture = {path: '../../fixtures/scp-jp-sidebar.html', sha256: sha(fs.readFileSync(path.join(root, 'fixtures/scp-jp-sidebar.html')))};
  template.interwiki_fixture = {path: '../../fixtures/scp-jp-interwiki.html', sha256: sha(fs.readFileSync(path.join(root, 'fixtures/scp-jp-interwiki.html'))), contract: 'mock'};
  template.migration_fixture = {main_slug: fixtures[0].slug, top_slug: fixtures[1].slug, side_slug: fixtures[2].slug};
  // Stale rows, as in the sealed copy. The builder must replace them, not keep them.
  template.current_candidate_inventory = [{package: 'alpha-theme', directory: '../../ports/alpha-theme', candidate_sha256: 'f'.repeat(64), source_sha256: 'e'.repeat(64)}];
  template.additional_candidates = {'alpha-theme': template.current_candidate_inventory[0]};
  const templateBytes = Buffer.from(JSON.stringify(template, null, 2));
  return {root, templateBytes, templateSha256: sha(templateBytes), baselineCss, savedCss, creditSource, fixtures};
}

function build(mock, overrides = {}) {
  return buildSigma10RuntimeContract({
    themeLabRoot: mock.root,
    runId: RUN_ID,
    port: 3396,
    framerailSourceSha: CANDIDATE_SHA,
    backendRuntimeIdentity: identity,
    templateBytes: mock.templateBytes,
    templateSha256: mock.templateSha256,
    validatePublication: () => [],
    ...overrides,
  });
}

test('sealed Sigma-10 template is pinned and its frozen authority still matches the repository bytes', () => {
  const bytes = fs.readFileSync(path.join(themeLab, SIGMA10_TEMPLATE_RELATIVE));
  assert.equal(sha(bytes), SIGMA10_TEMPLATE_SHA256);
  const template = JSON.parse(bytes);
  assert.equal(template.schema, 'scp_jp_sigma10_migration_run.v1');
  assert.equal(template.baseline_theme.name, 'Sigma-10');
  for (const binding of Object.values(template.frozen_sigma10_authority.artifacts))
    assert.equal(sha(fs.readFileSync(path.join(themeLab, binding.path))), binding.sha256, binding.path);
  assert.equal(sha(fs.readFileSync(path.join(themeLab, 'sigma10-migration/current-campaign/saved-credit-component.css'))), template.saved_component_css.sha256);
  assert.equal(VISUAL_GATE_POLICY_SHA256, '3f26c321e2c510d08dc7cf85b1367d882b8f52e5a7b5fe1bc30a9ade6415d1af');
});

test('the default template pin rejects altered bytes before any runtime or candidate is read', () => {
  assert.throws(
    () => buildSigma10RuntimeContract({themeLabRoot: themeLab, runId: RUN_ID, port: 3396, framerailSourceSha: CANDIDATE_SHA,
      backendRuntimeIdentity: identity, templateBytes: Buffer.from('{}')}),
    /sealed Sigma-10 template SHA-256 mismatch/u,
  );
});

test('builds a task contract bound to the measured runtime and to every current candidate', () => {
  const mock = makeMockRoot();
  const result = build(mock);
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
  const contract = result.contract;
  assert.equal(contract.expected_runtime_source_sha256, CANDIDATE_SHA);
  assert.deepEqual(contract.expected_backend_runtime_identity, identity);
  assert.equal(contract.target_site.origin, 'https://scpaiueouiuiuiui.wikijump.localhost:3396');
  assert.equal(contract.artifact_namespace, `migration/sigma10-${RUN_ID}`);
  assert.equal(contract.audit_path, `runs/${RUN_ID}/interactive-visual-audit.json`);
  assert.equal(contract.fixture_contract.identity_manifest, '../fixture-manifest.json');
  assert.equal(contract.visual_gate_policy.sha256, VISUAL_GATE_POLICY_SHA256);
  assert.equal(contract.candidate_set_sha256, JSON.parse(fs.readFileSync(path.join(mock.root, 'publication/frozen-candidate-set.json'))).candidate_set_sha256);

  assert.deepEqual(contract.current_candidate_inventory.map(row => row.package), ['alpha-theme', 'beta-theme', 'sigma10-baseline']);
  const byName = Object.fromEntries(contract.current_candidate_inventory.map(row => [row.package, row]));
  assert.equal(byName['alpha-theme'].directory, '../../ports/alpha-theme');
  assert.equal(byName['sigma10-baseline'].directory, '../baseline-probe');
  const alphaCss = fs.readFileSync(path.join(mock.root, 'ports/alpha-theme/candidate.css'));
  assert.equal(byName['alpha-theme'].candidate_sha256, candidateIdentity(alphaCss, Buffer.alloc(0)).candidateSha);
  assert.notEqual(byName['alpha-theme'].candidate_sha256, 'f'.repeat(64), 'stale sealed rows must be replaced');
  assert.equal(byName['alpha-theme'].source_sha256, sha(fs.readFileSync(path.join(mock.root, 'ports/alpha-theme/source.wikidot.txt'))));
  assert.equal(byName['beta-theme'].source_sha256, sha(fs.readFileSync(path.join(mock.root, 'ports/beta-theme/candidate.wikidot.source.txt'))));
  assert.deepEqual(Object.keys(contract.additional_candidates), ['alpha-theme', 'beta-theme', 'sigma10-baseline']);
  for (const row of contract.current_candidate_inventory)
    assert.deepEqual(contract.additional_candidates[row.package], {directory: row.directory, candidate_sha256: row.candidate_sha256, source_sha256: row.source_sha256});
  assert.deepEqual(result.report.candidates_changed_since_sealed_template.sort(), ['alpha-theme', 'beta-theme', 'sigma10-baseline']);
  assert.equal(result.report.capture_blockers.length, 3, 'manifest-relative fixture files are reported as capture blockers');
});

test('the completion validator accepts the written contract, which is immutable and exclusively created', () => {
  const mock = makeMockRoot();
  const {contract} = build(mock);
  const canonical = sigma10CanonicalOutput(mock.root, RUN_ID);
  const written = writeSigma10RuntimeContract({
    themeLabRoot: mock.root, runId: RUN_ID, output: canonical, contract, validateGate: validateCurrentSigma10Contract,
  });
  assert.equal(written.relative, `sigma10-migration/current-campaign/run-contract-${RUN_ID}.json`);
  assert.equal(fs.statSync(canonical).mode & 0o777, 0o444);
  assert.deepEqual(validateCurrentSigma10Contract(mock.root, written.relative), []);
  assert.throws(
    () => writeSigma10RuntimeContract({themeLabRoot: mock.root, runId: RUN_ID, output: canonical, contract, validateGate: () => []}),
    /EEXIST/u,
  );
  assert.equal(sha(fs.readFileSync(canonical)), written.sha256, 'the existing contract is preserved');
});

test('a write is refused outside the gate-readable path and never replaces the shared contract', () => {
  const mock = makeMockRoot();
  const {contract} = build(mock);
  const shared = path.join(mock.root, 'sigma10-migration/current-campaign/run-contract.json');
  assert.throws(
    () => writeSigma10RuntimeContract({themeLabRoot: mock.root, runId: RUN_ID, output: shared, contract, validateGate: () => []}),
    /--output must be the canonical Sigma-10 task contract/u,
  );
  const elsewhere = path.join(mock.root, 'evidence', `run-contract-${RUN_ID}.json`);
  assert.throws(
    () => writeSigma10RuntimeContract({themeLabRoot: mock.root, runId: RUN_ID, output: elsewhere, contract, validateGate: () => []}),
    /--output must be the canonical/u,
  );
  assert.equal(fs.existsSync(shared), false);
  assert.equal(fs.existsSync(elsewhere), false);
});

test('a contract the completion validator rejects is removed rather than left behind', () => {
  const mock = makeMockRoot();
  const {contract} = build(mock);
  const canonical = sigma10CanonicalOutput(mock.root, RUN_ID);
  assert.throws(
    () => writeSigma10RuntimeContract({themeLabRoot: mock.root, runId: RUN_ID, output: canonical, contract, validateGate: () => ['forced gate failure']}),
    /failed the completion validator and was removed: forced gate failure/u,
  );
  assert.equal(fs.existsSync(canonical), false);
});

test('a stale or changed publication freeze blocks the contract', () => {
  const mock = makeMockRoot();
  const result = build(mock, {validatePublication: () => ['Sigma-10 publication candidate set: candidate CSS SHA differs from the frozen node: theme:basalt']});
  assert.equal(result.ok, false);
  assert.equal(result.contract, null);
  assert.match(result.failures.join('\n'), /candidate CSS SHA differs from the frozen node: theme:basalt/u);
});

test('changed frozen authority or saved Credit evidence is refused, not re-pinned', () => {
  const mock = makeMockRoot();
  fs.writeFileSync(mock.creditSource, 'tampered credit style source');
  const authorityDrift = build(mock);
  assert.equal(authorityDrift.ok, false);
  assert.match(authorityDrift.failures.join('\n'), /Frozen Sigma-10 authority changed: ports\/authority-evidence\/credit-style\.txt|Saved-page Credit source changed/u);

  const other = makeMockRoot();
  fs.writeFileSync(other.savedCss, '/* edited saved css */');
  const savedDrift = build(other);
  assert.equal(savedDrift.ok, false);
  assert.match(savedDrift.failures.join('\n'), /Saved-page Credit CSS differs from its frozen cascade/u);
});

test('a candidate edit is regenerated from current bytes and listed as changed since the sealed template', () => {
  const mock = makeMockRoot();
  const before = build(mock).contract.current_candidate_inventory.find(row => row.package === 'alpha-theme').candidate_sha256;
  fs.writeFileSync(path.join(mock.root, 'ports/alpha-theme/candidate.css'), '/* alpha changed */');
  const result = build(mock);
  const after = result.contract.current_candidate_inventory.find(row => row.package === 'alpha-theme').candidate_sha256;
  assert.notEqual(after, before);
  assert.ok(result.report.candidates_changed_since_sealed_template.includes('alpha-theme'));
});

test('invalid runtime identity, run identity, port or migration fixture drift is refused before building', () => {
  const mock = makeMockRoot();
  assert.throws(() => build(mock, {backendRuntimeIdentity: {...identity, image_id: 'not-an-image'}}), /runtime/u);
  assert.throws(() => build(mock, {framerailSourceSha: 'invalid'}), /expected_runtime_source_sha256/u);
  assert.throws(() => build(mock, {runId: 'Bad_Run'}), /run ID/u);
  for (const port of [80, 3395, 18443]) assert.throws(() => build(mock, {port}), /port/u);
  fs.writeFileSync(path.join(mock.root, 'sigma10-migration/fixtures/run-owned-sigma10-main.wikidot.txt'), 'drifted');
  const drift = build(mock);
  assert.equal(drift.ok, false);
  assert.match(drift.failures.join('\n'), /migration fixture drift: run-owned:sigma10-main/u);
});

test('the command refuses write mode without an explicit canonical --output before any runtime probe', () => {
  const run = args => spawnSync(process.execPath, [script, ...args], {encoding: 'utf8'});
  const base = [`--run-id=${RUN_ID}`, '--port=3396', '--runtime-repo=/nonexistent', `--required-head=${'a'.repeat(40)}`];
  const noOutput = run(base);
  assert.equal(noOutput.status, 1);
  assert.match(noOutput.stderr, /write mode needs an explicit --output/u);
  const wrongOutput = run([...base, '--output=/tmp/not-canonical.json']);
  assert.equal(wrongOutput.status, 1);
  assert.match(wrongOutput.stderr, /--output must be/u);
  const badCheck = run([...base, '--check-only=maybe']);
  assert.equal(badCheck.status, 1);
  assert.match(badCheck.stderr, /check-only must be true or false/u);
});
