import fs from 'node:fs';
import path from 'node:path';
import {frozenCandidateSetSha256} from './publication-candidate-freeze.mjs';
import {ORDINARY_MAIN_FIXTURE_SLUG} from './interactive-acceptance-fixture.mjs';

// Pure option, origin, identity and contract helpers for the BHL option-scenario
// capture. Kept free of browser or Docker side effects so they can be tested.

export const BHL_SITE_HOST = 'scpaiueouiuiuiui.wikijump.localhost';
export const BHL_SHARED_BACKEND_PROJECT = 'wikijump-local-development';
export const BHL_CAPTURE_OPTIONS = Object.freeze(['--scenario', '--baseline', '--engine', '--state', '--transport-origin', '--run-contract', '--backend-project', '--fixture-slug', '--intent-review-date', '--runtime-sigma-href']);
const TASK_PROJECT = /^wikijump-theme-lab-[a-z][a-z0-9-]{2,30}$/u;
const FIXTURE_SLUG = /^run-owned:[a-z0-9][a-z0-9-]{1,80}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const SIGMA_HREF = /^\/wikidot\/styles\/sigma-[0-9a-f]+\.css$/u;

export function parseCaptureArgs(argv) {
  const options = {scenario: null, baseline: null, engine: 'chromium', state: null, transportOrigin: null, runContract: null, backendProject: null, fixtureSlug: ORDINARY_MAIN_FIXTURE_SLUG, intentReviewDate: null, runtimeSigmaHref: null};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!BHL_CAPTURE_OPTIONS.includes(name)) throw new Error(`unknown argument: ${name}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
    i++;
    if (name === '--scenario') options.scenario = value;
    else if (name === '--baseline') options.baseline = value;
    else if (name === '--engine') options.engine = value;
    else if (name === '--state') options.state = value;
    else if (name === '--transport-origin') options.transportOrigin = value;
    else if (name === '--run-contract') options.runContract = value;
    else if (name === '--backend-project') options.backendProject = value;
    else if (name === '--fixture-slug') options.fixtureSlug = value;
    else if (name === '--intent-review-date') options.intentReviewDate = value;
    else if (name === '--runtime-sigma-href') options.runtimeSigmaHref = value;
  }
  if (!['combined', 'collapsible'].includes(options.scenario)) throw new Error('--scenario must be combined or collapsible');
  if (!['sigma9', 'sigma10'].includes(options.baseline)) throw new Error('--baseline must be sigma9 or sigma10');
  if (!['chromium', 'firefox', 'webkit'].includes(options.engine)) throw new Error('--engine must be chromium, firefox, or webkit');
  if (!FIXTURE_SLUG.test(options.fixtureSlug)) throw new Error('--fixture-slug must be a run-owned: page slug');
  if (options.intentReviewDate !== null && !DATE.test(options.intentReviewDate)) throw new Error('--intent-review-date must be YYYY-MM-DD');
  if (options.runtimeSigmaHref !== null && !SIGMA_HREF.test(options.runtimeSigmaHref)) throw new Error('--runtime-sigma-href must be a /wikidot/styles/sigma-<hex>.css path');
  return options;
}

// The transport origin is the Framerail sidecar the browser talks to. It must be
// an HTTPS origin on the BHL site host and nothing else (no path, query or userinfo).
export function validateTransportOrigin(text) {
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error('transport origin must be an absolute HTTPS URL'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== BHL_SITE_HOST || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== ''))
    throw new Error(`transport origin must be an HTTPS origin for ${BHL_SITE_HOST}`);
  return parsed.origin;
}

export function resolveTransportOrigin({cliOrigin = null, runContract = null, defaultOrigin}) {
  const fromContract = runContract?.transport_origin ?? null;
  if (cliOrigin !== null && fromContract !== null && validateTransportOrigin(cliOrigin) !== validateTransportOrigin(fromContract))
    throw new Error('--transport-origin disagrees with the run contract transport_origin');
  return validateTransportOrigin(cliOrigin ?? fromContract ?? defaultOrigin);
}

// Checks a run contract against the checkout and the authority before any browser
// work. Contracts that omit a field impose no constraint on it.
export function assertRunContractMatches(runContract, {framerailSha, backendIdentitySha256}) {
  if (runContract === null) return;
  if (runContract.expected_runtime_source_sha256 !== undefined && runContract.expected_runtime_source_sha256 !== framerailSha)
    throw new Error('run contract expected_runtime_source_sha256 differs from the checkout Framerail fingerprint');
  const contractIdentity = runContract.expected_backend_runtime_identity;
  if (contractIdentity !== undefined && contractIdentity?.identity_sha256 !== backendIdentitySha256)
    throw new Error('run contract expected_backend_runtime_identity differs from the BHL option authority');
}

// Maps a backend project to the Deepwell container and Compose project that
// readRunningDeepwellRuntimeIdentity must inspect. Task projects are isolated
// Compose projects; the default is the shared development stack (read-only here).
export function backendTargetFor(backendProject) {
  if (backendProject === null || backendProject === undefined)
    return {project: BHL_SHARED_BACKEND_PROJECT, containerName: `${BHL_SHARED_BACKEND_PROJECT}-deepwell-1`, composeProject: BHL_SHARED_BACKEND_PROJECT};
  if (!TASK_PROJECT.test(backendProject)) throw new Error('--backend-project must be wikijump-theme-lab-<namespace>');
  return {project: backendProject, containerName: `${backendProject}-deepwell-1`, composeProject: backendProject};
}

export function intentReviewDateFor(authority, cliDate = null) {
  const recorded = authority?.source_intent_review?.reviewed_at;
  if (typeof recorded !== 'string' || !DATE.test(recorded)) throw new Error('BHL toggle source-intent review date is missing from the authority');
  if (cliDate !== null && cliDate !== recorded) throw new Error(`--intent-review-date ${cliDate} differs from the authority review date ${recorded}`);
  return recorded;
}

// The candidate set identity is recomputed from the committed freeze, never
// hard-coded. Stored and recomputed values must agree.
export function frozenCandidateSetIdentity(themeLabRoot) {
  const file = path.join(themeLabRoot, 'publication/frozen-candidate-set.json');
  const frozen = JSON.parse(fs.readFileSync(file, 'utf8'));
  const calculated = frozenCandidateSetSha256(frozen);
  if (typeof frozen.candidate_set_sha256 !== 'string' || calculated !== frozen.candidate_set_sha256)
    throw new Error('frozen candidate set identity does not match its canonical content');
  return {candidate_set_sha256: calculated, state: frozen.state ?? null};
}

// Exactly one Sigma stylesheet must be served by the target page. A recorded
// href, when supplied, must match the served one.
export function selectRuntimeSigmaStylesheet(hrefs, expectedHref = null) {
  const matches = [...new Set(hrefs.filter(href => typeof href === 'string' && SIGMA_HREF.test(href)))];
  if (matches.length !== 1) throw new Error(`expected exactly one runtime Sigma stylesheet, found ${matches.length}`);
  if (expectedHref !== null && matches[0] !== expectedHref) throw new Error(`runtime Sigma stylesheet ${matches[0]} differs from ${expectedHref}`);
  return matches[0];
}

export function assertServedFramerailSource(servedSha, checkoutSha) {
  if (servedSha === null || servedSha === undefined) throw new Error('target runtime did not serve a Framerail source fingerprint');
  if (servedSha !== checkoutSha) throw new Error(`target runtime source fingerprint differs from the checkout: ${servedSha} != ${checkoutSha}`);
  return servedSha;
}
