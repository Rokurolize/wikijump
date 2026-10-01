#!/usr/bin/env node
// Read-only accounting. Never assigns a screenshot classification or a review.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {planBrowserAcceptance} from '../src/semantic-browser-acceptance.mjs';

const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith('--')) {
  console.error('Usage: node scripts/account-browser-acceptance.mjs /absolute/current-browser-audit.json');
  process.exit(64);
}
const file = path.resolve(args[0]), bytes = fs.readFileSync(file);
const audit = JSON.parse(bytes), plan = planBrowserAcceptance(audit);
console.log(JSON.stringify({audit: file, audit_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  ...plan, caveat: 'This accounts for browser facts and visual questions. Full package/source/asset/font/interaction/torture checks, current runtime identity and complete browser coverage remain separate mandatory acceptance obligations.'}, null, 2));
