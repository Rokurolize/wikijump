#!/usr/bin/env node
// Theme Lab test entry point (package.json "test").
//
// Several suites (browser interaction, capture CLI) resolve
// `@playwright/test` through framerail's node_modules via createRequire,
// because framerail owns the Playwright dependency. In a clean checkout
// where the framerail group has not run, that resolution fails and the
// tests die with "Cannot find module '@playwright/test'" — an install
// state problem, not a test result (#2777). Ensure framerail's
// dependencies are installed (frozen lockfile; a warm pnpm store makes
// this a few seconds and needs no network) before running the suite, so
// every caller — preflight, consolidated validation, a manual npm test —
// exercises the same tests.

import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const themeLabRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(themeLabRoot, '../../..');
export const framerailRoot = path.join(repoRoot, 'framerail');

/** True when `@playwright/test` cannot be resolved from framerail. */
export function framerailPlaywrightMissing(root = framerailRoot) {
  return !fs.existsSync(path.join(root, 'node_modules', '@playwright', 'test', 'package.json'));
}

/** The suite's test files, in the shell-glob order the old script used. */
export function collectTestFiles(args, root = themeLabRoot) {
  if (args.length > 0) return args;
  return fs.readdirSync(path.join(root, 'tests'))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => path.join('tests', name));
}

export function ensureFramerailDependencies(root = framerailRoot, run = spawnSync) {
  if (!framerailPlaywrightMissing(root)) return false;
  process.stderr.write('theme-lab tests: framerail dependencies missing; running pnpm install --frozen-lockfile\n');
  const result = run('pnpm', ['install', '--frozen-lockfile'], {cwd: root, stdio: 'inherit'});
  if (result.error) throw new Error(`could not run pnpm install in framerail: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`pnpm install in framerail exited ${result.status}`);
  if (framerailPlaywrightMissing(root)) {
    throw new Error('framerail dependencies installed but @playwright/test is still unresolvable');
  }
  return true;
}

export function main(argv = process.argv.slice(2)) {
  ensureFramerailDependencies();
  const files = collectTestFiles(argv);
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=4', '--test-timeout=240000', ...files],
    {cwd: themeLabRoot, stdio: 'inherit'},
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
