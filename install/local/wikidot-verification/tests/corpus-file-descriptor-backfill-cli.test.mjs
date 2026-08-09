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
import {
  fakeDockerSource,
  requiredArgs,
  runtimeArgs,
  runtimeInspections,
  startFakeRuntimeServer,
  TEST_RUNTIME_IDENTITY,
  writeCompleteCorpus,
} from './support/corpus-file-descriptor-backfill-cli-fixture.mjs';

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

test('standing descriptor backfill CLI requires and normalizes its resume receipt', () => {
  withS3Secret(() => {
    assert.throws(
      () => parseArgs(requiredArgs([
        '--receipt', 'evidence/file-descriptor-backfill.json',
      ], { runtimeIdentity: null })),
      /--runtime-identity is required/,
    );
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
    assert.equal(parsed.runtimeIdentity, path.resolve('/srv/runtime-identity.json'));
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
  assert.match(usage(), /--runtime-identity <path>/u);
  assert.match(usage(), /--site-id 6000006/u);
  assert.match(usage(), /--site-slug scp-wiki/u);
});

test('standing descriptor backfill rejects a live Deepwell image outside the sealed runtime identity before SQL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-descriptor-runtime-'));
  const branchRoot = path.join(root, 'corpus', 'en');
  fs.mkdirSync(path.join(branchRoot, 'by-uuid'), { recursive: true });
  fs.writeFileSync(path.join(branchRoot, 'index.json'), '{}\n');
  const identityPath = path.join(root, 'runtime-identity.json');
  fs.writeFileSync(identityPath, `${JSON.stringify(TEST_RUNTIME_IDENTITY)}\n`);
  const binRoot = path.join(root, 'bin');
  const sqlLog = path.join(root, 'sql.log');
  fs.mkdirSync(binRoot);
  const fakeDocker = path.join(binRoot, 'docker');
  fs.writeFileSync(fakeDocker, fakeDockerSource(`
fs.appendFileSync(process.env.FAKE_SQL_LOG, sql);
throw new Error('SQL must not run after runtime identity drift');`));
  fs.chmodSync(fakeDocker, 0o755);
  const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const result = spawnSync(process.execPath, [
    path.join(packageRoot, 'scripts/backfill-corpus-file-descriptors.mjs'),
    '--corpus-root', path.join(root, 'corpus'),
    '--site-id', '6000006',
    '--site-slug', 'scp-wiki',
    '--db-container', 'fake-database',
    ...runtimeArgs(identityPath),
    '--receipt', path.join(root, 'receipt.json'),
  ], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binRoot}:${process.env.PATH}`,
      FAKE_DOCKER_INSPECTIONS: JSON.stringify(runtimeInspections({
        deepwellImage: `sha256:${'8'.repeat(64)}`,
      })),
      FAKE_SQL_LOG: sqlLog,
    },
    maxBuffer: 1024 * 1024,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Deepwell image does not match the sealed runtime identity/u);
  assert.equal(fs.existsSync(sqlLog), false);
});

test('standing descriptor backfill revalidates its sealed runtime binding before accepting a completed receipt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-descriptor-complete-runtime-'));
  const branchRoot = path.join(root, 'corpus', 'en');
  fs.mkdirSync(path.join(branchRoot, 'by-uuid'), { recursive: true });
  fs.writeFileSync(path.join(branchRoot, 'index.json'), '{}\n');
  const identityPath = path.join(root, 'runtime-identity.json');
  fs.writeFileSync(identityPath, `${JSON.stringify(TEST_RUNTIME_IDENTITY)}\n`);
  const binRoot = path.join(root, 'bin');
  const receipt = path.join(root, 'receipt.json');
  const inspectCount = path.join(root, 'inspect-count');
  fs.mkdirSync(binRoot);
  const fakeDocker = path.join(binRoot, 'docker');
  fs.writeFileSync(fakeDocker, fakeDockerSource(`
if (sql.includes("'active_files', count(*)")) {
  process.stdout.write(JSON.stringify({
    active_files: 0,
    missing_latest_revision: 0,
    missing_descriptor: 0,
    invalid_descriptor: 0,
    pending_blobs: 0,
    unmoved_pending_blobs: 0,
    moved_pending_blobs: 0,
    moved_pending_missing_descriptor: 0,
  }) + '\\n');
}`));
  fs.chmodSync(fakeDocker, 0o755);
  const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const command = [
    path.join(packageRoot, 'scripts/backfill-corpus-file-descriptors.mjs'),
    '--corpus-root', path.join(root, 'corpus'),
    '--site-id', '6000006',
    '--site-slug', 'scp-wiki',
    '--db-container', 'fake-database',
    ...runtimeArgs(identityPath),
    '--receipt', receipt,
  ];
  const baseEnvironment = {
    ...process.env,
    PATH: `${binRoot}:${process.env.PATH}`,
    FAKE_DOCKER_INSPECTIONS: JSON.stringify(runtimeInspections()),
    FAKE_DOCKER_INSPECT_COUNT: inspectCount,
    S3_FILES_BUCKET: 'wikijump-files',
    S3_ACCESS_KEY_ID: 'local-access',
    S3_SECRET_ACCESS_KEY: 'test-secret',
  };
  const completed = spawnSync(process.execPath, command, {
    cwd: packageRoot,
    encoding: 'utf8',
    env: baseEnvironment,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(completed.status, 0, completed.stderr);
  assert.equal(JSON.parse(fs.readFileSync(receipt, 'utf8')).status, 'done');

  fs.writeFileSync(inspectCount, '');
  const changed = runtimeInspections();
  changed['fake-database'].Config.Env = ['FIXTURE_ROLE=database', 'DRIFTED=true'];
  const replayed = spawnSync(process.execPath, command, {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...baseEnvironment,
      FAKE_DOCKER_INSPECTIONS_AFTER: JSON.stringify(changed),
    },
    maxBuffer: 1024 * 1024,
  });

  assert.notEqual(replayed.status, 0);
  assert.match(replayed.stderr, /standing runtime binding changed/u);
});

test('standing descriptor backfill rescans every descriptor and active latest revision before completion', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-descriptor-revision-drift-'));
  const bytes = Buffer.from('sealed descriptor bytes');
  const corpus = writeCompleteCorpus(root, bytes);
  const runtimeServer = await startFakeRuntimeServer(root, bytes);
  t.after(() => runtimeServer.child.kill('SIGTERM'));
  const identityPath = path.join(root, 'runtime-identity.json');
  fs.writeFileSync(identityPath, `${JSON.stringify(TEST_RUNTIME_IDENTITY)}\n`);
  const binRoot = path.join(root, 'bin');
  const statePath = path.join(root, 'docker-state.json');
  const receipt = path.join(root, 'receipt.json');
  fs.mkdirSync(binRoot);
  const fakeDocker = path.join(binRoot, 'docker');
  fs.writeFileSync(fakeDocker, fakeDockerSource(`
const statePath = process.env.FAKE_DOCKER_STATE;
const state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
  : {inventory_starts: 0, staged: false};
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
if (sql.includes('planned_attachments')) {
  state.staged = true;
  save();
  process.stdout.write(JSON.stringify({
    row_index: 0,
    fullname: 'scp-049',
    filename: 'fixture.bin',
    action: 'backfill_descriptor',
    reason: null,
    page_id: 49,
    file_id: 4901,
    revision_number: 0,
  }) + '\\n');
} else if (sql.includes("'active_files', count(*)")) {
  process.stdout.write(JSON.stringify({
    active_files: 1,
    missing_latest_revision: 0,
    missing_descriptor: state.staged ? 0 : 1,
    invalid_descriptor: 0,
    pending_blobs: 0,
    unmoved_pending_blobs: 0,
    moved_pending_blobs: 0,
    moved_pending_missing_descriptor: 0,
  }) + '\\n');
} else if (sql.includes("'page_id', p.page_id") && !sql.includes('AND (p.slug, f.file_id, latest.revision_id) >')) {
  state.inventory_starts += 1;
  const row = JSON.parse(process.env.FAKE_INVENTORY_ROW);
  if (state.staged) {
    row.content_type_label = 'ASCII text';
    row.content_type_description = 'ASCII text, with no line terminators';
  }
  if (state.inventory_starts >= 4 && process.env.FAKE_FINAL_REVISION_DRIFT === 'true') {
    row.revision_id += 1;
  }
  if (state.inventory_starts >= 4 && process.env.FAKE_FINAL_DESCRIPTOR_DRIFT === 'true') {
    row.content_type_description = 'ASCII text, drifted descriptor';
  }
  save();
  process.stdout.write(JSON.stringify(row) + '\\n');
}`));
  fs.chmodSync(fakeDocker, 0o755);
  const inventoryRow = {
    page_id: 49,
    page_category_id: 1,
    fullname: corpus.fullname,
    file_id: 4901,
    revision_id: 4902,
    filename: corpus.filename,
    size: bytes.byteLength,
    s3_key_hex: crypto.createHash('sha512').update(bytes).digest('hex'),
    content_type_label: null,
    content_type_description: null,
  };
  const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const command = (receiptPath) => [
    path.join(packageRoot, 'scripts/backfill-corpus-file-descriptors.mjs'),
    '--corpus-root', path.dirname(corpus.branchRoot),
    '--site-id', '6000006',
    '--site-slug', 'scp-wiki',
    '--db-container', 'fake-database',
    ...runtimeArgs(identityPath, {
      deepwellHostPort: runtimeServer.ports.deepwell,
      filesHostPort: runtimeServer.ports.files,
    }),
    '--batch-size', '1',
    '--receipt', receiptPath,
  ];
  const environment = {
    ...process.env,
    PATH: `${binRoot}:${process.env.PATH}`,
    FAKE_DOCKER_INSPECTIONS: JSON.stringify(runtimeInspections({
      deepwellHostPort: runtimeServer.ports.deepwell,
      filesHostPort: runtimeServer.ports.files,
    })),
    FAKE_DOCKER_STATE: statePath,
    FAKE_INVENTORY_ROW: JSON.stringify(inventoryRow),
    S3_FILES_BUCKET: 'wikijump-files',
    S3_ACCESS_KEY_ID: 'local-access',
    S3_SECRET_ACCESS_KEY: 'test-secret',
    DEEPWELL_RPC_TOKEN: '9'.repeat(64),
  };
  const result = spawnSync(process.execPath, command(receipt), {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...environment,
      FAKE_FINAL_REVISION_DRIFT: 'true',
    },
    maxBuffer: 1024 * 1024,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /active file inventory changed after sealed preflight batch 0/u);
  const recorded = JSON.parse(fs.readFileSync(receipt, 'utf8'));
  assert.equal(recorded.status, 'blocked');
  assert.notEqual(recorded.status, 'done');

  const successfulReceipt = path.join(root, 'successful-receipt.json');
  const successful = spawnSync(process.execPath, command(successfulReceipt), {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...environment,
      FAKE_DOCKER_STATE: path.join(root, 'successful-docker-state.json'),
    },
    maxBuffer: 1024 * 1024,
  });
  assert.equal(successful.status, 0, successful.stderr);
  const completed = JSON.parse(fs.readFileSync(successfulReceipt, 'utf8'));
  assert.doesNotMatch(fs.readFileSync(successfulReceipt, 'utf8'), /must-not-leak/u);
  assert.equal(completed.status, 'done');
  assert.deepEqual(completed.completion_inventory, {
    batches_verified: 1,
    rows_verified: 1,
    descriptor_plans_verified: 1,
    sealed_plan_set_sha256: completed.completion_inventory.sealed_plan_set_sha256,
  });
  assert.match(completed.completion_inventory.sealed_plan_set_sha256, /^[0-9a-f]{64}$/u);

  const descriptorReceipt = path.join(root, 'descriptor-drift-receipt.json');
  const descriptorDrift = spawnSync(process.execPath, command(descriptorReceipt), {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...environment,
      FAKE_DOCKER_STATE: path.join(root, 'descriptor-drift-docker-state.json'),
      FAKE_FINAL_DESCRIPTOR_DRIFT: 'true',
    },
    maxBuffer: 1024 * 1024,
  });
  assert.notEqual(descriptorDrift.status, 0);
  assert.match(descriptorDrift.stderr, /active file descriptors do not match sealed corpus plan batch 0/u);
  assert.equal(JSON.parse(fs.readFileSync(descriptorReceipt, 'utf8')).status, 'blocked');
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
  fs.writeFileSync(fakeDocker, fakeDockerSource(`
fs.appendFileSync(process.env.FAKE_SQL_LOG, sql + '\\n-- query boundary --\\n');
if (sql.includes("'active_files', count(*)")) {
  process.stdout.write(process.env.FAKE_COMPLETION_ROW + '\\n');
} else if (sql.includes("'page_id', p.page_id") && !sql.includes('AND (p.slug, f.file_id, latest.revision_id) >')) {
  process.stdout.write(process.env.FAKE_INVENTORY_ROW + '\\n');
}
`));
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
    content_type_label: null,
    content_type_description: null,
  };
  const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const identityPath = path.join(root, 'runtime-identity.json');
  fs.writeFileSync(identityPath, `${JSON.stringify(TEST_RUNTIME_IDENTITY)}\n`);
  const command = [
    path.join(packageRoot, 'scripts/backfill-corpus-file-descriptors.mjs'),
    '--corpus-root', path.join(root, 'corpus'),
    '--site-id', '6000006',
    '--site-slug', 'scp-wiki',
    '--db-container', 'fake-database',
    ...runtimeArgs(identityPath),
    '--batch-size', '1',
    '--receipt', receipt,
  ];
  const environment = {
    ...process.env,
    PATH: `${binRoot}:${process.env.PATH}`,
    FAKE_SQL_LOG: sqlLog,
    FAKE_INVENTORY_ROW: JSON.stringify(inventoryRow),
    FAKE_DOCKER_INSPECTIONS: JSON.stringify(runtimeInspections()),
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
  };
  const result = spawnSync(process.execPath, command, {
    cwd: packageRoot,
    encoding: 'utf8',
    env: environment,
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

  const sqlBytes = fs.statSync(sqlLog).size;
  const drifted = runtimeInspections();
  drifted['fake-database'].Image = `sha256:${'8'.repeat(64)}`;
  const resumed = spawnSync(process.execPath, command, {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...environment,
      FAKE_DOCKER_INSPECTIONS: JSON.stringify(drifted),
    },
    maxBuffer: 1024 * 1024,
  });
  assert.notEqual(resumed.status, 0);
  assert.match(resumed.stderr, /standing runtime binding changed after the backfill receipt was sealed/u);
  assert.equal(fs.statSync(sqlLog).size, sqlBytes, 'resume drift must fail before another SQL transaction');
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
  fs.writeFileSync(fakeDocker, fakeDockerSource(`
fs.appendFileSync(process.env.FAKE_SQL_LOG, sql + '\\n-- query boundary --\\n');
if (sql.includes("'active_files', count(*)")) {
  process.stdout.write(process.env.FAKE_COMPLETION_ROW + '\\n');
} else if (sql.includes("'page_id', p.page_id")) {
  throw new Error('inventory must not run after the orphan baseline blocker');
}
`));
  fs.chmodSync(fakeDocker, 0o755);
  const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const identityPath = path.join(root, 'runtime-identity.json');
  fs.writeFileSync(identityPath, `${JSON.stringify(TEST_RUNTIME_IDENTITY)}\n`);
  const result = spawnSync(process.execPath, [
    path.join(packageRoot, 'scripts/backfill-corpus-file-descriptors.mjs'),
    '--corpus-root', path.join(root, 'corpus'),
    '--site-id', '6000006',
    '--site-slug', 'scp-wiki',
    '--db-container', 'fake-database',
    ...runtimeArgs(identityPath),
    '--batch-size', '1',
    '--receipt', receipt,
  ], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binRoot}:${process.env.PATH}`,
      FAKE_SQL_LOG: sqlLog,
      FAKE_DOCKER_INSPECTIONS: JSON.stringify(runtimeInspections()),
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
