import crypto from 'node:crypto';
import fs from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {resolveExistingContainedFile} from './package-path.mjs';
import {canonicalBhlScreenshotPath, frozenCandidateSetSha256} from './publication-candidate-freeze.mjs';
import {requireDeepwellRuntimeIdentity} from './deepwell-runtime-identity.mjs';

// Builds runs/visual-review.json for the BHL option scenarios from explicit
// reviewer decisions. Every receipt and screenshot is re-read and re-hashed here;
// nothing is inferred. Any defect returns refusal failures and no review.

export const BHL_VISUAL_REVIEW_SCHEMA = 'theme_lab_bhl_option_visual_review.v2';
export const BHL_VISUAL_DECISIONS_SCHEMA = 'theme_lab_bhl_option_visual_decisions.v1';
export const BHL_VISUAL_CLASSIFICATIONS = Object.freeze(['PASS_NATURAL', 'PASS_INTENTIONAL_DIVERGENCE', 'NEEDS_FIX']);
const SHA256 = /^[a-f0-9]{64}$/u;
export const BHL_VISUAL_REVIEW_PATH = 'ports/black-highlighter-theme/option-scenarios/runs/visual-review.json';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export class VisualReviewRefusal extends Error {
  constructor(failures) {
    super(`visual review refused:\n- ${failures.join('\n- ')}`);
    this.name = 'VisualReviewRefusal';
    this.failures = failures;
  }
}

function decisionFailures(decisions) {
  const failures = [];
  if (decisions?.schema !== BHL_VISUAL_DECISIONS_SCHEMA) failures.push(`decisions file schema must be ${BHL_VISUAL_DECISIONS_SCHEMA}`);
  if (typeof decisions?.reviewer !== 'string' || !decisions.reviewer.trim()) failures.push('decisions file needs a named reviewer');
  if (typeof decisions?.review_method !== 'string' || !/human|direct/iu.test(decisions.review_method)) failures.push('decisions file review_method must describe a human or direct visual inspection');
  if (typeof decisions?.reviewed_at !== 'string' || Number.isNaN(Date.parse(decisions.reviewed_at))) failures.push('decisions file needs a reviewed_at timestamp');
  if (!Array.isArray(decisions?.decisions) || decisions.decisions.length === 0) failures.push('decisions file needs a non-empty decisions array');
  return failures;
}

// Returns {decisionsBySha, failures}. Duplicate, malformed or unclassified
// decisions are refusals; a decision for an unknown screenshot is checked later.
function indexDecisions(decisions, failures) {
  const bySha = new Map();
  (Array.isArray(decisions?.decisions) ? decisions.decisions : []).forEach((row, index) => {
    const label = `decision ${index}`;
    if (typeof row?.sha256 !== 'string' || !SHA256.test(row.sha256)) return failures.push(`${label} has no valid screenshot sha256`);
    if (!BHL_VISUAL_CLASSIFICATIONS.includes(row.classification)) failures.push(`${label} (${row.sha256}) has classification ${JSON.stringify(row.classification)}; expected one of ${BHL_VISUAL_CLASSIFICATIONS.join(', ')}`);
    if (typeof row.note !== 'string' || !row.note.trim()) failures.push(`${label} (${row.sha256}) needs a non-empty note`);
    if (bySha.has(row.sha256)) return failures.push(`duplicate decision for screenshot ${row.sha256}`);
    bySha.set(row.sha256, row);
  });
  return bySha;
}

function readReceipt(themeLabRoot, receiptPath, scenarioId) {
  const file = resolveExistingContainedFile(themeLabRoot, receiptPath, `${scenarioId} receipt`);
  const bytes = fs.readFileSync(file);
  return {bytes, receipt: JSON.parse(bytes)};
}

export function buildBhlVisualReview({themeLabRoot, frozen, graph, authority, authorityBytes, decisions, checkoutFramerailSha}) {
  const failures = decisionFailures(decisions);
  const decisionsBySha = indexDecisions(decisions, failures);
  const frozenIdentity = frozenCandidateSetSha256(frozen);
  if (frozen.candidate_set_sha256 !== frozenIdentity) failures.push('frozen candidate set identity does not match its canonical content');
  if (!isDeepStrictEqual(frozen.targeted_scenarios ?? [], graph?.targeted_scenarios ?? [])) failures.push('frozen targeted scenarios differ from the dependency graph');
  const scenarios = (frozen.targeted_scenarios ?? []).filter(scenario => scenario.id?.startsWith('bhl-options-'));
  if (!scenarios.length) failures.push('frozen candidate set has no BHL option scenarios');

  const authoritySha = sha(authorityBytes);
  const frozenTheme = frozen.nodes?.find(node => node.id === 'theme:black-highlighter-theme');
  if (!frozenTheme) failures.push('frozen candidate set has no BHL theme node');
  if (frozen.authority?.bhl_option_authority_sha256 !== authoritySha) failures.push('BHL option authority bytes differ from the frozen candidate set');
  if (authority.framerail?.fingerprint_sha256 !== checkoutFramerailSha) failures.push('BHL authority Framerail fingerprint differs from the checkout');
  if (frozen.authority?.bhl_framerail_fingerprint_sha256 !== checkoutFramerailSha) failures.push('frozen candidate set Framerail fingerprint differs from the checkout');
  let backendIdentity = null;
  try {
    backendIdentity = requireDeepwellRuntimeIdentity(authority.backend_runtime_identity, 'BHL option authority');
    if (backendIdentity.identity_sha256 !== frozen.authority?.bhl_backend_runtime_identity_sha256) failures.push('BHL Deepwell backend identity differs from the frozen candidate set');
  } catch (error) {
    failures.push(error.message);
  }

  const allScreenshotShas = new Set();
  const reviewScenarios = [];
  for (const scenario of scenarios) {
    const expectedScenario = scenario.id === 'bhl-options-toggle-header-dark' ? 'combined' : 'collapsible';
    if (scenario.visual_review !== BHL_VISUAL_REVIEW_PATH) failures.push(`${scenario.id}: frozen scenario binds a different visual review path`);
    const receipts = [];
    const screenshots = [];
    for (const receiptPath of scenario.receipt_evidence ?? []) {
      try {
        const {bytes, receipt} = readReceipt(themeLabRoot, receiptPath, scenario.id);
        const {receipt_sha256: receiptSha, ...receiptBody} = receipt;
        if (!receiptSha || sha(Buffer.from(JSON.stringify(receiptBody))) !== receiptSha) failures.push(`${scenario.id}: receipt integrity hash is invalid: ${receiptPath}`);
        if (receipt.candidate_set_sha256 !== frozen.candidate_set_sha256) failures.push(`${scenario.id}: receipt is not bound to the frozen candidate set: ${receiptPath}`);
        if (receipt.scenario !== expectedScenario || receipt.source_authority_sha256 !== authoritySha ||
            receipt.candidate_source_sha256 !== frozenTheme?.source_sha256 || receipt.candidate_css_sha256 !== frozenTheme?.candidate_css_sha256 ||
            receipt.framerail_fingerprint_sha256 !== checkoutFramerailSha || receipt.option_css_sha256 !== scenario.option_css_sha256)
          failures.push(`${scenario.id}: receipt authority differs from the frozen candidate set: ${receiptPath}`);
        if (backendIdentity && receipt.backend_runtime_identity_sha256 !== backendIdentity.identity_sha256) failures.push(`${scenario.id}: receipt uses a different Deepwell backend identity: ${receiptPath}`);
        const engine = receiptPath.match(/-(chromium|firefox|webkit)\.json$/u)?.[1];
        const baseline = receiptPath.match(/-(sigma9|sigma10)-/u)?.[1];
        if (!engine || !baseline || receipt.browser_engine !== engine || receipt.baseline?.toLowerCase() !== (baseline === 'sigma9' ? 'sigma-9' : 'sigma-10'))
          failures.push(`${scenario.id}: receipt file identity differs from its contents: ${receiptPath}`);
        for (const row of receipt.rows ?? []) {
          const where = `${receiptPath}/${row.state}`;
          if (row.assertion_failures?.length || row.external_requests_sent !== 0 || row.page_errors?.length) failures.push(`${scenario.id}: capture has unresolved runtime failures: ${where}`);
          if (row.source_authority_sha256 !== authoritySha || row.candidate?.source_sha256 !== frozenTheme?.source_sha256 || row.candidate?.css_sha256 !== frozenTheme?.candidate_css_sha256 || row.framerail_fingerprint_sha256 !== checkoutFramerailSha)
            failures.push(`${scenario.id}: capture row uses stale source or runtime authority: ${where}`);
          try {
            const screenshotPath = canonicalBhlScreenshotPath(themeLabRoot, row.screenshot);
            const bytesOfShot = fs.readFileSync(resolveExistingContainedFile(themeLabRoot, screenshotPath, `${scenario.id} screenshot`));
            if (sha(bytesOfShot) !== row.screenshot_sha256) failures.push(`${scenario.id}: screenshot changed since capture: ${row.screenshot}`);
            screenshots.push({path: screenshotPath, sha256: row.screenshot_sha256, receipt_path: receiptPath, state: row.state, viewport: row.viewport, browser_engine: receipt.browser_engine, baseline: receipt.baseline});
            allScreenshotShas.add(row.screenshot_sha256);
          } catch (error) {
            failures.push(`${scenario.id}: screenshot is unavailable: ${row.screenshot}: ${error.message}`);
          }
        }
        receipts.push({path: receiptPath, sha256: sha(bytes)});
      } catch (error) {
        failures.push(`${scenario.id}: receipt is unavailable: ${receiptPath}: ${error.message}`);
      }
    }
    if (!scenario.receipt_evidence?.length) failures.push(`${scenario.id}: no receipts are bound`);
    reviewScenarios.push({id: scenario.id, status: 'pass', reviewer: decisions?.reviewer?.trim?.() ?? null, review_method: decisions?.review_method ?? null, receipts, screenshots});
  }

  const decided = new Set(decisionsBySha.keys());
  for (const shot of allScreenshotShas) if (!decided.has(shot)) failures.push(`no reviewer decision for screenshot ${shot}`);
  for (const shot of decided) if (!allScreenshotShas.has(shot)) failures.push(`decision references an unknown screenshot sha ${shot}`);
  const needsFix = [...decisionsBySha.values()].filter(row => row.classification === 'NEEDS_FIX');
  for (const row of needsFix) failures.push(`NEEDS_FIX remains for screenshot ${row.sha256}: ${row.note}`);
  if (failures.length) throw new VisualReviewRefusal(failures);

  const counts = {};
  for (const scenario of reviewScenarios) {
    scenario.screenshots = scenario.screenshots.map(shot => {
      const decision = decisionsBySha.get(shot.sha256);
      counts[decision.classification] = (counts[decision.classification] ?? 0) + 1;
      return {...shot, classification: decision.classification, note: decision.note.trim()};
    });
  }
  return {
    schema: BHL_VISUAL_REVIEW_SCHEMA,
    status: 'pass',
    reviewer: decisions.reviewer.trim(),
    review_method: decisions.review_method,
    reviewed_at: decisions.reviewed_at,
    candidate_set_sha256: frozen.candidate_set_sha256,
    source_authority_sha256: authoritySha,
    framerail_fingerprint_sha256: checkoutFramerailSha,
    backend_runtime_identity: authority.backend_runtime_identity,
    backend_runtime_identity_sha256: backendIdentity.identity_sha256,
    candidate_identity: {theme_candidate_source_sha256: frozenTheme.source_sha256, theme_candidate_css_sha256: frozenTheme.candidate_css_sha256},
    classification_counts: counts,
    scenarios: reviewScenarios,
  };
}
