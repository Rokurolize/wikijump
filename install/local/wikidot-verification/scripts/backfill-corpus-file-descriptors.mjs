#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { runCliIfMain } from '../src/cli-entry.mjs';
import { createHttpObjectStoreClient } from '../src/corpus-attachment-object-store.mjs';
import {
  buildFileDescriptorCompletionSql,
  buildFileDescriptorInventorySql,
  hashCurrentFileDescriptorPlan,
  hashFileDescriptorInventory,
  inspectCorpusFileDescriptorSnapshots,
  parseFileDescriptorCompletion,
  parseFileDescriptorInventory,
  planCorpusFileDescriptorBackfill,
  preflightCorpusFileDescriptorBatch,
  preflightCorpusFileDescriptorMetadataBatch,
  readCorpusFileDescriptorProvenance,
} from '../src/corpus-file-descriptor-backfill.mjs';
import {
  buildAttachmentStagingSql,
  parseAttachmentStagingResults,
} from '../src/corpus-attachment-staging-sql.mjs';
import { createSqlExecutor } from '../src/corpus-import-sql.mjs';
import { deepwellRpcAuthorization } from '../src/deepwell-rpc-auth.mjs';
import {
  assertFileDescriptorRuntimeBinding,
  observeFileDescriptorRuntimeBinding,
  readFileDescriptorRuntimeIdentity,
} from '../src/corpus-file-descriptor-runtime-identity.mjs';

const DEFAULT_API_URL = 'http://127.0.0.1:12747/jsonrpc';
const DEFAULT_DB_CONTAINER = 'wikijump-standing-database-1';
const DEFAULT_S3_ENDPOINT = 'http://127.0.0.1:19000';
const DEFAULT_SITE_ID = 6000006;
const DEFAULT_SITE_SLUG = 'scp-wiki';
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_CONCURRENCY = 16;
const DEFAULT_RPC_TIMEOUT_MS = 120_000;
const DEFAULT_DEEPWELL_CONTAINER = 'wikijump-standing-deepwell-1';
const DEFAULT_FILES_CONTAINER = 'wikijump-standing-files-1';
const REVISION_COMMENTS = 'provenance-backed Wikidot file content descriptor backfill';

function envString(name) {
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
}

function parseBoolean(value, label) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${label} must be true or false`);
}

export function usage() {
  return 'Usage: backfill-corpus-file-descriptors.mjs --corpus-root <path> --runtime-identity <path> [--branch en] [--site-id 6000006] [--site-slug scp-wiki] [--db-container <container>] [--deepwell-container <container>] [--files-container <container>] [--api-url <loopback-jsonrpc>] [--attachment-s3-endpoint <loopback-url>] [--attachment-s3-bucket <bucket>] [--attachment-s3-access-key-id <key>] [--attachment-s3-region <region>] [--attachment-s3-path-style true|false] [--batch-size 200] [--concurrency 16] --receipt <path> [--dry-run]';
}

export function parseArgs(argv) {
  const args = {
    corpusRoot: null,
    runtimeIdentity: null,
    branch: 'en',
    siteId: DEFAULT_SITE_ID,
    siteSlug: DEFAULT_SITE_SLUG,
    userId: -1,
    dbUrl: process.env.DEEPWELL_VERIFY_DB_URL ?? null,
    dbContainer: DEFAULT_DB_CONTAINER,
    deepwellContainer: DEFAULT_DEEPWELL_CONTAINER,
    filesContainer: DEFAULT_FILES_CONTAINER,
    apiUrl: DEFAULT_API_URL,
    rpcTimeoutMs: DEFAULT_RPC_TIMEOUT_MS,
    s3Endpoint: envString('S3_CUSTOM_ENDPOINT') ?? DEFAULT_S3_ENDPOINT,
    s3Bucket: envString('S3_FILES_BUCKET'),
    s3AccessKeyId: envString('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: envString('S3_SECRET_ACCESS_KEY'),
    s3Region: envString('S3_REGION_NAME') ?? 'local',
    s3PathStyle: envString('S3_PATH_STYLE') === null
      ? true
      : parseBoolean(envString('S3_PATH_STYLE'), 'S3_PATH_STYLE'),
    batchSize: DEFAULT_BATCH_SIZE,
    concurrency: DEFAULT_CONCURRENCY,
    receipt: null,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === '--corpus-root') args.corpusRoot = next();
    else if (arg === '--runtime-identity') args.runtimeIdentity = next();
    else if (arg === '--branch') args.branch = next();
    else if (arg === '--site-id') args.siteId = Number.parseInt(next(), 10);
    else if (arg === '--site-slug') args.siteSlug = next();
    else if (arg === '--user-id') args.userId = Number.parseInt(next(), 10);
    else if (arg === '--db-container') args.dbContainer = next();
    else if (arg === '--deepwell-container') args.deepwellContainer = next();
    else if (arg === '--files-container') args.filesContainer = next();
    else if (arg === '--api-url') args.apiUrl = next();
    else if (arg === '--rpc-timeout-ms') args.rpcTimeoutMs = Number.parseInt(next(), 10);
    else if (arg === '--attachment-s3-endpoint') args.s3Endpoint = next();
    else if (arg === '--attachment-s3-bucket') args.s3Bucket = next();
    else if (arg === '--attachment-s3-access-key-id') args.s3AccessKeyId = next();
    else if (arg === '--attachment-s3-region') args.s3Region = next();
    else if (arg === '--attachment-s3-path-style') args.s3PathStyle = parseBoolean(next(), arg);
    else if (arg === '--batch-size') args.batchSize = Number.parseInt(next(), 10);
    else if (arg === '--concurrency') args.concurrency = Number.parseInt(next(), 10);
    else if (arg === '--receipt') args.receipt = next();
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') return { help: true };
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (args.corpusRoot === null) throw new Error('--corpus-root is required');
  if (args.runtimeIdentity === null) throw new Error('--runtime-identity is required');
  if (!args.dryRun && args.receipt === null) {
    throw new Error('--receipt is required for a resumable backfill');
  }
  for (const [field, value] of [['siteId', args.siteId], ['userId', args.userId]]) {
    if (!Number.isSafeInteger(value)) throw new Error(`${field} must be a safe integer`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(args.siteSlug)) {
    throw new Error('siteSlug must contain only lowercase ASCII letters, digits, and hyphens');
  }
  for (const [field, value] of [
    ['rpcTimeoutMs', args.rpcTimeoutMs],
    ['batchSize', args.batchSize],
    ['concurrency', args.concurrency],
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive safe integer`);
  }
  const apiUrl = new URL(args.apiUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(apiUrl.hostname)) {
    throw new Error('--api-url must use a loopback host');
  }
  if (args.receipt !== null) args.receipt = path.resolve(args.receipt);
  args.runtimeIdentity = path.resolve(args.runtimeIdentity);
  return args;
}

let rpcSequence = 0;
async function rpc(args, method, params) {
  rpcSequence += 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.rpcTimeoutMs);
  let response;
  try {
    response = await fetch(args.apiUrl, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: deepwellRpcAuthorization(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcSequence, method, params }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`${method} timed out after ${args.rpcTimeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const result = await response.json();
  if (result.error) throw new Error(`${method} failed: ${JSON.stringify(result.error)}`);
  return result.result;
}

function addStagingSummary(total, next) {
  for (const field of ['total', 'insert', 'backfill_descriptor', 'replace_descriptor', 'skip_existing', 'fail_closed']) {
    total[field] += next[field];
  }
}

export function buildFileDescriptorBackfillStagingSql({ siteId, userId, attachments }) {
  return buildAttachmentStagingSql({
    siteId,
    actorUserId: userId,
    attachments,
    revisionComments: REVISION_COMMENTS,
    commit: true,
    requireExisting: true,
  });
}

async function stageDescriptors(args, sqlExecutor, attachments) {
  const summary = { total: 0, insert: 0, backfill_descriptor: 0, replace_descriptor: 0, skip_existing: 0, fail_closed: 0 };
  for (let index = 0; index < attachments.length; index += args.batchSize) {
    const batch = attachments.slice(index, index + args.batchSize);
    const sql = buildFileDescriptorBackfillStagingSql({
      siteId: args.siteId,
      userId: args.userId,
      attachments: batch,
    });
    const parsed = parseAttachmentStagingResults(
      await sqlExecutor.runSql(sql, { capture: true }),
    );
    addStagingSummary(summary, parsed.summary);
    if (parsed.summary.insert > 0 || parsed.summary.fail_closed > 0) {
      const sample = parsed.rows.find((row) => row.action === 'insert' || row.action === 'fail_closed');
      throw new Error(`descriptor backfill inventory changed during staging: ${JSON.stringify(sample)}`);
    }
  }
  return summary;
}

async function rerenderPages(args, pages) {
  let rerendered = 0;
  for (const page of pages) {
    await rpc(args, 'page_rerender', {
      site_id: args.siteId,
      category_id: page.page_category_id,
      page_id: page.page_id,
    });
    rerendered += 1;
  }
  return rerendered;
}

async function fileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function writeReceipt(receiptPath, receipt) {
  if (receiptPath === null) return;
  const absolutePath = path.resolve(receiptPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    fs.renameSync(temporaryPath, absolutePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function initialCheckpoint(args, indexSha256, snapshotDenominator, runtime) {
  return {
    schema: 'wikijump-corpus-file-descriptor-backfill-v3',
    status: 'in_progress',
    phase: 'metadata_preflight',
    site_id: args.siteId,
    site_slug: args.siteSlug,
    corpus: {
      root: path.resolve(args.corpusRoot),
      branch: args.branch,
      index_sha256: indexSha256,
      snapshot_denominator: snapshotDenominator,
    },
    runtime,
    batch_size: args.batchSize,
    cursor: null,
    preflight: {
      baseline: null,
      metadata_batches_completed: 0,
      rows_scanned: 0,
      bytes_scanned: 0,
      provenance_matched: 0,
      provenance_missing: 0,
      byte_batches_completed: 0,
      byte_rows_scanned: 0,
      byte_bytes_scanned: 0,
      byte_provenance_matched: 0,
      byte_provenance_missing: 0,
      batches: [],
    },
    batches_completed: 0,
    rows_completed: 0,
    authority: { corpus_provenance: 0 },
    provenance_blockers: 0,
    staging: { total: 0, insert: 0, backfill_descriptor: 0, replace_descriptor: 0, skip_existing: 0, fail_closed: 0 },
    public_pages_rerendered: 0,
  };
}

function loadCheckpoint(args, indexSha256, snapshotDenominator, runtime) {
  if (args.dryRun || args.receipt === null || !fs.existsSync(args.receipt)) {
    return initialCheckpoint(args, indexSha256, snapshotDenominator, runtime);
  }
  const checkpoint = JSON.parse(fs.readFileSync(args.receipt, 'utf8'));
  const expected = initialCheckpoint(args, indexSha256, snapshotDenominator, runtime);
  if (
    checkpoint.schema !== expected.schema
    || checkpoint.site_id !== expected.site_id
    || checkpoint.site_slug !== expected.site_slug
    || checkpoint.corpus?.root !== expected.corpus.root
    || checkpoint.corpus?.branch !== expected.corpus.branch
    || checkpoint.corpus?.index_sha256 !== expected.corpus.index_sha256
    || JSON.stringify(checkpoint.corpus?.snapshot_denominator) !== JSON.stringify(expected.corpus.snapshot_denominator)
    || checkpoint.batch_size !== expected.batch_size
    || checkpoint.runtime?.identity?.sha256 !== expected.runtime.identity.sha256
    || JSON.stringify(checkpoint.runtime?.identity?.identity) !== JSON.stringify(expected.runtime.identity.identity)
  ) {
    throw new Error(`${args.receipt}: checkpoint identity does not match this backfill invocation`);
  }
  assertFileDescriptorRuntimeBinding(checkpoint.runtime?.binding, runtime.binding);
  if (!['in_progress', 'blocked', 'done'].includes(checkpoint.status)) {
    throw new Error(`${args.receipt}: checkpoint status is invalid`);
  }
  if (!['metadata_preflight', 'byte_preflight', 'materialize', 'done'].includes(checkpoint.phase)) {
    throw new Error(`${args.receipt}: checkpoint phase is invalid`);
  }
  if (checkpoint.cursor !== null && (
    typeof checkpoint.cursor !== 'object'
    || typeof checkpoint.cursor.fullname !== 'string'
    || checkpoint.cursor.fullname.length === 0
    || !Number.isSafeInteger(checkpoint.cursor.file_id)
    || !Number.isSafeInteger(checkpoint.cursor.revision_id)
  )) {
    throw new Error(`${args.receipt}: checkpoint cursor is invalid`);
  }
  for (const field of ['batches_completed', 'rows_completed', 'public_pages_rerendered', 'provenance_blockers']) {
    if (!Number.isSafeInteger(checkpoint[field]) || checkpoint[field] < 0) {
      throw new Error(`${args.receipt}: checkpoint ${field} is invalid`);
    }
  }
  for (const [recordName, fields] of [
    ['authority', ['corpus_provenance']],
    ['staging', ['total', 'insert', 'backfill_descriptor', 'replace_descriptor', 'skip_existing', 'fail_closed']],
  ]) {
    if (checkpoint[recordName] === null || typeof checkpoint[recordName] !== 'object' || Array.isArray(checkpoint[recordName])) {
      throw new Error(`${args.receipt}: checkpoint ${recordName} is invalid`);
    }
    for (const field of fields) {
      if (!Number.isSafeInteger(checkpoint[recordName][field]) || checkpoint[recordName][field] < 0) {
        throw new Error(`${args.receipt}: checkpoint ${recordName}.${field} is invalid`);
      }
    }
  }
  const preflightFields = [
    'metadata_batches_completed',
    'rows_scanned',
    'bytes_scanned',
    'provenance_matched',
    'provenance_missing',
    'byte_batches_completed',
    'byte_rows_scanned',
    'byte_bytes_scanned',
    'byte_provenance_matched',
    'byte_provenance_missing',
  ];
  if (checkpoint.preflight === null || typeof checkpoint.preflight !== 'object' || Array.isArray(checkpoint.preflight)) {
    throw new Error(`${args.receipt}: checkpoint preflight is invalid`);
  }
  if (checkpoint.preflight.baseline !== null) {
    for (const field of [
      'active_files',
      'missing_latest_revision',
      'moved_pending_blobs',
      'moved_pending_missing_descriptor',
    ]) {
      if (!Number.isSafeInteger(checkpoint.preflight.baseline[field]) || checkpoint.preflight.baseline[field] < 0) {
        throw new Error(`${args.receipt}: checkpoint preflight.baseline.${field} is invalid`);
      }
    }
  } else if (checkpoint.phase !== 'metadata_preflight') {
    throw new Error(`${args.receipt}: checkpoint preflight baseline is missing`);
  }
  for (const field of preflightFields) {
    if (!Number.isSafeInteger(checkpoint.preflight[field]) || checkpoint.preflight[field] < 0) {
      throw new Error(`${args.receipt}: checkpoint preflight.${field} is invalid`);
    }
  }
  if (!Array.isArray(checkpoint.preflight.batches) || checkpoint.preflight.batches.length !== checkpoint.preflight.metadata_batches_completed) {
    throw new Error(`${args.receipt}: checkpoint preflight batch identities are invalid`);
  }
  for (const batch of checkpoint.preflight.batches) {
    if (
      batch === null
      || typeof batch !== 'object'
      || !Number.isSafeInteger(batch.rows)
      || batch.rows <= 0
      || typeof batch.inventory_sha256 !== 'string'
      || !/^[0-9a-f]{64}$/u.test(batch.inventory_sha256)
      || !(
        batch.descriptor_plan_sha256 === null
        || /^[0-9a-f]{64}$/u.test(batch.descriptor_plan_sha256)
      )
      || !validCursor(batch.end_cursor)
    ) {
      throw new Error(`${args.receipt}: checkpoint preflight batch identity is invalid`);
    }
  }
  return checkpoint;
}

function addAuthority(total, next) {
  total.corpus_provenance += next.corpus_provenance;
}

function completionFailures(completion, checkpoint) {
  return completion.missing_latest_revision !== 0
    || completion.missing_descriptor !== 0
    || completion.invalid_descriptor !== 0
    || completion.moved_pending_missing_descriptor !== 0
    || checkpoint.provenance_blockers !== 0
    || checkpoint.preflight.provenance_missing !== 0
    || checkpoint.preflight.byte_provenance_missing !== 0
    || checkpoint.preflight.rows_scanned !== completion.active_files
    || checkpoint.preflight.provenance_matched !== completion.active_files
    || checkpoint.preflight.byte_rows_scanned !== completion.active_files
    || checkpoint.preflight.byte_provenance_matched !== completion.active_files
    || checkpoint.preflight.byte_batches_completed !== checkpoint.preflight.batches.length
    || checkpoint.batches_completed !== checkpoint.preflight.batches.length
    || checkpoint.rows_completed !== completion.active_files
    || checkpoint.authority.corpus_provenance !== completion.active_files
    || checkpoint.staging.total !== completion.active_files
    || checkpoint.completion_inventory?.rows_verified !== completion.active_files
    || checkpoint.completion_inventory?.batches_verified !== checkpoint.preflight.batches.length
    || checkpoint.completion_inventory?.descriptor_plans_verified !== checkpoint.preflight.batches.length;
}

function validCursor(cursor) {
  return cursor !== null
    && typeof cursor === 'object'
    && typeof cursor.fullname === 'string'
    && cursor.fullname.length > 0
    && Number.isSafeInteger(cursor.file_id)
    && Number.isSafeInteger(cursor.revision_id);
}

function inventoryCursor(inventory) {
  const last = inventory.at(-1);
  return {
    fullname: last.fullname,
    file_id: last.file_id,
    revision_id: last.revision_id,
  };
}

function sameCursor(left, right) {
  return left.fullname === right.fullname
    && left.file_id === right.file_id
    && left.revision_id === right.revision_id;
}

function inventoryBatchIdentity(inventory) {
  return {
    rows: inventory.length,
    inventory_sha256: hashFileDescriptorInventory(inventory),
    descriptor_plan_sha256: null,
    end_cursor: inventoryCursor(inventory),
  };
}

function requirePreflightBatchIdentity(checkpoint, batchIndex, inventory) {
  const expected = checkpoint.preflight.batches[batchIndex];
  const actual = inventoryBatchIdentity(inventory);
  if (
    expected === undefined
    || expected.rows !== actual.rows
    || expected.inventory_sha256 !== actual.inventory_sha256
    || !sameCursor(expected.end_cursor, actual.end_cursor)
  ) {
    throw new Error(`active file inventory changed after sealed preflight batch ${batchIndex}`);
  }
  return actual.end_cursor;
}

function requirePreflightDescriptorPlan(checkpoint, batchIndex, actualSha256) {
  const expected = checkpoint.preflight.batches[batchIndex]?.descriptor_plan_sha256;
  if (typeof expected !== 'string' || expected !== actualSha256) {
    throw new Error(`active file descriptors do not match sealed corpus plan batch ${batchIndex}`);
  }
}

async function verifyCompletionInventory(checkpoint, loadInventory) {
  let cursor = null;
  let batchIndex = 0;
  let rowsVerified = 0;
  while (true) {
    const inventory = await loadInventory(cursor);
    if (inventory.length === 0) break;
    const nextCursor = requirePreflightBatchIdentity(checkpoint, batchIndex, inventory);
    requirePreflightDescriptorPlan(
      checkpoint,
      batchIndex,
      hashCurrentFileDescriptorPlan(inventory),
    );
    rowsVerified += inventory.length;
    batchIndex += 1;
    cursor = nextCursor;
  }
  if (
    batchIndex !== checkpoint.preflight.batches.length
    || rowsVerified !== checkpoint.preflight.rows_scanned
  ) {
    throw new Error('completion inventory ended before every sealed active latest revision and descriptor plan was verified');
  }
  const planSetHash = crypto.createHash('sha256');
  for (const batch of checkpoint.preflight.batches) {
    planSetHash.update(`${batch.inventory_sha256}\0${batch.descriptor_plan_sha256}\n`);
  }
  return {
    batches_verified: batchIndex,
    rows_verified: rowsVerified,
    descriptor_plans_verified: batchIndex,
    sealed_plan_set_sha256: planSetHash.digest('hex'),
  };
}

function addCoverage(target, summary, prefix = '') {
  const field = (name) => `${prefix}${name}`;
  for (const [name, value] of [
    ['rows_scanned', summary.rows],
    ['bytes_scanned', summary.bytes],
    ['provenance_matched', summary.provenance_matched],
    ['provenance_missing', summary.provenance_missing],
  ]) {
    const next = target[field(name)] + value;
    if (!Number.isSafeInteger(next)) throw new Error(`preflight ${field(name)} exceeds the safe integer range`);
    target[field(name)] = next;
  }
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (args.dbUrl !== null) {
    throw new Error('sealed standing descriptor backfill does not accept DEEPWELL_VERIFY_DB_URL');
  }
  const runtimeIdentity = readFileDescriptorRuntimeIdentity(args.runtimeIdentity);
  const observeRuntimeBinding = () => observeFileDescriptorRuntimeBinding({
    runtimeIdentity: runtimeIdentity.identity,
    databaseContainer: args.dbContainer,
    deepwellContainer: args.deepwellContainer,
    filesContainer: args.filesContainer,
    apiUrl: args.apiUrl,
    s3Endpoint: args.s3Endpoint,
  });
  const runtimeBinding = await observeRuntimeBinding();
  const runtime = {
    identity: runtimeIdentity,
    binding: runtimeBinding,
  };
  const sqlExecutor = createSqlExecutor({
    dbUrl: null,
    dbContainer: runtimeBinding.services.database.container_id,
  });
  try {
    const indexPath = path.resolve(args.corpusRoot, args.branch, 'index.json');
    const indexSha256 = await fileSha256(indexPath);
    const inspectedCorpus = inspectCorpusFileDescriptorSnapshots({
      corpusRoot: args.corpusRoot,
      branch: args.branch,
    });
    const checkpoint = loadCheckpoint(args, indexSha256, inspectedCorpus.denominator, runtime);
    const block = (error, provenanceBlockers = checkpoint.provenance_blockers) => {
      checkpoint.status = 'blocked';
      checkpoint.blocker = error.message;
      checkpoint.provenance_blockers = provenanceBlockers;
      if (!args.dryRun) writeReceipt(args.receipt, checkpoint);
      return error;
    };
    const loadInventory = async (cursor) => {
      try {
        return parseFileDescriptorInventory(await sqlExecutor.runSql(
          buildFileDescriptorInventorySql({
            siteId: args.siteId,
            siteSlug: args.siteSlug,
            cursor,
            limit: args.batchSize,
          }),
          { capture: true },
        ));
      } catch (error) {
        throw block(error);
      }
    };
    const loadCompletion = async () => {
      try {
        return parseFileDescriptorCompletion(await sqlExecutor.runSql(
          buildFileDescriptorCompletionSql(args.siteId, args.siteSlug),
          { capture: true },
        ));
      } catch (error) {
        throw block(error);
      }
    };
    const requireCurrentMaterializationBaseline = async () => {
      const completion = await loadCompletion();
      const baseline = checkpoint.preflight.baseline;
      if (
        baseline === null
        || completion.active_files !== baseline.active_files
        || completion.missing_latest_revision !== 0
        || completion.moved_pending_missing_descriptor !== 0
      ) {
        throw block(new Error(`materialization baseline changed after preflight; staging and rerender were not started: ${JSON.stringify(completion)}`));
      }
    };
    const exactBatchInput = (inventory, objectStore) => ({
      inventory,
      loadProvenance: async (requestedFiles) => readCorpusFileDescriptorProvenance({
        corpusRoot: args.corpusRoot,
        branch: args.branch,
        requestedFiles,
      }),
      getObject: (key) => objectStore.getObject(key),
      concurrency: args.concurrency,
    });
    const printPreflight = (status) => {
      console.log(JSON.stringify({
        schema: checkpoint.schema,
        status,
        phase: checkpoint.phase,
        site_id: checkpoint.site_id,
        site_slug: checkpoint.site_slug,
        corpus: checkpoint.corpus,
        preflight: checkpoint.preflight,
        provenance_blockers: checkpoint.provenance_blockers,
        staging_writes: 0,
        public_rerenders: 0,
      }, null, 2));
    };

    if (checkpoint.status === 'done' && !args.dryRun) {
      const completionInventory = await verifyCompletionInventory(checkpoint, loadInventory);
      if (JSON.stringify(completionInventory) !== JSON.stringify(checkpoint.completion_inventory)) {
        throw new Error('completed checkpoint inventory proof no longer matches its sealed receipt');
      }
      const completion = await loadCompletion();
      if (completionFailures(completion, checkpoint)) {
        throw new Error(`completed checkpoint no longer passes completion proof: ${JSON.stringify(completion)}`);
      }
      assertFileDescriptorRuntimeBinding(
        checkpoint.runtime.binding,
        await observeRuntimeBinding(),
      );
      console.log(JSON.stringify(checkpoint, null, 2));
      return 0;
    }
    checkpoint.status = 'in_progress';
    delete checkpoint.blocker;
    if (!args.dryRun) writeReceipt(args.receipt, checkpoint);

    if (checkpoint.phase === 'metadata_preflight') {
      const currentCompletion = await loadCompletion();
      const currentBaseline = {
        active_files: currentCompletion.active_files,
        missing_latest_revision: currentCompletion.missing_latest_revision,
        moved_pending_blobs: currentCompletion.moved_pending_blobs,
        moved_pending_missing_descriptor: currentCompletion.moved_pending_missing_descriptor,
      };
      if (checkpoint.preflight.baseline === null) {
        checkpoint.preflight.baseline = currentBaseline;
        if (!args.dryRun) writeReceipt(args.receipt, checkpoint);
      } else if (JSON.stringify(checkpoint.preflight.baseline) !== JSON.stringify(currentBaseline)) {
        throw block(new Error('active file or moved-pending baseline changed after the receipt was sealed; start with a new receipt'));
      }
      if (currentBaseline.missing_latest_revision > 0) {
        const error = new Error(`baseline has ${currentBaseline.missing_latest_revision} active files without a latest revision; materialization and rerender were not started`);
        block(error);
        if (args.dryRun) {
          printPreflight('blocked');
          return 1;
        }
        throw error;
      }
      if (currentBaseline.moved_pending_missing_descriptor > 0) {
        const error = new Error(`baseline has ${currentBaseline.moved_pending_missing_descriptor} moved pending blobs without paired descriptor authority; materialization and rerender were not started`);
        block(error);
        if (args.dryRun) {
          printPreflight('blocked');
          return 1;
        }
        throw error;
      }
      let cursor = checkpoint.cursor;
      while (true) {
        const inventory = await loadInventory(cursor);
        if (inventory.length === 0) break;
        const summary = preflightCorpusFileDescriptorMetadataBatch({
          inventory,
          candidates: inspectedCorpus.candidates,
        });
        const identity = inventoryBatchIdentity(inventory);
        checkpoint.preflight.batches.push(identity);
        checkpoint.preflight.metadata_batches_completed += 1;
        addCoverage(checkpoint.preflight, summary);
        checkpoint.cursor = identity.end_cursor;
        cursor = identity.end_cursor;
        if (!args.dryRun) writeReceipt(args.receipt, checkpoint);
      }
      if (checkpoint.preflight.rows_scanned !== currentBaseline.active_files) {
        const error = new Error(`metadata preflight inventory covered ${checkpoint.preflight.rows_scanned} of ${currentBaseline.active_files} active files; materialization and rerender were not started`);
        block(error, Math.abs(currentBaseline.active_files - checkpoint.preflight.rows_scanned));
        if (args.dryRun) {
          printPreflight('blocked');
          return 1;
        }
        throw error;
      }
      checkpoint.provenance_blockers = checkpoint.preflight.provenance_missing;
      if (checkpoint.preflight.provenance_missing > 0) {
        const error = new Error(`metadata preflight found ${checkpoint.preflight.provenance_missing} active file rows without one unambiguous fullname, filename, and size corpus descriptor candidate; materialization and rerender were not started`);
        block(error, checkpoint.preflight.provenance_missing);
        if (args.dryRun) {
          printPreflight('blocked');
          return 1;
        }
        throw error;
      }
      checkpoint.phase = 'byte_preflight';
      checkpoint.cursor = null;
      checkpoint.provenance_blockers = 0;
      if (!args.dryRun) writeReceipt(args.receipt, checkpoint);
    }

    let objectStore;
    try {
      objectStore = createHttpObjectStoreClient({
        endpoint: args.s3Endpoint,
        bucket: args.s3Bucket,
        accessKeyId: args.s3AccessKeyId,
        secretAccessKey: args.s3SecretAccessKey,
        region: args.s3Region,
        pathStyle: args.s3PathStyle,
      });
    } catch (error) {
      throw block(error);
    }

    if (checkpoint.phase === 'byte_preflight') {
      let cursor = checkpoint.cursor;
      while (true) {
        const inventory = await loadInventory(cursor);
        if (inventory.length === 0) break;
        let nextCursor;
        let summary;
        try {
          nextCursor = requirePreflightBatchIdentity(
            checkpoint,
            checkpoint.preflight.byte_batches_completed,
            inventory,
          );
          summary = await preflightCorpusFileDescriptorBatch(
            exactBatchInput(inventory, objectStore),
          );
        } catch (error) {
          throw block(error);
        }
        checkpoint.preflight.batches[
          checkpoint.preflight.byte_batches_completed
        ].descriptor_plan_sha256 = summary.descriptor_plan_sha256;
        checkpoint.preflight.byte_batches_completed += 1;
        addCoverage(checkpoint.preflight, summary, 'byte_');
        checkpoint.cursor = nextCursor;
        cursor = nextCursor;
        if (!args.dryRun) writeReceipt(args.receipt, checkpoint);
      }
      if (
        checkpoint.preflight.byte_batches_completed !== checkpoint.preflight.batches.length
        || checkpoint.preflight.byte_rows_scanned !== checkpoint.preflight.rows_scanned
      ) {
        throw block(new Error('active file inventory ended before every sealed metadata-preflight batch was byte verified'));
      }
      checkpoint.provenance_blockers = checkpoint.preflight.byte_provenance_missing;
      if (checkpoint.preflight.byte_provenance_missing > 0) {
        const error = new Error(`byte preflight found ${checkpoint.preflight.byte_provenance_missing} active file rows without exact stored-byte-matched corpus descriptor provenance; materialization and rerender were not started`);
        block(error, checkpoint.preflight.byte_provenance_missing);
        if (args.dryRun) {
          printPreflight('blocked');
          return 1;
        }
        throw error;
      }
      if (args.dryRun) {
        await requireCurrentMaterializationBaseline();
        printPreflight('planned');
        return 0;
      }
      checkpoint.phase = 'materialize';
      checkpoint.cursor = null;
      checkpoint.provenance_blockers = 0;
      writeReceipt(args.receipt, checkpoint);
    }

    await requireCurrentMaterializationBaseline();
    let cursor = checkpoint.cursor;
    while (true) {
      const inventory = await loadInventory(cursor);
      if (inventory.length === 0) break;
      let nextCursor;
      let plan;
      try {
        nextCursor = requirePreflightBatchIdentity(
          checkpoint,
          checkpoint.batches_completed,
          inventory,
        );
        plan = await planCorpusFileDescriptorBackfill(
          exactBatchInput(inventory, objectStore),
        );
        requirePreflightDescriptorPlan(
          checkpoint,
          checkpoint.batches_completed,
          plan.descriptor_plan_sha256,
        );
      } catch (error) {
        const blockers = Number.isSafeInteger(error.fileDescriptorProvenanceBlockers)
          ? error.fileDescriptorProvenanceBlockers
          : 0;
        throw block(error, blockers);
      }
      checkpoint.provenance_blockers = 0;
      let staging;
      let rerendered;
      try {
        staging = await stageDescriptors(args, sqlExecutor, plan.attachments);
        rerendered = await rerenderPages(args, plan.pages);
      } catch (error) {
        throw block(error);
      }
      checkpoint.batches_completed += 1;
      checkpoint.rows_completed += inventory.length;
      addAuthority(checkpoint.authority, plan.authority);
      addStagingSummary(checkpoint.staging, staging);
      checkpoint.public_pages_rerendered += rerendered;
      checkpoint.cursor = nextCursor;
      checkpoint.last_batch = {
        rows: inventory.length,
        unique_objects: plan.unique_objects,
        pages_rerendered: rerendered,
      };
      writeReceipt(args.receipt, checkpoint);
      cursor = nextCursor;
    }
    try {
      checkpoint.completion_inventory = await verifyCompletionInventory(
        checkpoint,
        loadInventory,
      );
    } catch (error) {
      throw block(error);
    }
    checkpoint.completion = parseFileDescriptorCompletion(await sqlExecutor.runSql(
      buildFileDescriptorCompletionSql(args.siteId, args.siteSlug),
      { capture: true },
    ));
    if (completionFailures(checkpoint.completion, checkpoint)) {
      checkpoint.status = 'blocked';
      checkpoint.blocker = `file descriptor completion proof failed: ${JSON.stringify(checkpoint.completion)}`;
      writeReceipt(args.receipt, checkpoint);
      throw new Error(checkpoint.blocker);
    }
    try {
      assertFileDescriptorRuntimeBinding(
        checkpoint.runtime.binding,
        await observeRuntimeBinding(),
      );
    } catch (error) {
      throw block(error);
    }
    checkpoint.status = 'done';
    checkpoint.phase = 'done';
    checkpoint.completed_at = new Date().toISOString();
    delete checkpoint.blocker;
    writeReceipt(args.receipt, checkpoint);
    console.log(JSON.stringify(checkpoint, null, 2));
    return 0;
  } finally {
    await sqlExecutor.close();
  }
}

await runCliIfMain(import.meta.url, main, {
  onError: (error) => {
    console.error(error.stack || error.message);
    return 1;
  },
});
