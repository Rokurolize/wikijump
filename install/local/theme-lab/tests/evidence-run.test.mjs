import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {verify} from '../src/evidence-store.mjs';
import {storeRunArtifacts} from '../src/evidence-run.mjs';

function makeRunDir(base, name, files) {
  const dir = path.join(base, name);
  fs.mkdirSync(dir, {recursive: true});
  for (const [rel, body] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, body);
  }
  return dir;
}

test('run artifacts are deduplicated into the store and materialized as hardlinks', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-run-test-'));
  const store = path.join(base, 'store');
  const shot = Buffer.alloc(2048, 7);
  const runDir = makeRunDir(base, 'run-a', {'desktop.png': shot, 'mobile.png': shot, 'verdict.json': '{"ok":true}'});
  const manifestPath = path.join(base, 'run-a.manifest.json');
  const stats = await storeRunArtifacts(runDir, {store, manifestPath});
  assert.equal(stats.files, 3);
  assert.equal(stats.new_objects, 2);
  assert.equal(stats.linked, 3);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.files['desktop.png'].sha256, manifest.files['mobile.png'].sha256);
  // The view is a hardlink to the store object: same inode, same bytes.
  const objectPath = path.join(store, 'objects', manifest.files['desktop.png'].sha256.slice(0, 2), manifest.files['desktop.png'].sha256);
  assert.equal(fs.statSync(path.join(runDir, 'desktop.png')).ino, fs.statSync(objectPath).ino);
  assert.deepEqual(fs.readFileSync(path.join(runDir, 'mobile.png')), shot);
  const verified = await verify(store, manifestPath);
  assert.equal(verified.objects, 2);
  assert.equal(verified.manifestResolved, 3);
});

test('a second run with identical captures adds no new objects', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-run-test-'));
  const store = path.join(base, 'store');
  const files = {'a.png': 'same-bytes', 'b.json': '{"v":1}'};
  const first = await storeRunArtifacts(makeRunDir(base, 'run-1', files), {store, manifestPath: path.join(base, 'run-1.manifest.json')});
  assert.equal(first.new_objects, 2);
  const second = await storeRunArtifacts(makeRunDir(base, 'run-2', files), {store, manifestPath: path.join(base, 'run-2.manifest.json')});
  assert.equal(second.new_objects, 0);
  assert.equal(second.new_bytes, 0);
  assert.equal(second.files, 2);
});
