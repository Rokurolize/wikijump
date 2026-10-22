#!/usr/bin/env node
// Records explicit visual-question decisions into a browser audit and stamps
// acceptance_model only after the whole semantic validation passes.
//
// usage: record-semantic-browser-reviews.mjs --audit <file> --decisions <file>
//          [--root <theme-lab root>] [--replace] [--dry-run] [--backup-dir <dir>]
//
// Exit 0: recorded, or already recorded (idempotent). Exit 1: refused, nothing
// written. Exit 64: usage error.

import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applySemanticReviewRecording} from '../src/semantic-review-recording.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const KNOWN = new Set(['--audit', '--decisions', '--root', '--replace', '--dry-run', '--backup-dir']);
const FLAGS = new Set(['--replace', '--dry-run']);
const usage = 'usage: record-semantic-browser-reviews.mjs --audit <file> --decisions <file> [--root <theme-lab root>] [--replace] [--dry-run] [--backup-dir <dir>]';

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!KNOWN.has(key)) throw new Error(`unknown argument ${key}`);
    if (FLAGS.has(key)) {
      options[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`${key} needs a value`);
    options[key] = next;
    index += 1;
  }
  return options;
}

let options;
try {
  options = parse(args);
} catch (error) {
  console.error(`${error.message}\n${usage}`);
  process.exit(64);
}
if (!options['--audit'] || !options['--decisions']) {
  console.error(usage);
  process.exit(64);
}

const result = applySemanticReviewRecording({
  auditPath: path.resolve(options['--audit']),
  decisionsPath: path.resolve(options['--decisions']),
  root: path.resolve(options['--root'] ?? path.resolve(here, '..')),
  replace: options['--replace'] === true,
  dryRun: options['--dry-run'] === true,
  backupDir: options['--backup-dir'] ? path.resolve(options['--backup-dir']) : null
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
