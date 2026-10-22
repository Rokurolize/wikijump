import {describe, before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDeepwellRuntimeIdentity} from '../src/deepwell-runtime-identity.mjs';
import {prepareCurrentRuntimeContract} from '../src/current-runtime-contract-builder.mjs';
import {validatePublicationCandidateSet} from '../src/publication-candidate-freeze.mjs';

// Identity scope and full scope are checked on the 2026-10-06 tree, which is
// extracted from its signed tag. Targeted evidence is removed or edited in the
// extracted copy only.
const TAG = '1685a1a976';
const COMMITTED_SET = '38722848ea1ef40e21014f1fca201bce97ac0248668be1fae763526ab1959c36';
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
const BHL_RUNS = 'ports/black-highlighter-theme/option-scenarios/runs';
const TARGETED_RECEIPT = `${BHL_RUNS}/combined-sigma9-chromium.json`;
const TARGETED_REVIEW = `${BHL_RUNS}/visual-review.json`;
const ZERO = '0'.repeat(64);

function createTagSnapshot() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-lab-scope-tag-'));
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

// Runs body with the file changed, then restores the original bytes.
function withEdit(file, transform, body) {
  const original = fs.readFileSync(file);
  fs.writeFileSync(file, transform(original));
  try {
    return body();
  } finally {
    fs.writeFileSync(file, original);
  }
}

function editJson(_label, edit) {
  return text => {
    const document = JSON.parse(text.toString('utf8'));
    edit(document);
    return Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
  };
}

// Runs body with the directory removed, then restores it.
function withoutDirectory(directory, body) {
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-lab-scope-backup-'));
  fs.cpSync(directory, path.join(backup, 'copy'), {recursive: true});
  fs.rmSync(directory, {recursive: true, force: true});
  try {
    return body();
  } finally {
    fs.cpSync(path.join(backup, 'copy'), directory, {recursive: true});
    fs.rmSync(backup, {recursive: true, force: true});
  }
}

describe('candidate-set validation scopes', {skip: tagAvailable ? false : `signed tag ${TAG} is not present in this clone`}, () => {
  let snapshot;
  const at = relative => path.join(snapshot.root, relative);

  before(() => {
    snapshot = createTagSnapshot();
  });
  after(() => {
    if (snapshot) fs.rmSync(snapshot.workspace, {recursive: true, force: true});
  });

  test('the tag tree validates in both scopes', () => {
    assert.deepEqual(validatePublicationCandidateSet(snapshot.root, {scope: 'identity'}), []);
    assert.deepEqual(validatePublicationCandidateSet(snapshot.root), []);
    assert.deepEqual(validatePublicationCandidateSet(snapshot.root, {scope: 'full'}), []);
  });

  test('an unknown scope is refused rather than treated as full or identity', () => {
    assert.throws(() => validatePublicationCandidateSet(snapshot.root, {scope: 'partial'}), /unknown candidate-set validation scope: partial/u);
  });

  test('identity scope passes when only the targeted receipts are missing', () => {
    withEdit(at(TARGETED_RECEIPT), () => Buffer.alloc(0), () => {
      // The receipt is present but empty; the targeted section would fail, identity does not read it.
      assert.deepEqual(validatePublicationCandidateSet(snapshot.root, {scope: 'identity'}), []);
      assert.ok(validatePublicationCandidateSet(snapshot.root).length > 0);
    });
  });

  test('identity scope passes when every targeted receipt and the visual review are missing', () => {
    withoutDirectory(at(BHL_RUNS), () => {
      assert.deepEqual(validatePublicationCandidateSet(snapshot.root, {scope: 'identity'}), []);
    });
  });

  test('full scope still fails when the targeted evidence is missing', () => {
    withoutDirectory(at(BHL_RUNS), () => {
      const full = validatePublicationCandidateSet(snapshot.root);
      assert.ok(full.some(failure => /targeted receipt is unavailable/u.test(failure)), full.join('\n'));
      assert.ok(full.some(failure => /visual review is unavailable/u.test(failure)), full.join('\n'));
    });
  });

  test('full scope fails a stale review even when identity scope passes', () => {
    withEdit(at(TARGETED_REVIEW), editJson(TARGETED_REVIEW, review => {
      review.review_method = 'automated pixel diff';
    }), () => {
      assert.deepEqual(validatePublicationCandidateSet(snapshot.root, {scope: 'identity'}), []);
      assert.ok(validatePublicationCandidateSet(snapshot.root).some(failure => /direct human visual review is missing/u.test(failure)));
    });
  });

  // Each mutation must fail identity scope with the named message. Identity
  // failures must also appear in full scope, because full scope is a superset.
  const mutations = [
    {name: 'candidate CSS', file: () => at('ports/basalt/candidate.css'),
      transform: original => Buffer.from(`${original}\n/* x */\n`),
      message: /candidate CSS SHA differs from the frozen node: theme:basalt/u},
    {name: 'publication source', file: () => at('ports/basalt/candidate.wikidot.source.txt'),
      transform: original => Buffer.from(`${original}\n[[div]]\n`),
      message: /publication source SHA differs from the frozen node: theme:basalt/u},
    {name: 'BHL authority bytes', file: () => at('ports/black-highlighter-theme/option-scenarios/authority.json'),
      transform: original => Buffer.from(`${original}\n`),
      message: /BHL option authority SHA is stale/u},
    {name: 'framerail fingerprint', file: () => path.join(snapshot.workspace, 'framerail/package.json'),
      transform: original => Buffer.from(`${original}\n`),
      message: /BHL Framerail fingerprint is stale/u},
    {name: 'frozen candidate-set identity', file: () => at('publication/frozen-candidate-set.json'),
      transform: editJson('frozen', frozen => {
        frozen.candidate_set_sha256 = ZERO;
      }),
      message: /frozen candidate-set identity does not match its canonical content/u},
    {name: 'BHL scenario authority pin', file: () => at('publication/dependency-graph.json'),
      transform: editJson('graph', graph => {
        graph.targeted_scenarios.find(scenario => scenario.id === 'bhl-options-toggle-header-dark').current_authority_sha256 = ZERO;
      }),
      message: /frozen scenario uses stale BHL option authority|frozen targeted scenario source bindings differ/u},
  ];
  for (const {name, file, transform, message} of mutations) {
    test(`identity scope still fails on a stale ${name}`, () => {
      withEdit(file(), transform, () => {
        const identity = validatePublicationCandidateSet(snapshot.root, {scope: 'identity'});
        const full = validatePublicationCandidateSet(snapshot.root, {scope: 'full'});
        assert.ok(identity.some(failure => message.test(failure)), identity.join('\n'));
        assert.ok(full.some(failure => message.test(failure)), full.join('\n'));
        for (const failure of identity) assert.ok(full.includes(failure), `identity failure missing from full scope: ${failure}`);
      });
    });
  }

  test('identity scope still fails when the run-contract binding is stale', () => {
    const identity = validatePublicationCandidateSet(snapshot.root, {scope: 'identity', expectedCandidateSetSha256: ZERO});
    assert.match(identity.join('\n'), /not bound to the current frozen candidate-set identity/u);
    assert.match(validatePublicationCandidateSet(snapshot.root, {expectedCandidateSetSha256: ZERO}).join('\n'), /not bound/u);
  });

  describe('the Sigma-9 contract builder', () => {
    const template = JSON.parse(fs.readFileSync(path.join(themeLab, 'ports/current-acceptance/run-contract.json'), 'utf8'));
    const identity = createDeepwellRuntimeIdentity({
      source_sha256: '1'.repeat(64),
      ftml_git_revision: '2'.repeat(40),
      container_id: '3'.repeat(64),
      image_id: `sha256:${'4'.repeat(64)}`,
      binary_sha256: '5'.repeat(64),
      config_sha256: '6'.repeat(64),
    });
    const input = {
      runId: 'scope-test-20261023',
      port: 3396,
      framerailSourceSha: 'a'.repeat(64),
      backendRuntimeIdentity: identity,
    };
    const build = () => prepareCurrentRuntimeContract(template, {...input, candidateSet: {root: snapshot.root}});

    test('writes a contract from an identity-valid freeze whose targeted evidence is missing', () => {
      withoutDirectory(at(BHL_RUNS), () => {
        const contract = build();
        assert.equal(contract.candidate_set_sha256, COMMITTED_SET);
        assert.equal(contract.candidate_set_validation, 'identity');
      });
    });

    test('refuses a contract from an identity-invalid freeze', () => {
      withEdit(at('ports/basalt/candidate.css'), original => Buffer.from(`${original}\n/* x */\n`), () => {
        assert.throws(build, /does not validate/u);
      });
    });
  });
});
