import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDeepwellRuntimeIdentity} from '../src/deepwell-runtime-identity.mjs';
import {frozenCandidateSetSha256} from '../src/publication-candidate-freeze.mjs';
import {buildBhlVisualReview, VisualReviewRefusal, BHL_VISUAL_REVIEW_PATH} from '../src/bhl-option-visual-review.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const OPT = 'ports/black-highlighter-theme/option-scenarios';
const FRAMERAIL = 'f'.repeat(64);
const SCENARIO = 'bhl-options-toggle-header-dark';
const RECEIPTS = [`${OPT}/runs/combined-sigma9-chromium.json`, `${OPT}/runs/combined-sigma9-firefox.json`];
const hex = n => n.toString(16).padStart(64, '0');

// Builds a self-consistent stub Theme Lab tree: authority, frozen set, graph,
// two receipts with two rows each, and four PNG stubs. Each test mutates it.
function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bhl-visual-review-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const backend = createDeepwellRuntimeIdentity({source_sha256: hex(1), ftml_git_revision: 'a'.repeat(40), container_id: hex(2), image_id: `sha256:${hex(3)}`, binary_sha256: hex(4), config_sha256: hex(5)});
  const authority = {schema: 'theme_lab_bhl_option_authority.v1', framerail: {fingerprint_sha256: FRAMERAIL}, backend_runtime_identity: backend, pages: []};
  const authorityBytes = Buffer.from(JSON.stringify(authority));
  const theme = {id: 'theme:black-highlighter-theme', source_sha256: hex(6), candidate_css_sha256: hex(7)};
  const frozenBase = {
    inventory: [], nodes: [theme], edges: [], attachments: [],
    targeted_scenarios: [{id: SCENARIO, receipt_evidence: RECEIPTS, visual_review: BHL_VISUAL_REVIEW_PATH, option_css_sha256: hex(8)}],
    authority: {bhl_option_authority_sha256: sha(authorityBytes), bhl_framerail_fingerprint_sha256: FRAMERAIL, bhl_backend_runtime_identity_sha256: backend.identity_sha256},
  };
  const frozen = {...frozenBase, candidate_set_sha256: frozenCandidateSetSha256(frozenBase), state: 'frozen-before-final-acceptance'};
  const graph = {targeted_scenarios: frozen.targeted_scenarios};
  const shots = [];
  const writeShot = (name, content) => {
    const rel = `${OPT}/captures/sigma9/chromium/${name}.png`;
    fs.mkdirSync(path.join(root, path.dirname(rel)), {recursive: true});
    fs.writeFileSync(path.join(root, rel), content);
    shots.push({rel, sha: sha(content)});
    return rel;
  };
  const receiptFiles = RECEIPTS.map((rel, index) => {
    const engine = rel.match(/-(chromium|firefox|webkit)\.json$/u)[1];
    const rows = ['toggle-rest', 'toggle-corner-button-open'].map(state => {
      const screenshot = writeShot(`${engine}-${state}`, Buffer.from(`png-${engine}-${state}`));
      return {scenario: 'combined', state, viewport: 'desktop', screenshot, screenshot_sha256: shots.at(-1).sha, assertion_failures: [], page_errors: [], external_requests_sent: 0, source_authority_sha256: sha(authorityBytes), candidate: {source_sha256: theme.source_sha256, css_sha256: theme.candidate_css_sha256}, framerail_fingerprint_sha256: FRAMERAIL, backend_runtime_identity_sha256: backend.identity_sha256};
    });
    const base = {schema: 'theme_lab_bhl_option_targeted_capture.v1', scenario: 'combined', baseline: 'Sigma-9', browser_engine: engine, candidate_set_sha256: frozen.candidate_set_sha256, source_authority_sha256: sha(authorityBytes), candidate_source_sha256: theme.source_sha256, candidate_css_sha256: theme.candidate_css_sha256, option_css_sha256: hex(8), framerail_fingerprint_sha256: FRAMERAIL, backend_runtime_identity: backend, backend_runtime_identity_sha256: backend.identity_sha256, rows};
    const receipt = {...base, receipt_sha256: sha(Buffer.from(JSON.stringify(base)))};
    fs.mkdirSync(path.join(root, OPT, 'runs'), {recursive: true});
    fs.writeFileSync(path.join(root, rel), JSON.stringify(receipt, null, 2) + '\n');
    return rel;
  });
  const decisionsFor = (overrides = {}) => ({
    schema: 'theme_lab_bhl_option_visual_decisions.v1', reviewer: 'Test Reviewer', review_method: 'direct visual inspection of each screenshot', reviewed_at: '2026-10-23T12:00:00Z',
    decisions: shots.map(shot => ({sha256: shot.sha, classification: 'PASS_NATURAL', note: 'matches the intended header and sidebar'})),
    ...overrides,
  });
  const build = (decisions, extra = {}) => buildBhlVisualReview({themeLabRoot: root, frozen, graph, authority, authorityBytes, decisions, checkoutFramerailSha: FRAMERAIL, ...extra});
  return {root, frozen, graph, authority, authorityBytes, shots, receiptFiles, decisionsFor, build};
}

test('a complete set of human decisions binds every receipt and screenshot sha to the candidate set', (t) => {
  const f = makeFixture(t);
  const review = f.build(f.decisionsFor());
  assert.equal(review.schema, 'theme_lab_bhl_option_visual_review.v2');
  assert.equal(review.status, 'pass');
  assert.equal(review.candidate_set_sha256, f.frozen.candidate_set_sha256);
  assert.equal(review.source_authority_sha256, sha(f.authorityBytes));
  assert.equal(review.backend_runtime_identity_sha256, f.authority.backend_runtime_identity.identity_sha256);
  assert.deepEqual(review.classification_counts, {PASS_NATURAL: 4});
  const [scenario] = review.scenarios;
  assert.equal(scenario.id, SCENARIO);
  assert.deepEqual(scenario.receipts.map(r => r.path), RECEIPTS);
  assert.deepEqual(scenario.receipts.map(r => r.sha256), RECEIPTS.map(rel => sha(fs.readFileSync(path.join(f.root, rel)))));
  assert.deepEqual(scenario.screenshots.map(s => s.sha256).sort(), f.shots.map(s => s.sha).sort());
  assert.ok(scenario.screenshots.every(s => s.classification === 'PASS_NATURAL' && s.note.length > 0));
});

test('an intentional divergence is recorded as a pass, and the output is deterministic', (t) => {
  const f = makeFixture(t);
  const decisions = f.decisionsFor();
  decisions.decisions[0].classification = 'PASS_INTENTIONAL_DIVERGENCE';
  const first = f.build(decisions);
  assert.deepEqual(first.classification_counts, {PASS_NATURAL: 3, PASS_INTENTIONAL_DIVERGENCE: 1});
  assert.deepEqual(first, f.build(decisions));
});

test('a screenshot without a decision refuses the whole review', (t) => {
  const f = makeFixture(t);
  const decisions = f.decisionsFor();
  decisions.decisions.pop();
  assert.throws(() => f.build(decisions), error => error instanceof VisualReviewRefusal && error.failures.some(line => line.startsWith('no reviewer decision for screenshot ')));
});

test('a decision for an unknown screenshot sha refuses the review', (t) => {
  const f = makeFixture(t);
  const decisions = f.decisionsFor();
  decisions.decisions.push({sha256: hex(99), classification: 'PASS_NATURAL', note: 'no such screenshot'});
  assert.throws(() => f.build(decisions), error => error.failures.includes(`decision references an unknown screenshot sha ${hex(99)}`));
});

test('any NEEDS_FIX remaining refuses the review', (t) => {
  const f = makeFixture(t);
  const decisions = f.decisionsFor();
  decisions.decisions[1].classification = 'NEEDS_FIX';
  decisions.decisions[1].note = 'close button is clipped at 320px';
  assert.throws(() => f.build(decisions), error => error.failures.some(line => line.startsWith('NEEDS_FIX remains for screenshot')));
});

test('unknown classifications, empty notes and duplicate decisions refuse the review', (t) => {
  const f = makeFixture(t);
  const badClass = f.decisionsFor();
  badClass.decisions[0].classification = 'PASS';
  assert.throws(() => f.build(badClass), error => error.failures.some(line => line.includes('expected one of PASS_NATURAL')));
  const emptyNote = f.decisionsFor();
  emptyNote.decisions[0].note = '   ';
  assert.throws(() => f.build(emptyNote), error => error.failures.some(line => line.includes('non-empty note')));
  const duplicate = f.decisionsFor();
  duplicate.decisions.push({...duplicate.decisions[0]});
  assert.throws(() => f.build(duplicate), error => error.failures.some(line => line.startsWith('duplicate decision')));
});

test('a review method without a human or direct inspection refuses the review', (t) => {
  const f = makeFixture(t);
  assert.throws(() => f.build(f.decisionsFor({review_method: 'automated pixel diff'})), error => error.failures.some(line => line.includes('review_method')));
  assert.throws(() => f.build(f.decisionsFor({reviewer: ''})), error => error.failures.some(line => line.includes('named reviewer')));
});

test('a screenshot changed after capture refuses the review', (t) => {
  const f = makeFixture(t);
  fs.writeFileSync(path.join(f.root, f.shots[0].rel), 'tampered');
  assert.throws(() => f.build(f.decisionsFor()), error => error.failures.some(line => line.includes('screenshot changed since capture')));
});

test('a receipt bound to a different candidate set refuses the review', (t) => {
  const f = makeFixture(t);
  const file = path.join(f.root, f.receiptFiles[0]);
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  receipt.candidate_set_sha256 = hex(42);
  fs.writeFileSync(file, JSON.stringify(receipt, null, 2));
  assert.throws(() => f.build(f.decisionsFor()), error => error.failures.some(line => line.includes('not bound to the frozen candidate set')));
});

test('a stale Framerail fingerprint in the checkout refuses the review', (t) => {
  const f = makeFixture(t);
  assert.throws(() => f.build(f.decisionsFor(), {checkoutFramerailSha: 'e'.repeat(64)}), error => error.failures.some(line => line.includes('differs from the checkout')));
});

test('the recorder CLI refuses without an explicit decisions file and never writes a review', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cli = path.resolve(here, '../ports/black-highlighter-theme/option-scenarios/record-visual-review.mjs');
  const result = spawnSync(process.execPath, [cli], {encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--decisions/u);
});
