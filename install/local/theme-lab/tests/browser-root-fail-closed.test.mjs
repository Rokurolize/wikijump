import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadBrowserType} from '../src/browser-lab.mjs';
import {playwrightBrowserVersions} from '../src/playwright-browser-versions.mjs';

test('a missing browser root fails closed instead of resolving an ancestor Playwright', () => {
  const missing = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'browser-root-')), 'framerail-does-not-exist');
  assert.throws(() => loadBrowserType('firefox', missing), /browser root has no package\.json/u);
  assert.throws(() => playwrightBrowserVersions(missing), /browser root has no package\.json/u);
});

test('a browser root without package.json fails closed', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-root-bare-'));
  assert.throws(() => loadBrowserType('chromium', bare), /browser root has no package\.json/u);
  assert.throws(() => playwrightBrowserVersions(bare), /browser root has no package\.json/u);
});

test('a browser root whose package has no Playwright still reports that failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-root-empty-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"empty-browser-root","private":true}\n');
  assert.throws(() => loadBrowserType('webkit', root), /could not load Playwright/u);
});
