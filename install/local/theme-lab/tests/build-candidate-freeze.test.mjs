import {describe, before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildCandidateFreeze, diffValues, main} from '../scripts/build-candidate-freeze.mjs';
import {frozenCandidateSetSha256, validatePublicationCandidateSet} from '../src/publication-candidate-freeze.mjs';

// The 2026-10-06 freeze was made from the bytes at this signed tag, except the
// visual-gate policy, which was tracked later and is checked by its frozen SHA.
// The tag tree holds about 5 GB of raw evidence, so only the files the freeze
// generator and validator read are extracted.
const TAG = '1685a1a976';
const READINESS = 'evidence/audits/theme-lab-candidate-freeze-readiness-final-20261006.json';
const here = path.dirname(fileURLToPath(import.meta.url));
const themeLab = path.resolve(here, '..');
const repo = path.resolve(themeLab, '../../..');
const prefix = 'install/local/theme-lab/';
const WANTED = [
  new RegExp(`^${prefix}publication/`, 'u'),
  new RegExp(`^${prefix}ports/adaptation-authority\\.json$`, 'u'),
  new RegExp(`^${prefix}ports/black-highlighter-theme/option-scenarios/`, 'u'),
  new RegExp(`^${prefix}ports/[^/]+/(candidate\\.css|candidate\\.wikidot\\.source\\.txt)$`, 'u'),
  new RegExp(`^${prefix}ports/[^/]+/page-assets/`, 'u'),
  /^framerail\/(src|static)\//u,
  /^framerail\/(package\.json|server\.js|svelte\.config\.js|tsconfig\.json|vite\.config\.ts)$/u,
];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const tagAvailable = spawnSync('git', ['-C', repo, 'cat-file', '-e', `${TAG}^{commit}`]).status === 0;

function createTagSnapshot() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-lab-candidate-freeze-tag-'));
  try {
    const listed = spawnSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', TAG, '--', 'install/local/theme-lab', 'framerail'],
      {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
    assert.equal(listed.status, 0, listed.stderr);
    const files = listed.stdout.split('\n').filter(file => WANTED.some(pattern => pattern.test(file)));
    const archive = path.join(workspace, 'tag.tar');
    const created = spawnSync('git', ['-C', repo, 'archive', `--output=${archive}`, TAG, '--', ...files], {encoding: 'utf8'});
    assert.equal(created.status, 0, created.stderr);
    const extracted = spawnSync('tar', ['-xf', archive, '-C', workspace], {encoding: 'utf8'});
    assert.equal(extracted.status, 0, extracted.stderr);
    fs.rmSync(archive);
    const root = path.join(workspace, prefix.slice(0, -1));
    const policy = path.join(root, 'ports/current-acceptance/visual-gate-policy.json');
    fs.mkdirSync(path.dirname(policy), {recursive: true});
    fs.copyFileSync(path.join(themeLab, 'ports/current-acceptance/visual-gate-policy.json'), policy);
    const frozen = JSON.parse(fs.readFileSync(path.join(root, 'publication/frozen-candidate-set.json'), 'utf8'));
    assert.equal(sha(fs.readFileSync(policy)), frozen['145_state_visual_gate'].policy_sha256,
      'current visual-gate policy bytes differ from the 2026-10-06 freeze');
    return {workspace, root};
  } catch (error) {
    fs.rmSync(workspace, {recursive: true, force: true});
    throw error;
  }
}

// Edits one file of the snapshot and returns a function that restores it.
function editInPlace(root, relative, edit) {
  const file = path.join(root, relative);
  const original = fs.existsSync(file) ? fs.readFileSync(file) : null;
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, edit(original));
  return () => {
    if (original) fs.writeFileSync(file, original);
    else fs.rmSync(file, {force: true});
  };
}

function restoreAll(restores) {
  for (const restore of restores.reverse()) restore();
}

function captureMain(argv) {
  const lines = [];
  const code = main(argv, {log: line => lines.push(line), error: line => lines.push(line)});
  return {code, text: lines.join('\n')};
}

describe('candidate freeze generator', {skip: tagAvailable ? false : `signed tag ${TAG} is not present in this clone`}, () => {
  let snapshot;

  before(() => {
    snapshot = createTagSnapshot();
  });

  after(() => {
    if (snapshot) fs.rmSync(snapshot.workspace, {recursive: true, force: true});
  });

  test('regenerates the 2026-10-06 freeze and graph byte-for-byte from the tag tree', () => {
    const result = buildCandidateFreeze({root: snapshot.root});
    const committedFrozen = fs.readFileSync(path.join(snapshot.root, 'publication/frozen-candidate-set.json'), 'utf8');
    const committedGraph = fs.readFileSync(path.join(snapshot.root, 'publication/dependency-graph.json'), 'utf8');
    assert.equal(result.frozenText, committedFrozen);
    assert.equal(result.graphText, committedGraph);
    assert.deepEqual(result.findings, []);
    assert.equal(result.candidateSetSha256, JSON.parse(committedFrozen).candidate_set_sha256);
    assert.equal(captureMain(['--check', '--root', snapshot.root]).code, 0);
  });

  test('two runs produce identical files', () => {
    const first = buildCandidateFreeze({root: snapshot.root});
    const second = buildCandidateFreeze({root: snapshot.root});
    assert.equal(first.frozenText, second.frozenText);
    assert.equal(first.graphText, second.graphText);

    const outputs = [1, 2].map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'theme-lab-candidate-freeze-out-')));
    try {
      for (const outputDir of outputs) {
        assert.equal(captureMain(['--write', '--root', snapshot.root, '--output-dir', outputDir]).code, 0);
      }
      for (const file of ['frozen-candidate-set.json', 'dependency-graph.json']) {
        assert.ok(fs.readFileSync(path.join(outputs[0], file)).equals(fs.readFileSync(path.join(outputs[1], file))), file);
      }
    } finally {
      for (const outputDir of outputs) fs.rmSync(outputDir, {recursive: true, force: true});
    }
  });

  test('validatePublicationCandidateSet accepts regenerated output that changes only non-identity fields', () => {
    const committed = fs.readFileSync(path.join(snapshot.root, 'publication/frozen-candidate-set.json'), 'utf8');
    const restores = [];
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-lab-candidate-freeze-out-'));
    try {
      // The identity is unchanged, so a readiness audit bound to it validates again.
      restores.push(editInPlace(snapshot.root, 'publication/evidence/audits/regenerated-readiness-test.json', () =>
        JSON.stringify({freeze_record: {candidate_set_sha256: JSON.parse(committed).candidate_set_sha256}})));
      const written = captureMain(['--write', '--root', snapshot.root, '--output-dir', outputDir,
        '--generated-at', '2026-10-07T00:00:00.000Z', '--readiness-audit', 'evidence/audits/regenerated-readiness-test.json']);
      assert.equal(written.code, 0, written.text);
      assert.notEqual(fs.readFileSync(path.join(outputDir, 'frozen-candidate-set.json'), 'utf8'), committed);
      restores.push(editInPlace(snapshot.root, 'publication/frozen-candidate-set.json', () =>
        fs.readFileSync(path.join(outputDir, 'frozen-candidate-set.json'))));
      restores.push(editInPlace(snapshot.root, 'publication/dependency-graph.json', () =>
        fs.readFileSync(path.join(outputDir, 'dependency-graph.json'))));
      assert.deepEqual(validatePublicationCandidateSet(snapshot.root), []);
    } finally {
      restoreAll(restores);
      fs.rmSync(outputDir, {recursive: true, force: true});
    }
    assert.equal(captureMain(['--check', '--root', snapshot.root]).code, 0, 'snapshot restored to the 2026-10-06 bytes');
  });

  test('a candidate change regenerates an identity that only the BHL evidence and readiness binding reject', () => {
    const restores = [];
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-lab-candidate-freeze-out-'));
    try {
      // A legitimate change to Basalt's candidate CSS, with the adaptation ledger and source audit left stale.
      restores.push(editInPlace(snapshot.root, 'ports/basalt/candidate.css', original => `${original}\n/* regenerated */\n`));
      const stale = buildCandidateFreeze({root: snapshot.root});
      assert.deepEqual([...new Set(stale.findings.map(item => item.code))].sort(),
        ['audit-stale', 'ledger-stale', 'readiness-binding-stale', 'targeted-evidence-stale']);
      assert.equal(frozenCandidateSetSha256(stale.frozen), stale.candidateSetSha256);

      const written = captureMain(['--write', '--root', snapshot.root, '--output-dir', outputDir]);
      assert.equal(written.code, 1);
      restores.push(editInPlace(snapshot.root, 'publication/frozen-candidate-set.json', () =>
        fs.readFileSync(path.join(outputDir, 'frozen-candidate-set.json'))));
      restores.push(editInPlace(snapshot.root, 'publication/dependency-graph.json', () =>
        fs.readFileSync(path.join(outputDir, 'dependency-graph.json'))));
      const failures = validatePublicationCandidateSet(snapshot.root);
      assert.ok(failures.some(failure => failure.includes(`readiness audit does not use the stable candidate-set identity`)), failures.join('\n'));
      assert.ok(failures.some(failure => failure.startsWith('bhl-options-')), failures.join('\n'));
      for (const failure of failures) {
        assert.ok(/^bhl-options-|readiness audit does not use the stable candidate-set identity/u.test(failure), failure);
      }
    } finally {
      restoreAll(restores);
      fs.rmSync(outputDir, {recursive: true, force: true});
    }
    assert.equal(captureMain(['--check', '--root', snapshot.root]).code, 0, 'snapshot restored to the 2026-10-06 bytes');
  });

  test('a changed candidate source without regeneration is rejected by the validator and by --check', () => {
    const restores = [];
    try {
      restores.push(editInPlace(snapshot.root, 'ports/basalt/candidate.wikidot.source.txt', original => `${original}\n[[div]]\n`));
      const check = captureMain(['--check', '--root', snapshot.root]);
      assert.equal(check.code, 1);
      assert.match(check.text, /differs frozen-candidate-set\.json: nodes\[theme:basalt\]\.source_sha256/u);
      assert.match(check.text, /differs dependency-graph\.json: nodes\[theme:basalt\]\.source_sha256/u);
      assert.ok(validatePublicationCandidateSet(snapshot.root).some(failure => failure.includes('publication source SHA differs from the frozen node: theme:basalt')));
    } finally {
      restoreAll(restores);
    }
    assert.equal(captureMain(['--check', '--root', snapshot.root]).code, 0, 'snapshot restored to the 2026-10-06 bytes');
  });

  test('a framerail fingerprint that differs from the expected runtime is a finding', () => {
    const result = buildCandidateFreeze({root: snapshot.root, expectFramerailFingerprint: '0'.repeat(64)});
    assert.deepEqual(result.findings.map(item => item.code), ['expected-framerail-mismatch']);
    assert.equal(captureMain(['--check', '--root', snapshot.root, '--expect-framerail-fingerprint', '0'.repeat(64)]).code, 1);
  });

  test('the committed readiness audit is the one the 2026-10-06 freeze binds', () => {
    const result = buildCandidateFreeze({root: snapshot.root});
    assert.equal(result.frozen.readiness_audit, READINESS);
    assert.equal(result.frozen.readiness_audit_sha256, result.graph.candidate_freeze.readiness_audit_sha256);
  });
});

test('the current checkout produces a self-consistent identity', () => {
  const result = buildCandidateFreeze({root: themeLab});
  assert.equal(frozenCandidateSetSha256(result.frozen), result.candidateSetSha256);
  assert.equal(result.graph.candidate_freeze.candidate_set_sha256, result.candidateSetSha256);
  assert.equal(result.frozen.nodes.length, JSON.parse(result.graphText).nodes.length);
});

test('diffValues labels differing nodes and attachments by identity', () => {
  const before = {nodes: [{id: 'theme:a', source_sha256: 'a'}], attachments: [{node: 'theme:a', filename: 'x.svg', sha256: '1'}]};
  const after = {nodes: [{id: 'theme:a', source_sha256: 'b'}], attachments: [{node: 'theme:a', filename: 'x.svg', sha256: '2'}]};
  assert.deepEqual(diffValues(before, after), ['nodes[theme:a].source_sha256', 'attachments[theme:a/x.svg].sha256']);
});

test('usage errors exit with code 2 without writing', () => {
  assert.equal(captureMain([]).code, 2);
  assert.equal(captureMain(['--check', '--write']).code, 2);
  assert.equal(captureMain(['--check', '--output-dir', os.tmpdir()]).code, 2);
  assert.equal(captureMain(['--check', '--expect-framerail-fingerprint', 'XYZ']).code, 2);
  assert.equal(captureMain(['--check', '--unknown']).code, 2);
});
