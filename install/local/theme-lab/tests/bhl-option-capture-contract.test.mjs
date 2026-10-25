import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {frozenCandidateSetSha256} from '../src/publication-candidate-freeze.mjs';
import {
  assertRunContractMatches, assertServedFramerailSource, backendTargetFor, frozenCandidateSetIdentity,
  intentReviewDateFor, parseCaptureArgs, resolveTransportOrigin, selectRuntimeSigmaStylesheet, validateTransportOrigin,
} from '../src/bhl-option-capture-contract.mjs';

const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const ORIGIN_3395 = 'https://scpaiueouiuiuiui.wikijump.localhost:3395';
const SIGMA = '/wikidot/styles/sigma-fe5388a32e12.css';

test('capture options default to the imported fixture and reject unknown or malformed input', () => {
  const options = parseCaptureArgs(['--scenario', 'combined', '--baseline', 'sigma10']);
  assert.equal(options.engine, 'chromium');
  assert.equal(options.fixtureSlug, 'run-owned:theme-lab-visual-acceptance-imported-20260924');
  assert.equal(options.transportOrigin, null);
  assert.equal(parseCaptureArgs(['--scenario', 'collapsible', '--baseline', 'sigma9', '--engine', 'webkit', '--state', 'collapsible-rest,collapsible-closed']).state, 'collapsible-rest,collapsible-closed');
  assert.throws(() => parseCaptureArgs(['--scenario', 'combined', '--baseline', 'sigma9', '--port', '3395']), /unknown argument/u);
  assert.throws(() => parseCaptureArgs(['--scenario', 'combined', '--baseline', 'sigma9', '--engine']), /needs a value/u);
  assert.throws(() => parseCaptureArgs(['--scenario', 'combined', '--baseline', 'sigma9', '--engine', 'safari']), /--engine/u);
  assert.throws(() => parseCaptureArgs(['--scenario', 'combined', '--baseline', 'sigma9', '--fixture-slug', 'nav:top']), /run-owned/u);
  assert.throws(() => parseCaptureArgs(['--scenario', 'combined', '--baseline', 'sigma9', '--intent-review-date', '2026/10/06']), /YYYY-MM-DD/u);
  assert.throws(() => parseCaptureArgs(['--scenario', 'combined', '--baseline', 'sigma9', '--runtime-sigma-href', '/etc/passwd']), /sigma/u);
});

test('transport origin must be an HTTPS origin on the BHL site host', () => {
  assert.equal(validateTransportOrigin(ORIGIN_3395), ORIGIN_3395);
  assert.equal(validateTransportOrigin(`${ORIGIN_3395}/`), ORIGIN_3395);
  for (const bad of ['http://scpaiueouiuiuiui.wikijump.localhost:3395', 'https://example.org:3395', `${ORIGIN_3395}/x`, `${ORIGIN_3395}?q=1`, 'https://user:pw@scpaiueouiuiuiui.wikijump.localhost:3395', 'not a url'])
    assert.throws(() => validateTransportOrigin(bad), /transport origin/u, bad);
});

test('transport origin precedence is CLI, then run contract, then the authority default', () => {
  const other = 'https://scpaiueouiuiuiui.wikijump.localhost:12443';
  assert.equal(resolveTransportOrigin({defaultOrigin: ORIGIN_3395}), ORIGIN_3395);
  assert.equal(resolveTransportOrigin({runContract: {transport_origin: other}, defaultOrigin: ORIGIN_3395}), other);
  assert.equal(resolveTransportOrigin({cliOrigin: other, defaultOrigin: ORIGIN_3395}), other);
  assert.equal(resolveTransportOrigin({cliOrigin: other, runContract: {transport_origin: other}, defaultOrigin: ORIGIN_3395}), other);
  assert.throws(() => resolveTransportOrigin({cliOrigin: other, runContract: {transport_origin: ORIGIN_3395}, defaultOrigin: ORIGIN_3395}), /disagrees/u);
});

test('run contracts that pin the framerail or backend identity must match the checkout and authority', () => {
  const framerailSha = 'a'.repeat(64);
  const backendIdentitySha256 = 'b'.repeat(64);
  assert.doesNotThrow(() => assertRunContractMatches(null, {framerailSha, backendIdentitySha256}));
  assert.doesNotThrow(() => assertRunContractMatches({transport_origin: ORIGIN_3395}, {framerailSha, backendIdentitySha256}));
  assert.doesNotThrow(() => assertRunContractMatches({expected_runtime_source_sha256: framerailSha, expected_backend_runtime_identity: {identity_sha256: backendIdentitySha256}}, {framerailSha, backendIdentitySha256}));
  assert.throws(() => assertRunContractMatches({expected_runtime_source_sha256: 'c'.repeat(64)}, {framerailSha, backendIdentitySha256}), /Framerail fingerprint/u);
  assert.throws(() => assertRunContractMatches({expected_backend_runtime_identity: {identity_sha256: 'c'.repeat(64)}}, {framerailSha, backendIdentitySha256}), /expected_backend_runtime_identity/u);
});

test('backend target defaults to the shared stack and accepts only isolated task projects', () => {
  assert.deepEqual(backendTargetFor(undefined), {project: 'wikijump-local-development', containerName: 'wikijump-local-development-deepwell-1', composeProject: 'wikijump-local-development'});
  assert.deepEqual(backendTargetFor('wikijump-theme-lab-basalt-current-20261022'), {project: 'wikijump-theme-lab-basalt-current-20261022', containerName: 'wikijump-theme-lab-basalt-current-20261022-deepwell-1', composeProject: 'wikijump-theme-lab-basalt-current-20261022'});
  assert.throws(() => backendTargetFor('wikijump-local-development'), /--backend-project/u);
  assert.throws(() => backendTargetFor('wikijump-theme-lab-X'), /--backend-project/u);
});

test('intent review date is derived from the authority and a CLI date must agree with it', () => {
  const authority = {source_intent_review: {reviewed_at: '2026-10-06'}};
  assert.equal(intentReviewDateFor(authority), '2026-10-06');
  assert.equal(intentReviewDateFor(authority, '2026-10-06'), '2026-10-06');
  assert.throws(() => intentReviewDateFor(authority, '2026-10-07'), /differs/u);
  assert.throws(() => intentReviewDateFor({}), /missing/u);
});

test('runtime Sigma stylesheet is discovered from the served page and must be unambiguous', () => {
  assert.equal(selectRuntimeSigmaStylesheet(['/a.css', SIGMA, null, SIGMA]), SIGMA);
  assert.equal(selectRuntimeSigmaStylesheet([SIGMA], SIGMA), SIGMA);
  assert.throws(() => selectRuntimeSigmaStylesheet(['/a.css']), /found 0/u);
  assert.throws(() => selectRuntimeSigmaStylesheet([SIGMA, '/wikidot/styles/sigma-0123456789ab.css']), /found 2/u);
  assert.throws(() => selectRuntimeSigmaStylesheet([SIGMA], '/wikidot/styles/sigma-000000000000.css'), /differs/u);
});

test('served Framerail source must be present and equal the checkout fingerprint', () => {
  const checkout = 'd'.repeat(64);
  assert.equal(assertServedFramerailSource(checkout, checkout), checkout);
  assert.throws(() => assertServedFramerailSource(null, checkout), /did not serve/u);
  assert.throws(() => assertServedFramerailSource('e'.repeat(64), checkout), /differs from the checkout/u);
});

test('candidate set identity is recomputed from the committed freeze and refuses tampering', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bhl-capture-identity-'));
  try {
    fs.mkdirSync(path.join(root, 'publication'), {recursive: true});
    const frozen = {inventory: [], nodes: [{id: 'theme:x'}], edges: [], attachments: [], targeted_scenarios: [], authority: {}, state: 'frozen-before-final-acceptance'};
    frozen.candidate_set_sha256 = frozenCandidateSetSha256(frozen);
    fs.writeFileSync(path.join(root, 'publication/frozen-candidate-set.json'), JSON.stringify(frozen));
    assert.deepEqual(frozenCandidateSetIdentity(root), {candidate_set_sha256: frozen.candidate_set_sha256, state: 'frozen-before-final-acceptance'});
    fs.writeFileSync(path.join(root, 'publication/frozen-candidate-set.json'), JSON.stringify({...frozen, nodes: [{id: 'theme:y'}]}));
    assert.throws(() => frozenCandidateSetIdentity(root), /does not match/u);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
