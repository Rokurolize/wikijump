import {describe, before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildCandidateFreeze} from '../scripts/build-candidate-freeze.mjs';
import {buildReadinessAudit, main, ReadinessAuditError} from '../scripts/build-readiness-audit.mjs';
import {validatePublicationCandidateSet} from '../src/publication-candidate-freeze.mjs';

// The 2026-10-06 freeze tree is extracted from its signed tag so that the
// readiness generator can be checked against a set that is known to validate.
const TAG = '1685a1a976';
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
const tagAvailable = spawnSync('git', ['-C', repo, 'cat-file', '-e', `${TAG}^{commit}`]).status === 0;
const COMMITTED_SET = '38722848ea1ef40e21014f1fca201bce97ac0248668be1fae763526ab1959c36';
const GENERATED_AT = '2026-10-06T10:30:16.761Z';

function createTagSnapshot() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-lab-readiness-tag-'));
  const listed = spawnSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', TAG, '--', 'install/local/theme-lab', 'framerail'],
    {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
  assert.equal(listed.status, 0, listed.stderr);
  const files = listed.stdout.split('\n').filter(file => WANTED.some(pattern => pattern.test(file)));
  const archive = path.join(workspace, 'tag.tar');
  assert.equal(spawnSync('git', ['-C', repo, 'archive', `--output=${archive}`, TAG, '--', ...files]).status, 0);
  assert.equal(spawnSync('tar', ['-xf', archive, '-C', workspace]).status, 0);
  fs.rmSync(archive);
  const root = path.join(workspace, prefix.slice(0, -1));
  const policy = path.join(root, 'ports/current-acceptance/visual-gate-policy.json');
  fs.mkdirSync(path.dirname(policy), {recursive: true});
  fs.copyFileSync(path.join(themeLab, 'ports/current-acceptance/visual-gate-policy.json'), policy);
  return {workspace, root};
}

describe('candidate freeze readiness audit: refusals on the checkout', () => {
  test('refuses while the candidate inputs have identity findings', () => {
    assert.throws(() => buildReadinessAudit({root: themeLab, generatedAt: '2026-10-23T09:00:00.000Z'}),
      error => error instanceof ReadinessAuditError && /identity findings/u.test(error.message) && /audit-stale theme:basalt/u.test(error.message));
  });

  test('refuses an invalid generated-at', () => {
    assert.throws(() => buildReadinessAudit({root: themeLab, generatedAt: '2026-10-23'}), /ISO-8601 UTC timestamp/u);
    assert.throws(() => buildReadinessAudit({root: themeLab, generatedAt: undefined}), /ISO-8601 UTC timestamp/u);
  });

  test('refuses an unknown final-acceptance key or status before any freeze work', () => {
    assert.throws(() => buildReadinessAudit({root: themeLab, generatedAt: '2026-10-23T09:00:00.000Z', finalAcceptance: {sigma8: 'pending'}}),
      /unknown key: sigma8/u);
    assert.throws(() => buildReadinessAudit({root: themeLab, generatedAt: '2026-10-23T09:00:00.000Z', finalAcceptance: {sigma9: 'approved'}}),
      /must be pending, pass, or fail/u);
  });

  test('CLI usage and refusals exit with code 2 and write nothing', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-refusal-'));
    try {
      const lines = [];
      const capture = {log: line => lines.push(line), error: line => lines.push(line)};
      assert.equal(main([], capture), 2);
      assert.equal(main(['--generated-at', '2026-10-23T09:00:00.000Z'], capture), 2);
      assert.equal(main(['--generated-at', '2026-10-23T09:00:00.000Z', '--output-dir', outputDir, '--bogus', 'x'], capture), 2);
      assert.equal(main(['--generated-at', '2026-10-23T09:00:00.000Z', '--output-dir', outputDir], capture), 2);
      assert.match(lines.join('\n'), /readiness audit refused: candidate inputs have/u);
      assert.deepEqual(fs.readdirSync(outputDir), []);
    } finally {
      fs.rmSync(outputDir, {recursive: true, force: true});
    }
  });
});

describe('candidate freeze readiness audit: the 2026-10-06 tree', {skip: tagAvailable ? false : `signed tag ${TAG} is not present in this clone`}, () => {
  let snapshot;
  before(() => {
    snapshot = createTagSnapshot();
  });
  after(() => {
    if (snapshot) fs.rmSync(snapshot.workspace, {recursive: true, force: true});
  });

  test('binds the regenerated candidate set identity and reproduces the committed one', () => {
    const built = buildReadinessAudit({root: snapshot.root, generatedAt: GENERATED_AT});
    assert.equal(built.candidateSetSha256, COMMITTED_SET);
    assert.equal(built.record.schema, 'theme_lab_candidate_freeze_readiness_audit.v1');
    assert.equal(built.record.freeze_record.candidate_set_sha256, COMMITTED_SET);
    assert.equal(built.record.freeze_record.state, 'frozen-before-final-acceptance');
    assert.deepEqual(built.record.freeze_record.final_acceptance, {sigma9: 'pending', sigma10: 'pending', visual_review: 'pending'});
    assert.equal(Object.hasOwn(built.record.freeze_record, 'manifest_sha256'), false);
    assert.deepEqual(built.pendingEvidence, []);
    assert.equal(built.record.decision, 'ready-for-final-acceptance');
    assert.equal(built.record.counts.total_nodes, 48);
    assert.equal(built.record.counts.theme_nodes, 36);
    assert.equal(built.record.counts.unique_attachment_entries, 50);
    assert.deepEqual(built.record.errors, []);
    assert.equal(built.relative, 'evidence/audits/theme-lab-candidate-freeze-readiness-2026-10-06.json');
  });

  test('never copies the old verdict forward: scope is the generator text and acceptance is pending', () => {
    const built = buildReadinessAudit({root: snapshot.root, generatedAt: GENERATED_AT, finalAcceptance: {sigma9: 'fail'}});
    assert.equal(built.record.freeze_record.final_acceptance.sigma9, 'fail');
    assert.equal(built.record.freeze_record.final_acceptance.sigma10, 'pending');
    assert.notEqual(built.record.scope, undefined);
    assert.equal(built.record.generated_at, GENERATED_AT);
  });

  test('a readiness file written in place validates through build-candidate-freeze and validatePublicationCandidateSet', () => {
    const built = buildReadinessAudit({root: snapshot.root, generatedAt: GENERATED_AT});
    const readinessFile = path.join(snapshot.root, 'publication', built.relative);
    fs.mkdirSync(path.dirname(readinessFile), {recursive: true});
    fs.writeFileSync(readinessFile, built.text);
    const result = buildCandidateFreeze({root: snapshot.root, generatedAt: GENERATED_AT, readinessAudit: built.relative});
    assert.equal(result.candidateSetSha256, COMMITTED_SET);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.validation, []);
    assert.equal(result.frozen.readiness_audit, built.relative);
    assert.equal(result.frozen.readiness_audit_sha256, crypto.createHash('sha256').update(built.text).digest('hex'));
    // The regenerated files can be copied in, and the copy then validates.
    fs.writeFileSync(path.join(snapshot.root, 'publication', 'frozen-candidate-set.json'), result.frozenText);
    fs.writeFileSync(path.join(snapshot.root, 'publication', 'dependency-graph.json'), result.graphText);
    assert.deepEqual(validatePublicationCandidateSet(snapshot.root), []);
  });

  test('a readiness file that binds a different identity is rejected by the validator', () => {
    const built = buildReadinessAudit({root: snapshot.root, generatedAt: GENERATED_AT});
    const forged = JSON.parse(built.text);
    forged.freeze_record.candidate_set_sha256 = '0'.repeat(64);
    const readinessFile = path.join(snapshot.root, 'publication', 'evidence/audits/readiness-forged.json');
    fs.mkdirSync(path.dirname(readinessFile), {recursive: true});
    fs.writeFileSync(readinessFile, `${JSON.stringify(forged, null, 2)}\n`);
    const result = buildCandidateFreeze({root: snapshot.root, generatedAt: GENERATED_AT, readinessAudit: 'evidence/audits/readiness-forged.json'});
    assert.ok(result.findings.some(item => item.code === 'readiness-binding-stale'));
    assert.ok(result.validation.some(failure => failure.includes('readiness audit does not use the stable candidate-set identity')));
  });

  test('CLI writes the record into --output-dir only', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-out-'));
    try {
      const lines = [];
      assert.equal(main(['--root', snapshot.root, '--generated-at', GENERATED_AT, '--output-dir', outputDir],
        {log: line => lines.push(line), error: line => lines.push(line)}), 0);
      const written = fs.readFileSync(path.join(outputDir, 'theme-lab-candidate-freeze-readiness-2026-10-06.json'), 'utf8');
      assert.equal(JSON.parse(written).freeze_record.candidate_set_sha256, COMMITTED_SET);
      assert.match(lines.join('\n'), new RegExp(`candidate_set_sha256 ${COMMITTED_SET}`, 'u'));
    } finally {
      fs.rmSync(outputDir, {recursive: true, force: true});
    }
  });
});
