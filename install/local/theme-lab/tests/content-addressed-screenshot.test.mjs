import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {storeContentAddressedScreenshot} from '../ports/scripts/content-addressed-screenshot.mjs';

test('visual recaptures keep immutable screenshot bytes by content hash', async t => {
  const portsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'theme-lab-shots-'));
  t.after(() => fs.rm(portsDir, {recursive: true, force: true}));
  const identity = {portsDir, theme: 'bedrock', engine: 'chromium', viewport: 'mobile', stateKey: 'page-normal-settled-mobile'};
  const beforeBytes = Buffer.from('before screenshot bytes');
  const afterBytes = Buffer.from('after screenshot bytes');

  const before = await storeContentAddressedScreenshot({...identity, bytes: beforeBytes});
  const after = await storeContentAddressedScreenshot({...identity, bytes: afterBytes});
  const beforePath = path.join(portsDir, before.path);
  const afterPath = path.join(portsDir, after.path);

  assert.notEqual(before.path, after.path);
  assert.deepEqual(await fs.readFile(beforePath), beforeBytes);
  assert.deepEqual(await fs.readFile(afterPath), afterBytes);
  assert.equal(before.sha256, crypto.createHash('sha256').update(beforeBytes).digest('hex'));
  assert.deepEqual(await storeContentAddressedScreenshot({...identity, bytes: beforeBytes}), before);
});

test('content-addressed screenshot identity rejects path components', async t => {
  const portsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'theme-lab-shots-'));
  t.after(() => fs.rm(portsDir, {recursive: true, force: true}));
  await assert.rejects(storeContentAddressedScreenshot({portsDir, theme: '../escape', engine: 'chromium', viewport: 'mobile', stateKey: 'normal', bytes: Buffer.from('x')}), /invalid screenshot artifact identity/);
});
