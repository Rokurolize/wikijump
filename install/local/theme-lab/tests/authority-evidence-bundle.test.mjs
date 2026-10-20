import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildManifest,
  buildManifestEntries,
  createArchive,
  parseArchive,
  splitTarPath,
  verifyRestored,
} from '../src/authority-evidence-bundle.mjs';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function fixtureFiles() {
  return [
    { relative_path: 'evidence/a.txt', bytes: Buffer.from('alpha\n', 'utf8') },
    { relative_path: 'evidence/nested/deep/path/b.bin', bytes: Buffer.from([0, 1, 2, 255, 254]) },
    { relative_path: 'evidence/empty.txt', bytes: Buffer.alloc(0) },
  ];
}

function inventoryOf(files) {
  return files.map(({ relative_path, bytes }) => ({
    relative_path,
    size_bytes: bytes.length,
    sha256: sha(bytes),
  }));
}

function readBytesOf(files) {
  const byPath = new Map(files.map((file) => [file.relative_path, file]));
  return (relativePath) => {
    const found = byPath.get(relativePath);
    return found ? { bytes: found.bytes, sourcePath: `/source/${relativePath}` } : null;
  };
}

test('manifest entries carry path, size, sha256 and source path', () => {
  const files = fixtureFiles();
  const entries = buildManifestEntries(inventoryOf(files), readBytesOf(files));
  assert.deepEqual(entries.map((entry) => [entry.path, entry.size_bytes, entry.source_path]), [
    ['evidence/a.txt', 6, '/source/evidence/a.txt'],
    ['evidence/nested/deep/path/b.bin', 5, '/source/evidence/nested/deep/path/b.bin'],
    ['evidence/empty.txt', 0, '/source/evidence/empty.txt'],
  ]);
  for (const entry of entries) assert.equal(entry.sha256, sha(files.find((file) => file.relative_path === entry.path).bytes));
});

test('manifest building fails closed on missing or disagreeing sources', () => {
  const files = fixtureFiles();
  assert.throws(
    () => buildManifestEntries(inventoryOf(files), () => null),
    /no source for 3 inventoried file\(s\), first: evidence\/a\.txt/,
  );
  const tampered = readBytesOf([{ relative_path: 'evidence/a.txt', bytes: Buffer.from('tampered', 'utf8') }]);
  assert.throws(
    () => buildManifestEntries(inventoryOf([files[0]]), tampered),
    /disagree with inventory hash/,
  );
  const wrongSize = [{ ...inventoryOf([files[0]])[0], size_bytes: 999 }];
  assert.throws(
    () => buildManifestEntries(wrongSize, readBytesOf([files[0]])),
    /disagrees with inventory/,
  );
});

test('packing is deterministic and round-trips through parse', () => {
  const files = fixtureFiles();
  const first = createArchive(files.map(({ relative_path, bytes }) => ({ path: relative_path, bytes })));
  const second = createArchive(files.map(({ relative_path, bytes }) => ({ path: relative_path, bytes })));
  assert.deepEqual(first, second);
  const parsed = parseArchive(first);
  assert.deepEqual(parsed.map((entry) => entry.path), ['evidence/a.txt', 'evidence/empty.txt', 'evidence/nested/deep/path/b.bin']);
  for (const entry of parsed) {
    assert.deepEqual(entry.bytes, files.find((file) => file.relative_path === entry.path).bytes);
  }
  assert.throws(() => createArchive([
    { path: 'dup.txt', bytes: Buffer.from('x') },
    { path: 'dup.txt', bytes: Buffer.from('y') },
  ]), /duplicate archive path/);
});

test('long evidence paths use the USTAR prefix field and unsafe paths are rejected', () => {
  const directory = `evidence/${'d'.repeat(120)}`;
  const longPath = `${directory}/receipt.json`;
  const { name, prefix } = splitTarPath(longPath);
  assert.equal(`${prefix}/${name}`, longPath);
  const archive = createArchive([{ path: longPath, bytes: Buffer.from('{}') }]);
  assert.deepEqual(parseArchive(archive).map((entry) => entry.path), [longPath]);
  assert.throws(() => splitTarPath('x'.repeat(300)), /does not fit USTAR/);
  const evil = createArchive([{ path: 'ok.txt', bytes: Buffer.from('ok') }]);
  evil.write('../evil.txt', 0, 11);
  assert.throws(() => parseArchive(evil), /unsafe archive path/);
});

test('verify passes an exact restore and fails missing, mismatch and unexpected files', () => {
  const files = fixtureFiles();
  const manifest = buildManifest(buildManifestEntries(inventoryOf(files), readBytesOf(files)), {});
  const byPath = new Map(files.map((file) => [file.relative_path, file.bytes]));
  const readRestored = (relativePath) => byPath.get(relativePath) ?? null;
  const listRestored = () => [...byPath.keys()];
  assert.deepEqual(verifyRestored(manifest, readRestored, listRestored), { status: 'pass', checked: 3, failures: [] });

  byPath.delete('evidence/empty.txt');
  let report = verifyRestored(manifest, readRestored, listRestored);
  assert.equal(report.status, 'fail');
  assert.deepEqual(report.failures, [{ path: 'evidence/empty.txt', reason: 'missing' }]);

  byPath.set('evidence/empty.txt', Buffer.alloc(0));
  byPath.set('evidence/a.txt', Buffer.from('corrupt', 'utf8'));
  byPath.set('evidence/stowaway.txt', Buffer.from('extra', 'utf8'));
  report = verifyRestored(manifest, readRestored, () => [...byPath.keys()]);
  assert.equal(report.status, 'fail');
  assert.deepEqual(report.failures, [
    { path: 'evidence/a.txt', reason: 'mismatch' },
    { path: 'evidence/stowaway.txt', reason: 'unexpected' },
  ]);
});

test('pack, extract and verify compose end to end on a fixture tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-bundle-'));
  const checkout = path.join(root, 'checkout');
  const files = fixtureFiles();
  for (const file of files) {
    const full = path.join(checkout, file.relative_path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, file.bytes);
  }
  const inventory = { files: inventoryOf(files) };
  const entries = buildManifestEntries(inventory.files, (relativePath) => {
    const full = path.join(checkout, relativePath);
    return fs.existsSync(full) ? { bytes: fs.readFileSync(full), sourcePath: full } : null;
  });
  const archive = createArchive(entries.map((entry) => ({
    path: entry.path,
    bytes: fs.readFileSync(entry.source_path),
  })));
  const manifest = buildManifest(entries, { archiveSha256: sha(archive) });
  const restored = path.join(root, 'restored');
  for (const entry of parseArchive(archive)) {
    const destination = path.join(restored, entry.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entry.bytes);
  }
  const report = verifyRestored(
    manifest,
    (relativePath) => {
      const full = path.join(restored, relativePath);
      return fs.existsSync(full) ? fs.readFileSync(full) : null;
    },
    () => {
      const found = [];
      const walk = (directory) => {
        for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
          const full = path.join(directory, dirent.name);
          if (dirent.isDirectory()) walk(full);
          else found.push(path.relative(restored, full).split(path.sep).join('/'));
        }
      };
      walk(restored);
      return found;
    },
  );
  assert.deepEqual(report, { status: 'pass', checked: 3, failures: [] });
  assert.equal(manifest.total_bytes, 11);
});
