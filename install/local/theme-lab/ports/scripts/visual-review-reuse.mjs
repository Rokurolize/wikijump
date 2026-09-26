import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const visualReviewRowKey = row =>
  JSON.stringify([row.theme, row.browser_engine, row.viewport, row.surface, row.state]);

const validIdentity = row =>
  [row?.theme, row?.browser_engine, row?.viewport, row?.surface, row?.state]
    .every(value => typeof value === 'string' && value.trim().length > 0);
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const explanations = value => Array.isArray(value) && value.length > 0 &&
  value.every(item => typeof item === 'string' && item.trim().length > 0);
// Carry only well-formed explanation arrays forward; a malformed companion
// field must not be copied into new acceptance evidence.
const explanationsOrEmpty = value => explanations(value) ? [...value] : [];

const failedResponse = row => row.action_responses != null &&
  (!Array.isArray(row.action_responses) || row.action_responses.some(response =>
    !response || response.type === 'failure' || response.status >= 400 || response.error_message));

const pendingVisualReview = 'screenshot captured but awaiting image review';

function reviewProvenance(row) {
  const source = row?.visual_review ?? row?.review_provenance;
  if (
    source?.method !== 'direct-image-vision-review' ||
    !Number.isFinite(Date.parse(source?.reviewed_at)) ||
    typeof source?.reviewer !== 'string' || !source.reviewer.trim() ||
    typeof source?.note !== 'string' ||
    source.note.trim().length < 12 ||
    !source?.screenshot_sha256 ||
    source.screenshot_sha256 !== row?.screenshot_sha256
  ) return null;
  return {
    method: source.method,
    reviewed_at: source.reviewed_at,
    reviewer: source.reviewer,
    screenshot_sha256: source.screenshot_sha256,
    note: source.note
  };
}

function sourceCaptureAllowsVisualReuse(row) {
  if (!validIdentity(row) || !validHash(row?.screenshot_sha256)) return false;
  if (row.failure || failedResponse(row)) return false;
  if (row.superseded_at || row.historical_screenshot_status) {
    const status = row.historical_screenshot_status;
    // New compact history distinguishes an intentionally absent old artifact
    // from evidence corruption. A missing old file is acceptable because the
    // newly captured file supplies the exact reviewed bytes again; a recorded
    // mismatch/unreadable path is not. Legacy false/unknown booleans fail
    // closed because they cannot make that distinction.
    if (status == null && row.historical_screenshot_valid !== true) return false;
    if (status && !['valid', 'missing'].includes(status)) return false;
  }

  const assetFailureCount = row.asset_failure_count ?? row.asset_failures?.length;
  const pageErrorCount = row.page_error_count ?? row.page_errors?.length;
  const externalRequestsSent = row.external_requests_sent;

  // Reuse is acceptance evidence, so unknown capture-safety fields are not
  // equivalent to explicit zero. Older compact rows therefore fail closed.
  if (assetFailureCount == null || pageErrorCount == null || externalRequestsSent == null) return false;

  if (assetFailureCount !== 0 || pageErrorCount !== 0 || externalRequestsSent !== 0) return false;
  if (row.asset_failures != null && (!Array.isArray(row.asset_failures) || row.asset_failures.length)) return false;
  if (row.page_errors != null && (!Array.isArray(row.page_errors) || row.page_errors.length)) return false;
  if ((row.unconfirmed_items?.length ?? 0) > 0) return false;
  return true;
}

export function reusableVisualReview(row) {
  if (row?.reviewed_after_last_change !== true) return null;
  const provenance = reviewProvenance(row);
  if (!provenance || !sourceCaptureAllowsVisualReuse(row)) return null;
  if (row.classification === 'PASS_NATURAL') {
    return {
      classification: 'PASS_NATURAL',
      visual_findings: [],
      intentional_differences: [],
      review_provenance: provenance
    };
  }
  if (
    row.classification === 'PASS_INTENTIONAL_DIVERGENCE' &&
    explanations(row.intentional_differences)
  ) {
    return {
      classification: row.classification,
      visual_findings: explanationsOrEmpty(row.visual_findings),
      intentional_differences: [...row.intentional_differences],
      review_provenance: provenance
    };
  }
  if (row.classification === 'NEEDS_FIX' && explanations(row.visual_findings)) {
    return {
      classification: 'NEEDS_FIX',
      visual_findings: [...row.visual_findings],
      intentional_differences: explanationsOrEmpty(row.intentional_differences),
      review_provenance: provenance
    };
  }
  return null;
}

export function currentRowAllowsVisualReuse(row) {
  if (!validIdentity(row) || !validHash(row?.screenshot_sha256) || !row.screenshot || row.failure || failedResponse(row)) return false;
  if (row.reviewed_after_last_change && row.classification !== 'UNCONFIRMED') return false;
  if (!Array.isArray(row.asset_failures) || row.asset_failures.length !== 0) return false;
  if (!Array.isArray(row.page_errors) || row.page_errors.length !== 0) return false;
  if (row.external_requests_sent !== 0) return false;
  if (row.asset_failure_count != null && row.asset_failure_count !== 0) return false;
  if (row.page_error_count != null && row.page_error_count !== 0) return false;
  const unconfirmed = row.unconfirmed_items ?? [];
  if (
    unconfirmed.length !== 1 ||
    String(unconfirmed[0]) !== pendingVisualReview
  ) return false;
  return true;
}

export function buildExactVisualReviewIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const review = reusableVisualReview(row);
    if (!review || !row.screenshot_sha256) continue;
    const key = visualReviewRowKey(row);
    let byHash = index.get(key);
    if (!byHash) {
      byHash = new Map();
      index.set(key, byHash);
    }
    // Callers pass historical rows first and current rows last, so the newest
    // authoritative reviewed row wins for a duplicate key/hash pair.
    byHash.set(row.screenshot_sha256, row);
  }
  return index;
}

export function applyExactVisualReviewReuse(row, index) {
  if (!currentRowAllowsVisualReuse(row)) return false;
  const prior = index.get(visualReviewRowKey(row))?.get(row.screenshot_sha256);
  if (!prior) return false;
  const review = reusableVisualReview(prior);
  if (!review) return false;

  Object.assign(row, structuredClone(review), {
    reviewed_after_last_change: true,
    unconfirmed_items: [],
    visual_review_reuse: {
      reason: 'byte-identical',
      source_screenshot_sha256: prior.screenshot_sha256,
      source_candidate_sha256: prior.candidate_sha256 ?? null,
      source_classification: prior.classification,
      source_reviewed_at: review.review_provenance.reviewed_at,
      source_reviewer: review.review_provenance.reviewer,
      source_review_method: review.review_provenance.method,
      source_review_screenshot_sha256: review.review_provenance.screenshot_sha256
    }
  });
  delete row.visual_review; // a replaced judgement must not shadow its new attribution
  return true;
}

export function applyExactVisualReviewReuseToRows(rows, priorRows) {
  const index = buildExactVisualReviewIndex(priorRows);
  let reused = 0;
  for (const row of rows) {
    if (applyExactVisualReviewReuse(row, index)) reused++;
  }
  return reused;
}

// Validate only artifacts that could supply an exact-byte judgement. The new
// capture supplies missing old bytes, but known corruption must fail closed.
export async function verifyExactReviewSources(rows, targets, portsDir) {
  const wanted = new Set(targets.filter(currentRowAllowsVisualReuse)
    .map(row => `${visualReviewRowKey(row)}:${row.screenshot_sha256}`));
  const verified = [];
  const hashes = new Map();
  for (const row of rows) {
    if (!wanted.has(`${visualReviewRowKey(row)}:${row.screenshot_sha256}`) || !reusableVisualReview(row)) continue;
    if (!row.screenshot) continue;
    const file = path.join(portsDir, row.screenshot);
    if (!hashes.has(file)) {
      try {
        hashes.set(file, crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'));
      } catch (error) {
        hashes.set(file, error.code === 'ENOENT' ? 'missing' : 'unreadable');
      }
    }
    const actual = hashes.get(file);
    if (actual === row.screenshot_sha256 || actual === 'missing') verified.push(row);
  }
  return verified;
}
