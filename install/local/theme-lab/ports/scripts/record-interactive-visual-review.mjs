#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {withAuditLock} from './audit-lock.mjs';
import {candidateIdentity} from './candidate-identity.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function applyVisualReviews(rows, reviews, currentIdentity, reviewedAt = new Date().toISOString()) {
  const allowed = new Set(['PASS_NATURAL', 'PASS_INTENTIONAL_DIVERGENCE', 'NEEDS_FIX']);
  const updates = [];
  const rowsByScreenshot = new Map();
  for (const row of rows) {
    if (!row.screenshot_sha256) continue;
    const matching = rowsByScreenshot.get(row.screenshot_sha256) ?? [];
    matching.push(row);
    rowsByScreenshot.set(row.screenshot_sha256, matching);
  }
  for (const review of reviews) {
    if (!/^[0-9a-f]{64}$/u.test(review.screenshot_sha256 ?? '')) throw new Error('review needs an exact screenshot SHA-256');
    if (!allowed.has(review.classification)) throw new Error(`invalid visual classification: ${review.classification}`);
    if (typeof review.note !== 'string' || review.note.trim().length < 12) throw new Error('review needs a concrete visual note');
    if (review.classification === 'PASS_INTENTIONAL_DIVERGENCE' && !review.intentional_difference) throw new Error('intentional divergence needs its reason');
    const matched = rowsByScreenshot.get(review.screenshot_sha256) ?? [];
    if (!matched.length) throw new Error(`screenshot hash not present in audit: ${review.screenshot_sha256}`);
    for (const row of matched) {
      const identity = currentIdentity.get(row.theme);
      if (!identity || row.candidate_sha256 !== identity.candidate_sha256 || row.candidate_source_sha256 !== identity.candidate_source_sha256) {
        throw new Error(`stale candidate evidence: ${row.theme} ${row.viewport} ${row.surface}.${row.state}`);
      }
      updates.push({row, review});
    }
  }
  for (const {row, review} of updates) {
    row.classification = review.classification;
    row.visual_findings = review.visual_findings ?? [];
    row.intentional_differences = review.intentional_difference ? [review.intentional_difference] : [];
    row.unconfirmed_items = [];
    row.reviewed_after_last_change = true;
    row.visual_review = {
      method: 'direct-image-vision-review',
      reviewed_at: reviewedAt,
      screenshot_sha256: review.screenshot_sha256,
      note: review.note,
      reviewer: 'Codex visual capability'
    };
  }
  return {updated_rows: updates.length, unique_images: new Set(updates.map(({review}) => review.screenshot_sha256)).size};
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const input = process.argv[2];
  if (!input) throw new Error('usage: node record-interactive-visual-review.mjs <review-evidence.json>');
  const auditPath = path.join(root, 'interactive-visual-audit.json');
  const evidence = JSON.parse(await fs.readFile(path.resolve(input), 'utf8'));
  if (!Array.isArray(evidence.reviews) || evidence.reviews.length === 0) throw new Error('review evidence must contain a non-empty reviews array');
  await withAuditLock(auditPath, async () => {
    const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'));
    const known = new Map();
    for (const row of audit.records) {
      const values = known.get(row.theme) ?? new Set();
      if (row.candidate_sha256) values.add(row.candidate_sha256);
      known.set(row.theme, values);
    }
    const current = new Map();
    for (const theme of new Set(audit.records.map(row => row.theme))) {
      const dir = path.join(root, theme);
      const css = await fs.readFile(path.join(dir, 'candidate.css'));
      const base = await fs.readFile(path.join(dir, 'candidate-base.css')).catch(() => Buffer.alloc(0));
      const source = await fs.readFile(path.join(dir, 'candidate.wikidot.source.txt')).catch(() => fs.readFile(path.join(dir, 'candidate.wikidot.txt')));
      current.set(theme, {
        candidate_sha256: candidateIdentity(css, base, known.get(theme)).candidateSha,
        candidate_source_sha256: sha(source)
      });
    }
    const rowsByScreenshot = new Map();
    for (const row of audit.records) {
      if (!row.screenshot_sha256) continue;
      const matching = rowsByScreenshot.get(row.screenshot_sha256) ?? [];
      matching.push(row);
      rowsByScreenshot.set(row.screenshot_sha256, matching);
    }
    const verifiedPaths = new Set();
    for (const review of evidence.reviews) {
      const matching = rowsByScreenshot.get(review.screenshot_sha256) ?? [];
      if (!matching.length) throw new Error(`no audit row for screenshot ${review.screenshot_sha256}`);
      for (const screenshot of new Set(matching.map(row => row.screenshot))) {
        const key = `${screenshot}\0${review.screenshot_sha256}`;
        if (verifiedPaths.has(key)) continue;
        const bytes = await fs.readFile(path.join(root, screenshot));
        if (sha(bytes) !== review.screenshot_sha256) throw new Error(`screenshot bytes do not match review hash: ${screenshot}`);
        verifiedPaths.add(key);
      }
    }
    const result = applyVisualReviews(audit.records, evidence.reviews, current);
    audit.updated_at = new Date().toISOString();
    audit.visual_review_updates = (audit.visual_review_updates ?? 0) + evidence.reviews.length;
    const temporary = `${auditPath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(audit) + '\n');
    await fs.rename(temporary, auditPath);
    console.log(JSON.stringify({schema:'theme_lab_visual_review_update.v1', ...result, evidence_entries:evidence.reviews.length}));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
