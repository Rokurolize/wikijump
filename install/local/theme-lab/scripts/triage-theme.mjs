#!/usr/bin/env node
// Static theme triage (#2753): which JP surfaces does this package's
// candidate CSS touch, and which selectors are unclassified? Runs in
// seconds with no daemon, no browser and no artifact writes.
// Usage: node scripts/triage-theme.mjs <package-name-or-slug> [--json]
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {formatTriageSummary, triageThemePackage} from '../src/theme-triage.mjs';

const themeLabRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [target, ...flags] = process.argv.slice(2);
if (!target) {
  process.stderr.write('usage: triage-theme.mjs <package-name-or-slug> [--json]\n');
  process.exit(2);
}
const report = triageThemePackage(themeLabRoot, target);
if (flags.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else process.stdout.write(`${formatTriageSummary(report)}\n`);
