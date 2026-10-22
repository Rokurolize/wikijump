#!/usr/bin/env node
// Records runs/visual-review.json from an explicit reviewer decisions file.
// Usage: record-visual-review.mjs --decisions <file.json> [--replace]
// Refuses (non-zero exit, no file written) on any missing decision, unknown
// screenshot sha, NEEDS_FIX, or stale/unbound receipt or authority.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildBhlVisualReview, VisualReviewRefusal} from '../../../src/bhl-option-visual-review.mjs';
import {framerailSourceFingerprintSync} from '../../../src/framerail-source-fingerprint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const themeLab = path.resolve(here, '../../../');
const repo = path.resolve(here, '../../../../../../');
const args = process.argv.slice(2);
const flag = name => args.indexOf(name) < 0 ? null : args[args.indexOf(name) + 1] ?? null;
const replace = args.includes('--replace');
const known = new Set(['--decisions', '--replace']);
for (let i = 0; i < args.length; i++) {
  if (!known.has(args[i])) throw new Error(`unknown argument: ${args[i]}`);
  if (args[i] === '--decisions') i++;
}
const decisionsPath = flag('--decisions');
if (!decisionsPath) throw new Error('--decisions <file.json> is required; the reviewer decisions are never generated');

const outPath = path.join(here, 'runs/visual-review.json');
try {
  if (!replace && fs.existsSync(outPath)) throw new VisualReviewRefusal([`${path.relative(repo, outPath)} exists; pass --replace to overwrite it`]);
  const authorityBytes = fs.readFileSync(path.join(here, 'authority.json'));
  const review = buildBhlVisualReview({
    themeLabRoot: themeLab,
    frozen: JSON.parse(fs.readFileSync(path.join(themeLab, 'publication/frozen-candidate-set.json'), 'utf8')),
    graph: JSON.parse(fs.readFileSync(path.join(themeLab, 'publication/dependency-graph.json'), 'utf8')),
    authority: JSON.parse(authorityBytes.toString('utf8')),
    authorityBytes,
    decisions: JSON.parse(fs.readFileSync(path.resolve(decisionsPath), 'utf8')),
    checkoutFramerailSha: framerailSourceFingerprintSync(repo),
  });
  fs.mkdirSync(path.dirname(outPath), {recursive: true});
  fs.writeFileSync(outPath, JSON.stringify(review, null, 2) + '\n', {flag: replace ? 'w' : 'wx'});
  process.stdout.write(JSON.stringify({review: outPath, candidate_set_sha256: review.candidate_set_sha256, screenshots: review.scenarios.reduce((n, s) => n + s.screenshots.length, 0), classification_counts: review.classification_counts}) + '\n');
} catch (error) {
  process.stderr.write((error instanceof VisualReviewRefusal ? error.message : `visual review failed: ${error.message}`) + '\n');
  process.exitCode = 1;
}
