import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const ports = fileURLToPath(new URL('../ports/', import.meta.url));
const cli = path.join(ports, 'scripts/reuse-identical-visual-reviews.mjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('postprocess dry-run is immutable; exact reuse verifies current and historical files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-reuse-cli-'));
  try {
    const image = path.join(dir, 'current.png');
    const old = path.join(dir, 'old.png');
    const audit = path.join(dir, 'audit.json');
    const bytes = Buffer.from('exact screenshot bytes');
    await fs.writeFile(image, bytes);
    const row = {
      theme: 'test', browser_engine: 'chromium', viewport: 'mobile', surface: 'page', state: 'normal',
      screenshot: path.relative(ports, image), screenshot_sha256: hash(bytes),
      asset_failures: [], page_errors: [], external_requests_sent: 0,
      classification: 'UNCONFIRMED', reviewed_after_last_change: false,
      unconfirmed_items: ['screenshot captured but awaiting image review'], candidate_sha256: 'new'
    };
    const prior = {...row, screenshot: path.relative(ports, old), candidate_sha256: 'old',
      classification: 'PASS_NATURAL', reviewed_after_last_change: true, unconfirmed_items: [],
      superseded_at: '2026-09-25', historical_screenshot_status: 'valid',
      review_provenance: {method: 'direct-image-vision-review', reviewed_at: '2026-09-25',
        reviewer: 'test reviewer', note: 'Inspected these exact screenshot bytes', screenshot_sha256: hash(bytes)}};
    const original = JSON.stringify({records: [row], superseded_records: [prior]});
    const invoke = (...args) => {
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: dir, encoding: 'utf8', env: {...process.env, THEME_LAB_INTERACTIVE_AUDIT_PATH: audit}
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    await fs.writeFile(audit, original);
    assert.equal(invoke('--dry-run').byte_identical, 1); // removed old image is supported
    assert.equal(await fs.readFile(audit, 'utf8'), original);
    await fs.writeFile(old, 'corrupted historical bytes');
    assert.equal(invoke('--dry-run').reused, 0);
    await fs.writeFile(old, bytes);
    await fs.writeFile(image, 'corrupted current bytes');
    assert.equal(invoke('--dry-run').skipped_current_file_invalid, 1);
    await fs.writeFile(image, bytes);
    assert.equal(invoke().reused, 1);
    const updated = JSON.parse(await fs.readFile(audit, 'utf8'));
    assert.equal(updated.records[0].candidate_sha256, 'new');
    assert.equal(updated.records[0].classification, 'PASS_NATURAL');
    assert.equal(invoke().reused, 0);
    // A valid tEXt chunk changes bytes without changing the decoded image.
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5RkAAAAASUVORK5CYII=','base64');
    const text=Buffer.from('tEXtNote\0same pixels');
    let crc=0xffffffff;
    for(const byte of text){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1}
    const chunk=Buffer.alloc(text.length+8);chunk.writeUInt32BE(text.length-4,0);text.copy(chunk,4);chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);
    const variant=Buffer.concat([png.subarray(0,-12),chunk,png.subarray(-12)]);
    await fs.writeFile(old,png);await fs.writeFile(image,variant);
    const pixelAudit=JSON.stringify({records:[{...row,screenshot_sha256:hash(variant)}],superseded_records:[{
      ...prior,screenshot_sha256:hash(png),review_provenance:{...prior.review_provenance,screenshot_sha256:hash(png)}
    }]});
    await fs.writeFile(audit,pixelAudit);
    assert.equal(invoke('--dry-run').reused,0);
    assert.equal(invoke('--dry-run','--pixel-identical').pixel_identical,1);
    assert.equal(await fs.readFile(audit,'utf8'),pixelAudit);
    assert.equal(invoke('--pixel-identical').pixel_identical,1);
    const pixelResult=JSON.parse(await fs.readFile(audit,'utf8')).records[0];
    assert.equal(pixelResult.visual_review_reuse.reason,'pixel-identical');
    assert.equal(pixelResult.visual_review_reuse.source_reviewer,'test reviewer');
    assert.equal(pixelResult.screenshot_sha256,hash(variant));
  } finally { await fs.rm(dir, {recursive: true, force: true}); }
});
