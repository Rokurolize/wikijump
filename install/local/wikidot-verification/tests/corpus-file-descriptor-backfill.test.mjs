import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildFileDescriptorInventorySql,
  buildFileDescriptorCompletionSql,
  hashFileDescriptorInventory,
  inspectCorpusFileDescriptorSnapshots,
  parseFileDescriptorCompletion,
  parseFileDescriptorInventory,
  planCorpusFileDescriptorBackfill,
  preflightCorpusFileDescriptorBatch,
  preflightCorpusFileDescriptorMetadataBatch,
  readCorpusFileDescriptorProvenance,
} from '../src/corpus-file-descriptor-backfill.mjs';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha512(bytes) {
  return crypto.createHash('sha512').update(bytes).digest('hex');
}

function storageName(filename) {
  const digest = crypto.createHash('sha256').update(filename).digest('hex').slice(0, 20);
  const suffix = filename.replace(/[^A-Za-z0-9._-]+/gu, '_').replace(/^[._]+|[._]+$/gu, '') || 'file';
  return `${digest}-${suffix.slice(0, 80)}`;
}

function writeProvenance(root, { fullname, entityId, filename, bytes, description }) {
  const branchRoot = path.join(root, 'en');
  fs.mkdirSync(branchRoot, { recursive: true });
  const indexPath = path.join(branchRoot, 'index.json');
  const index = fs.existsSync(indexPath)
    ? JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    : { entities: {} };
  index.entities[entityId] = { current_fullname: fullname };
  fs.writeFileSync(indexPath, JSON.stringify(index));
  const pageRoot = path.join(branchRoot, 'pages', fullname);
  fs.mkdirSync(pageRoot, { recursive: true });
  fs.writeFileSync(path.join(pageRoot, 'entity_id.txt'), `${entityId}\n`);
  const snapshots = path.join(branchRoot, 'by-uuid', entityId, 'files', storageName(filename), 'snapshots');
  fs.mkdirSync(snapshots, { recursive: true });
  fs.writeFileSync(path.join(snapshots, 'snapshot.json'), JSON.stringify({
    bytes_sha256: `sha256:${sha256(bytes)}`,
    filename,
    metadata: {
      filename,
      mime_description: description,
      mime_type: 'image/jpeg',
      size: bytes.byteLength,
    },
    page: fullname,
  }));
}

test('standing descriptor backfill binds stored bytes to exact corpus provenance', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-descriptor-backfill-'));
  const bytes = Buffer.from('same immutable bytes');
  writeProvenance(root, {
    fullname: 'scp-049',
    entityId: '11111111-1111-4111-8111-111111111111',
    filename: '049D.jpg',
    bytes,
    description: 'JPEG image data, EXIF standard',
  });
  writeProvenance(root, {
    fullname: 'scp-106',
    entityId: '22222222-2222-4222-8222-222222222222',
    filename: 'that man.jpg',
    bytes,
    description: 'JPEG image data, JFIF standard 1.02',
  });
  fs.writeFileSync(path.join(root, 'en', 'index.json'), '{opaque pinned corpus index');
  const inventory = [
    { page_id: 49, page_category_id: 1, fullname: 'scp-049', file_id: 4901, revision_id: 4902, filename: '049D.jpg', size: bytes.byteLength, s3_key_hex: sha512(bytes) },
    { page_id: 106, page_category_id: 1, fullname: 'scp-106', file_id: 10601, revision_id: 10602, filename: 'that man.jpg', size: bytes.byteLength, s3_key_hex: sha512(bytes) },
  ];
  assert.match(hashFileDescriptorInventory(inventory), /^[0-9a-f]{64}$/u);
  assert.notEqual(
    hashFileDescriptorInventory(inventory),
    hashFileDescriptorInventory([{ ...inventory[0], size: inventory[0].size + 1 }, inventory[1]]),
  );
  const unrelatedSnapshots = path.join(root, 'en', 'by-uuid', '11111111-1111-4111-8111-111111111111', 'files', storageName('unrelated.bin'), 'snapshots');
  fs.mkdirSync(unrelatedSnapshots, { recursive: true });
  fs.writeFileSync(path.join(unrelatedSnapshots, 'must-not-open.json'), '{not json');
  const requested = [];
  const plan = await planCorpusFileDescriptorBackfill({
    inventory,
    loadProvenance: async (requestedFiles) => {
      assert.deepEqual(requestedFiles, [
        { fullname: 'scp-049', filename: '049D.jpg', sha256: sha256(bytes) },
        { fullname: 'scp-106', filename: 'that man.jpg', sha256: sha256(bytes) },
      ]);
      return readCorpusFileDescriptorProvenance({
        corpusRoot: root,
        branch: 'en',
        requestedFiles,
      });
    },
    getObject: async (key) => {
      requested.push(key);
      return bytes;
    },
    concurrency: 2,
  });

  assert.deepEqual(requested, [sha512(bytes)], 'each immutable object should be read once');
  assert.equal(plan.attachments[0].content_type_label, 'JPEG image data');
  assert.equal(plan.attachments[0].content_type_description, 'JPEG image data, EXIF standard');
  assert.equal(plan.attachments[1].content_type_description, 'JPEG image data, JFIF standard 1.02');
  assert.equal(plan.attachments[0].replace_existing_descriptor, true);
  assert.equal(plan.pages.length, 2);
  assert.deepEqual(plan.authority, { corpus_provenance: 2 });
});

test('standing descriptor preflight counts exact matches and binds the corpus snapshot denominator', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-descriptor-preflight-'));
  const matchedBytes = Buffer.from('matched immutable bytes');
  const missingBytes = Buffer.from('missing immutable bytes');
  writeProvenance(root, {
    fullname: 'scp-049',
    entityId: '11111111-1111-4111-8111-111111111111',
    filename: 'matched.bin',
    bytes: matchedBytes,
    description: 'ASCII text, with no line terminators',
  });
  writeProvenance(root, {
    fullname: 'scp-106',
    entityId: '22222222-2222-4222-8222-222222222222',
    filename: 'missing.bin',
    bytes: missingBytes,
    description: null,
  });
  const inspected = inspectCorpusFileDescriptorSnapshots({ corpusRoot: root, branch: 'en' });
  const { denominator } = inspected;
  assert.equal(denominator.snapshots_total, 2);
  assert.equal(denominator.snapshots_with_descriptor, 1);
  assert.equal(denominator.descriptor_bytes, matchedBytes.byteLength);
  assert.match(denominator.snapshot_file_set_sha256, /^[0-9a-f]{64}$/u);

  const inventory = [
    { page_id: 49, page_category_id: 1, fullname: 'scp-049', file_id: 1, revision_id: 11, filename: 'matched.bin', size: matchedBytes.byteLength, s3_key_hex: sha512(matchedBytes) },
    { page_id: 106, page_category_id: 1, fullname: 'scp-106', file_id: 2, revision_id: 12, filename: 'missing.bin', size: missingBytes.byteLength, s3_key_hex: sha512(missingBytes) },
  ];
  assert.deepEqual(
    preflightCorpusFileDescriptorMetadataBatch({
      inventory,
      candidates: inspected.candidates,
    }),
    {
      rows: 2,
      bytes: matchedBytes.byteLength + missingBytes.byteLength,
      provenance_matched: 1,
      provenance_missing: 1,
    },
  );
  const preflight = await preflightCorpusFileDescriptorBatch({
    inventory,
    loadProvenance: async (requestedFiles) => readCorpusFileDescriptorProvenance({
      corpusRoot: root,
      branch: 'en',
      requestedFiles,
    }),
    getObject: async (key) => (key === sha512(matchedBytes) ? matchedBytes : missingBytes),
    concurrency: 2,
  });
  assert.deepEqual(preflight, {
    rows: 2,
    bytes: matchedBytes.byteLength + missingBytes.byteLength,
    provenance_matched: 1,
    provenance_missing: 1,
  });
});

test('standing clone legacy flags do not authorize fallback for its 31 active files and 36 revisions', async () => {
  const bytes = Buffer.from('unmatched');
  const inventory = Array.from({ length: 31 }, (_, index) => ({
    page_id: index + 1,
    page_category_id: 1,
    fullname: `standing-page-${index + 1}`,
    file_id: index + 101,
    revision_id: index + 1001,
    filename: `standing-file-${index + 1}.bin`,
    size: bytes.byteLength,
    s3_key_hex: sha512(bytes),
  }));
  await assert.rejects(
    planCorpusFileDescriptorBackfill({
      inventory,
      loadProvenance: async () => new Map(),
      getObject: async () => bytes,
      concurrency: 1,
    }),
    (error) => {
      assert.match(error.message, /31 active standing mirror file rows have no exact byte-matched corpus descriptor provenance; host libmagic fallback is disabled/u);
      assert.equal(error.fileDescriptorProvenanceBlockers, 31);
      return true;
    },
  );
});

test('standing descriptor inventory is a bounded public-page identity query', () => {
  const sql = buildFileDescriptorInventorySql({ siteId: 6000006, siteSlug: 'scp-wiki', limit: 200, cursor: null });
  assert.match(sql, /WHERE site_id = 6000006::bigint/u);
  assert.match(sql, /slug = 'scp-wiki'::text/u);
  assert.match(sql, /RAISE EXCEPTION 'target site identity mismatch/u);
  assert.match(sql, /WHERE f\.site_id = 6000006::bigint/u);
  assert.match(sql, /JOIN LATERAL/u);
  assert.doesNotMatch(sql, /from_wikidot|imported_revision|local scp-wiki mirror attachment import/u);
  assert.doesNotMatch(sql, /latest\.content_type_label|latest\.content_type_description/u);
  assert.match(sql, /ORDER BY p\.slug, f\.file_id, latest\.revision_id/u);
  assert.match(sql, /LIMIT 200/u);

  const nextSql = buildFileDescriptorInventorySql({
    siteId: 6000006,
    siteSlug: 'scp-wiki',
    limit: 200,
    cursor: { fullname: 'scp-049', file_id: 4901, revision_id: 4902 },
  });
  assert.match(nextSql, /\(p\.slug, f\.file_id, latest\.revision_id\) > \('scp-049'::text, 4901::bigint, 4902::bigint\)/u);

  const parsed = parseFileDescriptorInventory(`${JSON.stringify({
    page_id: 49,
    page_category_id: 1,
    fullname: 'scp-049',
    file_id: 4901,
    revision_id: 4902,
    filename: '049D.jpg',
    size: 180296,
    s3_key_hex: 'a'.repeat(128),
  })}\n`);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].revision_id, 4902);

  const completionSql = buildFileDescriptorCompletionSql(6000006, 'scp-wiki');
  assert.match(completionSql, /WHERE site_id = 6000006::bigint/u);
  assert.match(completionSql, /slug = 'scp-wiki'::text/u);
  assert.match(completionSql, /missing_latest_revision/u);
  assert.match(completionSql, /missing_descriptor/u);
  assert.match(completionSql, /moved_pending_missing_descriptor/u);
  assert.match(completionSql, /\(content_type_label IS NULL\) <> \(content_type_description IS NULL\)/u);
  assert.match(completionSql, /content_type_label IS NULL\s+OR content_type_description IS NULL/u);
  assert.deepEqual(
    parseFileDescriptorCompletion('{"active_files":30,"missing_latest_revision":0,"missing_descriptor":0,"invalid_descriptor":0,"pending_blobs":2,"unmoved_pending_blobs":2,"moved_pending_blobs":0,"moved_pending_missing_descriptor":0}'),
    { active_files: 30, missing_latest_revision: 0, missing_descriptor: 0, invalid_descriptor: 0, pending_blobs: 2, unmoved_pending_blobs: 2, moved_pending_blobs: 0, moved_pending_missing_descriptor: 0 },
  );
});
