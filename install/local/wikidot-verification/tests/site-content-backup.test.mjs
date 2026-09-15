import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildCorpusImportManifest } from '../src/corpus-import-manifest.mjs';
import {
  SITE_CONTENT_BACKUP_MANIFEST_FILENAME,
  SITE_CONTENT_BACKUP_SCHEMA,
  writeSiteContentBackup,
} from '../src/site-content-backup.mjs';
import {
  cryptoSha256,
  writePage,
  writePageAttachment,
} from './support/corpus-import-manifest-fixture.mjs';

function listFiles(root, current = root) {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) return listFiles(root, entryPath);
    return [path.relative(root, entryPath).split(path.sep).join('/')];
  }).sort();
}

function fileContents(root) {
  return new Map(listFiles(root).map((relativePath) => [
    relativePath,
    fs.readFileSync(path.join(root, relativePath)),
  ]));
}

function containsKey(value, key) {
  if (Array.isArray(value)) return value.some((item) => containsKey(item, key));
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([entryKey, entryValue]) =>
    entryKey === key || containsKey(entryValue, key));
}

function attachmentSummary(row) {
  return (row.attachments ?? []).map((attachment) => ({
    filename: attachment.filename,
    original_url: attachment.original_url,
    wikidot_path: attachment.wikidot_path,
    sha256: attachment.sha256,
    size: attachment.size,
  }));
}

test('writeSiteContentBackup emits a deterministic pages-and-attachments source bundle', () => {
  const corpusRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'site-content-backup-corpus-'));
  const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), 'site-content-backup-output-'));
  const alphaBytes = Buffer.from([1, 2, 3, 4]);
  const zetaBytes = Buffer.from([5, 6, 7]);
  const alphaSource = 'alpha page source';
  const zetaSource = 'zeta page source';

  writePage(corpusRoot, 'en', 'alpha', {
    entityId: '21212121-2121-4121-8121-212121212121',
    source: alphaSource,
    meta: {
      title: 'Alpha',
      title_shown: 'Alpha',
      welcome_page: 'alpha',
      settings_revision: 23,
      google_analytics_enabled: true,
      google_analytics_profile: 'UA-00000000-2',
    },
  });
  writePageAttachment(corpusRoot, 'en', 'alpha', {
    filename: 'alpha.png',
    bytes: alphaBytes,
    originalUrl: 'https://scp-wiki.wikidot.com/local--files/alpha/alpha.png',
  });
  writePage(corpusRoot, 'en', 'zeta', {
    entityId: '22222222-2222-4222-8222-222222222222',
    source: zetaSource,
    meta: {
      title: 'Zeta',
      title_shown: 'Zeta',
      welcome_page: 'zeta',
      settings_revision: 24,
      google_analytics_enabled: false,
      google_analytics_profile: 'UA-00000000-3',
    },
  });
  writePageAttachment(corpusRoot, 'en', 'zeta', {
    filename: 'zeta.bin',
    bytes: zetaBytes,
    originalUrl: 'https://scp-wiki.wikidot.com/local--files/zeta/zeta.bin',
  });

  const first = writeSiteContentBackup({
    corpusRoot,
    branch: 'en',
    sourceSite: 'scp-wiki',
    sourceBranch: 'en',
    outputRoot: path.join(outputParent, 'first'),
  });
  const second = writeSiteContentBackup({
    corpusRoot,
    branch: 'en',
    sourceSite: 'scp-wiki',
    sourceBranch: 'en',
    outputRoot: path.join(outputParent, 'second'),
  });

  assert.equal(first.manifestPath, path.join(first.outputRoot, SITE_CONTENT_BACKUP_MANIFEST_FILENAME));
  assert.equal(first.manifest.schema, SITE_CONTENT_BACKUP_SCHEMA);
  assert.equal(first.manifest.representation, 'source-bundle-directory');
  assert.equal(first.manifest.scope, 'pages+attachments');
  assert.deepEqual(first.manifest.counts, {
    pages: 2,
    attachments: 2,
    source_bytes: Buffer.byteLength(alphaSource) + Buffer.byteLength(zetaSource),
    attachment_bytes: alphaBytes.length + zetaBytes.length,
    content_bytes: Buffer.byteLength(alphaSource) + Buffer.byteLength(zetaSource) + alphaBytes.length + zetaBytes.length,
  });
  assert.deepEqual(first.manifest.pages.map((page) => page.fullname), ['alpha', 'zeta']);

  const archivePaths = first.manifest.pages.flatMap((page) => [
    page.source_path,
    ...page.attachments.map((attachment) => attachment.archive_path),
  ]);
  assert.equal(new Set(archivePaths).size, archivePaths.length);
  assert.equal(new Set(first.manifest.pages.map((page) => page.fullname)).size, 2);
  assert.equal(new Set(first.manifest.pages.flatMap((page) => page.attachments.map((attachment) => attachment.archive_path))).size, 2);

  assert.deepEqual(first.manifest, second.manifest);
  assert.deepEqual([...fileContents(first.outputRoot).entries()], [...fileContents(second.outputRoot).entries()]);

  const imported = buildCorpusImportManifest({
    sourceBundleRoot: first.outputRoot,
    branch: 'ignored-by-source-bundle-boundary',
    sourceSite: 'scp-wiki',
    sourceBranch: 'en',
  });
  assert.deepEqual(imported.map((row) => row.fullname), ['alpha', 'zeta']);
  assert.deepEqual(imported.map(attachmentSummary), [
    [{
      filename: 'alpha.png',
      original_url: 'https://scp-wiki.wikidot.com/local--files/alpha/alpha.png',
      wikidot_path: '/local--files/alpha/alpha.png',
      sha256: cryptoSha256(alphaBytes),
      size: alphaBytes.length,
    }],
    [{
      filename: 'zeta.bin',
      original_url: 'https://scp-wiki.wikidot.com/local--files/zeta/zeta.bin',
      wikidot_path: '/local--files/zeta/zeta.bin',
      sha256: cryptoSha256(zetaBytes),
      size: zetaBytes.length,
    }],
  ]);
  assert.deepEqual(imported.map((row) => row.source_sha256), [
    cryptoSha256(alphaSource),
    cryptoSha256(zetaSource),
  ]);

  const serializedJson = [
    fs.readFileSync(first.manifestPath, 'utf8'),
    ...first.manifest.pages.flatMap((page) => [
      fs.readFileSync(path.join(first.outputRoot, 'pages', page.fullname, 'meta.json'), 'utf8'),
      fs.readFileSync(path.join(first.outputRoot, 'pages', page.fullname, 'files.json'), 'utf8'),
    ]),
  ].map((text) => JSON.parse(text));
  for (const excludedKey of [
    'welcome_page',
    'settings_revision',
    'google_analytics_enabled',
    'google_analytics_profile',
  ]) {
    assert.equal(serializedJson.some((value) => containsKey(value, excludedKey)), false, excludedKey);
  }
});

test('writeSiteContentBackup enforces caller-visible bounds before publishing output', () => {
  const corpusRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'site-content-backup-bound-'));
  const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), 'site-content-backup-bound-output-'));
  writePage(corpusRoot, 'en', 'bounded', {
    entityId: '23232323-2323-4323-8323-232323232323',
    source: 'bounded page source',
  });

  const pageBoundOutput = path.join(outputParent, 'page-bound');
  assert.throws(
    () => writeSiteContentBackup({
      corpusRoot,
      branch: 'en',
      outputRoot: pageBoundOutput,
      limits: { maxPages: 0 },
    }),
    /exceeds page bound/u,
  );
  assert.equal(fs.existsSync(pageBoundOutput), false);

  const byteBoundOutput = path.join(outputParent, 'byte-bound');
  assert.throws(
    () => writeSiteContentBackup({
      corpusRoot,
      branch: 'en',
      outputRoot: byteBoundOutput,
      limits: { maxContentBytes: 1 },
    }),
    /exceeds content-byte bound/u,
  );
  assert.equal(fs.existsSync(byteBoundOutput), false);
});

test('writeSiteContentBackup never publishes a partial bundle when source bytes drift', () => {
  const corpusRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'site-content-backup-drift-'));
  const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), 'site-content-backup-drift-output-'));
  writePage(corpusRoot, 'en', 'drifted', {
    entityId: '24242424-2424-4424-8424-242424242424',
    source: 'original source',
  });

  const sourcePath = path.join(corpusRoot, 'en', 'pages', 'drifted', 'source.wikidot.txt');
  const outputRoot = path.join(outputParent, 'backup');
  const originalRead = fs.readFileSync;
  let sourceReads = 0;
  try {
    fs.readFileSync = function patchedRead(filePath, ...args) {
      if (path.resolve(String(filePath)) === path.resolve(sourcePath)) {
        sourceReads += 1;
        if (sourceReads >= 2) return Buffer.from('changed after manifest');
      }
      return originalRead.call(this, filePath, ...args);
    };
    assert.throws(
      () => writeSiteContentBackup({ corpusRoot, branch: 'en', outputRoot }),
      /source changed while creating site content backup/u,
    );
  } finally {
    fs.readFileSync = originalRead;
  }
  assert.equal(fs.existsSync(outputRoot), false);
  assert.deepEqual(
    fs.readdirSync(outputParent).filter((name) => name.includes('.staging-')),
    [],
  );
});
