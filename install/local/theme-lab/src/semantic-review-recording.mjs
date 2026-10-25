// Records explicit human-or-agent visual-question decisions into a browser audit
// and stamps the semantic acceptance model only when the whole audit validates.
//
// The decisions file is authored from reviews already made. This module never
// infers a decision, never edits a screenshot classification, and never clears
// a failing observation. Every precondition is re-derived from the audit and
// from the bytes of the referenced source artifacts.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SEMANTIC_BROWSER_MODEL,
  observationKey,
  planBrowserAcceptance,
  validateSemanticBrowserAcceptance
} from './semantic-browser-acceptance.mjs';
import {validateVisualGateRecord, visualGateNeedsScreenshot} from './visual-gate.mjs';
import {resolveExistingContainedFile} from './package-path.mjs';

export const SEMANTIC_DECISIONS_SCHEMA = 'theme_lab_semantic_review_decisions.v1';
export const SEMANTIC_REVIEW_METHOD = 'direct-visual-question-review';
const DIRECT_IMAGE_REVIEW_METHOD = 'direct-image-vision-review';
const DECISION_VALUES = new Set(['pass', 'warn', 'fail']);
const RENDERING_KEYS = ['source_html', 'source_rendering', 'source_rendering_receipt'];
const HASH = /^[a-f0-9]{64}$/u;

const validHash = value => HASH.test(value ?? '');
const sha256Of = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Key-order-independent serialization, so an identical review compares equal.
export function canonicalJson(value) {
  return JSON.stringify(value, (key, item) => (item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]]))
    : item));
}

export function sha256Json(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function viewportsOf(question) {
  return [...new Set(question.observations.map(observation => JSON.parse(observation.key)[2]))];
}

function pickBinding(binding) {
  return {path: binding.path, sha256: binding.sha256};
}

// Every screenshot that the visual gate requires must carry a direct review at
// its exact hash. A migration review of the same hash is accepted as before.
function screenshotReviewFailure(row) {
  if (!visualGateNeedsScreenshot(row, {failure: !!row.failure})) return null;
  if (!validHash(row.screenshot_sha256)) return `${observationKey(row)}: screenshot hash missing`;
  const direct = row.visual_review?.method === DIRECT_IMAGE_REVIEW_METHOD &&
    row.visual_review.screenshot_sha256 === row.screenshot_sha256;
  const migrated = row.migration_review?.screenshot_sha256 === row.screenshot_sha256;
  return direct || migrated ? null : `${observationKey(row)}: screenshot not directly reviewed at its exact sha256`;
}

// Reasons that prevent a decision from being recorded for one question.
export function questionDecisionFailures(question, entry, audit, root) {
  const failures = [];
  if (!entry || typeof entry !== 'object') return ['decision entry missing'];
  if (!DECISION_VALUES.has(entry.decision)) failures.push('decision must be pass, warn or fail');
  if (entry.decision === 'fail') failures.push('decision fail cannot be recorded; the audit stays unaccepted');
  if (entry.evidence_sha256 !== question.evidence_sha256) {
    failures.push(`evidence_sha256 ${entry.evidence_sha256 ?? '(none)'} does not match the current question evidence ${question.evidence_sha256}`);
  }
  if (typeof entry.note !== 'string' || entry.note.trim().length < 12) failures.push('note must state the review basis (at least 12 characters)');
  if (typeof entry.reviewer !== 'string' || !entry.reviewer.trim()) failures.push('reviewer is missing');
  if (!Number.isFinite(Date.parse(entry.reviewed_at))) failures.push('reviewed_at is not a valid timestamp');
  if (!/^https:\/\/[a-z0-9-]+\.wikidot\.com\//u.test(entry.source_url ?? '')) failures.push('source_url must be an https wikidot.com URL');

  const rows = new Map((audit.records ?? []).map(row => [observationKey(row), row]));
  for (const observation of question.observations) {
    const row = rows.get(observation.key);
    if (!row) {
      failures.push(`current audit row missing for ${observation.key}`);
      continue;
    }
    const gate = validateVisualGateRecord(row);
    if (gate.length) failures.push(`visual gate failed for ${observation.key}: ${gate[0]}`);
    const review = screenshotReviewFailure(row);
    if (review) failures.push(review);
  }

  const viewports = viewportsOf(question);
  const renderings = entry.source_renderings ?? {};
  for (const viewport of viewports) {
    if (!renderings[viewport]) failures.push(`no source rendering supplied for viewport ${viewport}`);
  }
  for (const viewport of Object.keys(renderings)) {
    if (!viewports.includes(viewport)) failures.push(`source rendering supplied for undeclared viewport ${viewport}`);
  }

  const artifacts = [{label: 'source_snapshot', binding: entry.source_snapshot}];
  for (const viewport of viewports) {
    for (const key of RENDERING_KEYS) artifacts.push({label: `${viewport}/${key}`, binding: renderings[viewport]?.[key]});
  }
  for (const {label, binding} of artifacts) {
    if (typeof binding?.path !== 'string' || !validHash(binding?.sha256)) {
      failures.push(`${label}: path and sha256 are required`);
      continue;
    }
    let file;
    try {
      file = resolveExistingContainedFile(root, binding.path, label);
    } catch (error) {
      failures.push(error.message);
      continue;
    }
    if (sha256Of(file) !== binding.sha256) failures.push(`${label}: file bytes do not match the declared sha256`);
  }
  return failures;
}

// The sealed record shape used by validateSemanticBrowserAcceptance and by the
// existing reference audit.
export function buildSemanticReview(question, entry, plan) {
  const renderings = Object.fromEntries(viewportsOf(question).map(viewport => [viewport, {
    viewport,
    ...Object.fromEntries(RENDERING_KEYS.map(key => [key, pickBinding(entry.source_renderings[viewport][key])]))
  }]));
  return {
    question: question.question,
    evidence_sha256: question.evidence_sha256,
    status: entry.decision,
    method: SEMANTIC_REVIEW_METHOD,
    note: entry.note,
    reviewer: entry.reviewer,
    reviewed_at: entry.reviewed_at,
    source_url: entry.source_url,
    source_snapshot: pickBinding(entry.source_snapshot),
    source_renderings: renderings,
    decision_authority: plan.decision_authority,
    port_conclusion_eligible: plan.port_conclusion_eligible
  };
}

// Pure planning: returns the next audit only when every question is decided
// honestly and the complete semantic validation passes.
export function recordSemanticReviews({audit, decisions, root, replace = false}) {
  const failures = [];
  const outcomes = [];
  const plan = planBrowserAcceptance(audit);
  if (decisions?.schema !== SEMANTIC_DECISIONS_SCHEMA) {
    failures.push(`decisions schema must be ${SEMANTIC_DECISIONS_SCHEMA}`);
    return {ok: false, failures, outcomes, audit: null};
  }
  const entries = decisions.decisions ?? {};
  const questionIds = new Set(plan.visual_questions.map(question => question.id));
  for (const id of Object.keys(entries)) {
    if (!questionIds.has(id)) failures.push(`decision names an unknown visual question ${id}`);
  }
  if (audit.acceptance_model && audit.acceptance_model !== SEMANTIC_BROWSER_MODEL) {
    failures.push(`audit already declares acceptance model ${audit.acceptance_model}`);
  }

  const next = structuredClone(audit);
  next.semantic_reviews ??= {};
  for (const question of plan.visual_questions) {
    const label = `${question.theme}/${question.kind} ${question.id.slice(0, 12)}`;
    if (!Object.hasOwn(entries, question.id)) {
      failures.push(`${label}: no decision recorded`);
      continue;
    }
    const entryFailures = questionDecisionFailures(question, entries[question.id], audit, root);
    if (entryFailures.length) {
      failures.push(...entryFailures.map(item => `${label}: ${item}`));
      continue;
    }
    const record = buildSemanticReview(question, entries[question.id], plan);
    const existing = audit.semantic_reviews?.[question.id];
    if (existing !== undefined && canonicalJson(existing) === canonicalJson(record)) {
      outcomes.push({question: question.id, action: 'unchanged', status: record.status});
      continue;
    }
    if (existing !== undefined && !replace) {
      failures.push(`${label}: an existing review differs from the decision; pass --replace to overwrite it`);
      continue;
    }
    next.semantic_reviews[question.id] = record;
    outcomes.push({question: question.id, action: existing === undefined ? 'written' : 'replaced', status: record.status});
  }
  if (failures.length) return {ok: false, failures, outcomes, audit: null};

  const validation = validateSemanticBrowserAcceptance(next);
  if (validation.failures.length) {
    return {ok: false, failures: validation.failures, outcomes, audit: null};
  }
  next.acceptance_model = SEMANTIC_BROWSER_MODEL;
  return {ok: true, failures: [], outcomes, audit: next, validation_accounting: validation.accounting};
}

function writeAtomically(file, bytes) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, file);
}

// Reads, validates, backs up and then writes the audit. A refusal writes nothing.
export function applySemanticReviewRecording({auditPath, decisionsPath, root, replace = false, dryRun = false, backupDir = null, now = new Date()}) {
  const originalBytes = fs.readFileSync(auditPath);
  const audit = JSON.parse(originalBytes);
  const decisions = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
  const result = recordSemanticReviews({audit, decisions, root, replace});
  const sha256Before = crypto.createHash('sha256').update(originalBytes).digest('hex');
  if (!result.ok) {
    return {ok: false, written: false, failures: result.failures, outcomes: result.outcomes, audit_sha256_before: sha256Before};
  }
  const changed = canonicalJson(audit) !== canonicalJson(result.audit);
  const nextBytes = Buffer.from(JSON.stringify(result.audit, null, 2) + '\n');
  const summary = {
    ok: true,
    written: false,
    changed,
    dry_run: dryRun,
    outcomes: result.outcomes,
    acceptance_model: result.audit.acceptance_model,
    validation_accounting: result.validation_accounting,
    audit_sha256_before: sha256Before,
    audit_sha256_after: crypto.createHash('sha256').update(nextBytes).digest('hex')
  };
  if (!changed || dryRun) return summary;

  const stamp = now.toISOString().replace(/[:.]/gu, '-');
  const directory = backupDir ?? path.dirname(auditPath);
  fs.mkdirSync(directory, {recursive: true});
  const backup = path.join(directory, `${path.basename(auditPath, '.json')}.before-semantic-recording-${stamp}.json`);
  fs.writeFileSync(backup, originalBytes, {flag: 'wx'});
  writeAtomically(auditPath, nextBytes);
  return {...summary, written: true, backup};
}
