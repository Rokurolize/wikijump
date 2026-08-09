import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildFileDescriptorBackfillStagingSql,
  parseArgs,
  usage,
} from '../scripts/backfill-corpus-file-descriptors.mjs';
import { parseAttachmentStagingResults } from '../src/corpus-attachment-staging-sql.mjs';

function withS3Secret(callback) {
  const previous = process.env.S3_SECRET_ACCESS_KEY;
  process.env.S3_SECRET_ACCESS_KEY = 'test-secret';
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.S3_SECRET_ACCESS_KEY;
    else process.env.S3_SECRET_ACCESS_KEY = previous;
  }
}

function requiredArgs(extra = []) {
  return [
    '--corpus-root', '/srv/corpus',
    '--attachment-s3-endpoint', 'http://127.0.0.1:9000',
    '--attachment-s3-bucket', 'wikijump-files',
    '--attachment-s3-access-key-id', 'local-access',
    ...extra,
  ];
}

test('standing descriptor backfill CLI requires and normalizes its resume receipt', () => {
  withS3Secret(() => {
    assert.throws(
      () => parseArgs(requiredArgs()),
      /--receipt is required/,
    );
    const parsed = parseArgs(requiredArgs([
      '--receipt', 'evidence/file-descriptor-backfill.json',
      '--batch-size', '25',
      '--concurrency', '4',
    ]));
    assert.equal(parsed.receipt, path.resolve('evidence/file-descriptor-backfill.json'));
    assert.equal(parsed.siteId, 6000006);
    assert.equal(parsed.siteSlug, 'scp-wiki');
    assert.equal(parsed.batchSize, 25);
    assert.equal(parsed.concurrency, 4);
  });
});

test('standing descriptor backfill CLI permits a receipt-free dry run and refuses remote RPC', () => {
  withS3Secret(() => {
    assert.equal(parseArgs(requiredArgs(['--dry-run'])).receipt, null);
    assert.throws(
      () => parseArgs(requiredArgs([
        '--dry-run',
        '--api-url', 'https://runtime.example.test/jsonrpc',
      ])),
      /loopback host/,
    );
  });
  assert.match(usage(), /--receipt <path>/u);
  assert.match(usage(), /--site-id 6000006/u);
  assert.match(usage(), /--site-slug scp-wiki/u);
});

test('standing descriptor backfill cannot recreate a file that disappears after inventory', () => {
  const sql = buildFileDescriptorBackfillStagingSql({
    siteId: 6000006,
    userId: -1,
    attachments: [{
      fullname: 'scp-049',
      filename: '049D.jpg',
      sha256: 'a'.repeat(64),
      size: 180296,
      s3_key_hex: 'b'.repeat(128),
      mime: 'image/jpeg',
      content_type_label: 'JPEG image data',
      content_type_description: 'JPEG image data, EXIF standard',
      replace_existing_descriptor: true,
    }],
  });
  assert.match(sql, /WHEN af\.active_file_count = 0 THEN 'fail_closed'/u);
  assert.match(sql, /WHEN af\.active_file_count = 0 THEN 'missing_existing_file'/u);
  assert.doesNotMatch(sql, /ELSE 'insert'/u);

  const disappeared = parseAttachmentStagingResults('{"row_index":0,"fullname":"scp-049","filename":"049D.jpg","action":"fail_closed","reason":"missing_existing_file","page_id":49,"file_id":null,"revision_number":null}');
  assert.equal(disappeared.summary.insert, 0);
  assert.equal(disappeared.summary.fail_closed, 1);
});

test('standing descriptor backfill blocks all writes before materialization when metadata provenance is incomplete', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-descriptor-cli-'));
  const branchRoot = path.join(root, 'corpus', 'en');
  const entityId = '11111111-1111-4111-8111-111111111111';
  const snapshotRoot = path.join(branchRoot, 'by-uuid', entityId, 'files', 'fixture', 'snapshots');
  fs.mkdirSync(snapshotRoot, { recursive: true });
  fs.writeFileSync(path.join(branchRoot, 'index.json'), '{}\n');
  fs.writeFileSync(path.join(snapshotRoot, 'snapshot.json'), JSON.stringify({
    bytes_sha256: `sha256:${'a'.repeat(64)}`,
    filename: 'different.bin',
    metadata: {
      mime_description: 'data',
      mime_type: 'application/octet-stream',
      size: 7,
    },
    page: 'scp-049',
  }));

  const binRoot = path.join(root, 'bin');
  const sqlLog = path.join(root, 'sql.log');
  const receipt = path.join(root, 'receipt.json');
  fs.mkdirSync(binRoot);
  const fakeDocker = path.join(binRoot, 'docker');
  fs.writeFileSync(fakeDocker, `#!/usr/bin/env node
const fs = require('node:fs');
const sql = fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.FAKE_SQL_LOG, sql + '\\n-- query boundary --\\n');
if (sql.includes("'active_files', count(*)")) {
  process.stdout.write(process.env.FAKE_COMPLETION_ROW + '\\n');
} else if (sql.includes("'page_id', p.page_id") && !sql.includes('AND (p.slug, f.file_id, latest.revision_id) >')) {
  process.stdout.write(process.env.FAKE_INVENTORY_ROW + '\\n');
}
`);
  fs.chmodSync(fakeDocker, 0o755);
  const bytes = Buffer.from('missing');
  const inventoryRow = {
    page_id: 49,
    page_category_id: 1,
    fullname: 'scp-049',
    file_id: 4901,
    revision_id: 4902,
    filename: 'missing.bin',
    size: bytes.byteLength,
    s3_key_hex: crypto.createHash('sha512').update(bytes).digest('hex'),
  };
  const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const result = spawnSync(process.execPath, [
    path.join(packageRoot, 'scripts/backfill-corpus-file-descriptors.mjs'),
    '--corpus-root', path.join(root, 'corpus'),
    '--site-id', '6000006',
    '--site-slug', 'scp-wiki',
    '--db-container', 'fake-database',
    '--batch-size', '1',
    '--receipt', receipt,
  ], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binRoot}:${process.env.PATH}`,
      FAKE_SQL_LOG: sqlLog,
      FAKE_INVENTORY_ROW: JSON.stringify(inventoryRow),
      FAKE_COMPLETION_ROW: JSON.stringify({
        active_files: 1,
        missing_latest_revision: 0,
        missing_descriptor: 1,
        invalid_descriptor: 0,
        pending_blobs: 0,
        unmoved_pending_blobs: 0,
        moved_pending_blobs: 0,
        moved_pending_missing_descriptor: 0,
      }),
      S3_CUSTOM_ENDPOINT: '',
      S3_FILES_BUCKET: '',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
    },
    maxBuffer: 1024 * 1024,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /metadata preflight found 1 active file rows/u);
  const sql = fs.readFileSync(sqlLog, 'utf8');
  assert.doesNotMatch(sql, /planned_attachments|content_type_label =/u);
  const recorded = JSON.parse(fs.readFileSync(receipt, 'utf8'));
  assert.equal(recorded.status, 'blocked');
  assert.equal(recorded.phase, 'metadata_preflight');
  assert.equal(recorded.preflight.rows_scanned, 1);
  assert.equal(recorded.preflight.provenance_matched, 0);
  assert.equal(recorded.preflight.provenance_missing, 1);
  assert.deepEqual(recorded.staging, {
    total: 0,
    insert: 0,
    backfill_descriptor: 0,
    replace_descriptor: 0,
    skip_existing: 0,
    fail_closed: 0,
  });
  assert.equal(recorded.public_pages_rerendered, 0);
});

test('standing descriptor backfill blocks an active orphan before inventory or materialization', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-descriptor-orphan-'));
  const branchRoot = path.join(root, 'corpus', 'en');
  fs.mkdirSync(path.join(branchRoot, 'by-uuid'), { recursive: true });
  fs.writeFileSync(path.join(branchRoot, 'index.json'), '{}\n');
  const binRoot = path.join(root, 'bin');
  const sqlLog = path.join(root, 'sql.log');
  const receipt = path.join(root, 'receipt.json');
  fs.mkdirSync(binRoot);
  const fakeDocker = path.join(binRoot, 'docker');
  fs.writeFileSync(fakeDocker, `#!/usr/bin/env node
const fs = require('node:fs');
const sql = fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.FAKE_SQL_LOG, sql + '\\n-- query boundary --\\n');
if (sql.includes("'active_files', count(*)")) {
  process.stdout.write(process.env.FAKE_COMPLETION_ROW + '\\n');
} else if (sql.includes("'page_id', p.page_id")) {
  throw new Error('inventory must not run after the orphan baseline blocker');
}
`);
  fs.chmodSync(fakeDocker, 0o755);
  const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const result = spawnSync(process.execPath, [
    path.join(packageRoot, 'scripts/backfill-corpus-file-descriptors.mjs'),
    '--corpus-root', path.join(root, 'corpus'),
    '--site-id', '6000006',
    '--site-slug', 'scp-wiki',
    '--db-container', 'fake-database',
    '--batch-size', '1',
    '--receipt', receipt,
  ], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binRoot}:${process.env.PATH}`,
      FAKE_SQL_LOG: sqlLog,
      FAKE_COMPLETION_ROW: JSON.stringify({
        active_files: 1,
        missing_latest_revision: 1,
        missing_descriptor: 0,
        invalid_descriptor: 0,
        pending_blobs: 0,
        unmoved_pending_blobs: 0,
        moved_pending_blobs: 0,
        moved_pending_missing_descriptor: 0,
      }),
    },
    maxBuffer: 1024 * 1024,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /baseline has 1 active files without a latest revision/u);
  const sql = fs.readFileSync(sqlLog, 'utf8');
  assert.doesNotMatch(sql, /'page_id', p\.page_id|planned_attachments|content_type_label =/u);
  const recorded = JSON.parse(fs.readFileSync(receipt, 'utf8'));
  assert.equal(recorded.status, 'blocked');
  assert.equal(recorded.phase, 'metadata_preflight');
  assert.equal(recorded.preflight.baseline.active_files, 1);
  assert.equal(recorded.preflight.baseline.missing_latest_revision, 1);
  assert.equal(recorded.preflight.rows_scanned, 0);
  assert.equal(recorded.staging.total, 0);
  assert.equal(recorded.public_pages_rerendered, 0);
});
