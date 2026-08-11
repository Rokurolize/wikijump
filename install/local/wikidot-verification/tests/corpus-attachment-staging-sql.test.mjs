import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAttachmentStagingSql, parseAttachmentStagingResults } from '../src/corpus-attachment-staging-sql.mjs';

const S3_HASH = 'a'.repeat(128);

function sampleSql(overrides = {}) {
  return buildAttachmentStagingSql({
    siteId: 246,
    actorUserId: 135,
    revisionComments: 'attachment import',
    attachments: [{ fullname: 'scp-173', filename: "statue's file.png", sha256: 'b'.repeat(64), size: 123, s3_key_hex: S3_HASH, mime: 'image/png', content_type_label: 'PNG image data', content_type_description: 'PNG image data, 1 x 1, 8-bit/color RGBA, non-interlaced', replace_existing_descriptor: true }],
    ...overrides,
  });
}

function assertSqlFragments(sql, fragments) {
  for (const fragment of fragments) assert.ok(sql.includes(fragment), `missing SQL fragment:\n${fragment}\n\nSQL:\n${sql}`);
}

test('buildAttachmentStagingSql stages planned attachments and guard joins', () => {
  const sql = sampleSql();

  assertSqlFragments(sql, [
    'WITH planned_attachments AS',
    "(0::integer, 'scp-173'::text, 'statue''s file.png'::text",
    "decode('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex')",
    'p.site_id = 246::bigint',
    'p.slug = pa.fullname',
    'p.deleted_at IS NULL',
    'planned_name_counts AS',
    'GROUP BY page_id, filename',
    'f.page_id = pm.page_id',
    'f.name = pm.filename',
    'f.deleted_at IS NULL',
    'bb.s3_hash = pm.s3_hash',
  ]);
});

test('buildAttachmentStagingSql classifies rows and exposes first revision staging fields', () => {
  const sql = sampleSql();

  assertSqlFragments(sql, [
    "WHEN af.active_file_count = 1 AND lfr.size = pm.size AND lfr.s3_hash = pm.s3_hash AND lfr.content_type_label IS NULL AND lfr.content_type_description IS NULL THEN 'backfill_descriptor'",
    "WHEN af.active_file_count = 1 AND lfr.size = pm.size AND lfr.s3_hash = pm.s3_hash AND lfr.content_type_label = pm.content_type_label AND lfr.content_type_description = pm.content_type_description THEN 'skip_existing'",
    "WHEN af.active_file_count = 1 AND lfr.size = pm.size AND lfr.s3_hash = pm.s3_hash AND pm.replace_existing_descriptor THEN 'replace_descriptor'",
    "WHEN af.active_file_count = 1 THEN 'existing_mismatch'",
    "WHEN bb.s3_hash IS NOT NULL THEN 'blob_blacklisted'",
    "WHEN pm.page_id IS NULL THEN 'missing_page'",
    "WHEN COALESCE(pnc.planned_name_count, 1) > 1 THEN 'duplicate_planned_name'",
    "ELSE 'insert'",
    'staged_file_rows AS',
    'staged_first_revisions AS',
    'staged_descriptor_backfills AS',
    'staged_descriptor_replacements AS',
    "'create'::text AS revision_type",
    '0::integer AS revision_number',
    '135::bigint AS user_id',
    "ARRAY['page', 'name', 'blob', 'mime']::text[] AS changes",
    'content_type_label',
    'content_type_description',
    "'PNG image data'::text",
    "'PNG image data, 1 x 1, 8-bit/color RGBA, non-interlaced'::text",
    'ARRAY[]::text[] AS hidden',
  ]);
  assert.equal(/\bINSERT\s+INTO\b/iu.test(sql), false);
});

test('buildAttachmentStagingSql commit mode inserts files and first revisions', () => {
  const sql = sampleSql({ commit: true });

  assertSqlFragments(sql, [
    'inserted_files AS',
    'updated_descriptor_revisions AS',
    'UPDATE file_revision fr',
    'SET content_type_label = sdb.content_type_label',
    'fr.content_type_label IS NULL',
    'updated_descriptor_replacements AS',
    'INSERT INTO file (site_id, page_id, name, from_wikidot)',
    'inserted_file_rows AS',
    'inserted_first_revisions AS',
    'INSERT INTO file_revision (',
    'JOIN inserted_file_rows ifr',
    "json_build_object(",
    "'file_id', COALESCE(inserted_file_rows.file_id, c.file_id)",
    "'revision_number', COALESCE(inserted_first_revisions.revision_number, updated_descriptor_revisions.revision_number, updated_descriptor_replacements.revision_number)",
  ]);
  assert.doesNotMatch(sql, /updated_imported_files|SET from_wikidot/u);
});

test('buildAttachmentStagingSql can require an existing byte-matched file', () => {
  const sql = sampleSql({ requireExisting: true });

  assertSqlFragments(sql, [
    "WHEN af.active_file_count = 0 THEN 'fail_closed'",
    "WHEN af.active_file_count = 0 THEN 'missing_existing_file'",
  ]);
  assert.doesNotMatch(sql, /ELSE 'insert'/u);
});

test('buildAttachmentStagingSql handles empty input and validates metadata', () => {
  assertSqlFragments(sampleSql({ attachments: [] }), ['WHERE false', 'NULL::integer AS row_index', 'ORDER BY c.row_index;']);
  assert.throws(() => sampleSql({ attachments: [{ fullname: 'scp-173', filename: 'bad.bin', sha256: 'bad', size: 1, s3_key_hex: S3_HASH }] }), /sha256/);
  assert.throws(() => sampleSql({ attachments: [{ fullname: 'scp-173', filename: 'bad.bin', sha256: 'b'.repeat(64), size: 1, s3_key_hex: 'bad' }] }), /s3_key_hex/);
  assert.throws(() => sampleSql({ attachments: [{ fullname: 'scp-173', filename: 'bad.bin', sha256: 'b'.repeat(64), size: 1, s3_key_hex: S3_HASH, content_type_label: '', content_type_description: '' }] }), /content_type_label/);
});

test('parseAttachmentStagingResults summarizes JSON rows', () => {
  const parsed = parseAttachmentStagingResults([
    '{"row_index":0,"fullname":"scp-173","filename":"a|pipe.png","action":"insert","reason":null,"page_id":101,"file_id":null,"revision_number":0}',
    '{"row_index":1,"fullname":"scp-173","filename":"legacy.png","action":"backfill_descriptor","reason":null,"page_id":101,"file_id":200,"revision_number":4}',
    '{"row_index":2,"fullname":"scp-173","filename":"wrong.png","action":"replace_descriptor","reason":null,"page_id":101,"file_id":201,"revision_number":5}',
    '{"row_index":3,"fullname":"scp-173","filename":"a.png","action":"skip_existing","reason":null,"page_id":101,"file_id":202,"revision_number":null}',
    '{"row_index":4,"fullname":"missing","filename":"b.txt","action":"fail_closed","reason":"missing_page","page_id":null,"file_id":null,"revision_number":null}',
    '{"row_index":5,"fullname":"scp-174","filename":"blocked.gif","action":"fail_closed","reason":"blob_blacklisted","page_id":102,"file_id":null,"revision_number":null}',
    '{"row_index":6,"fullname":"scp-175","filename":"old.bin","action":"fail_closed","reason":"existing_mismatch","page_id":103,"file_id":203,"revision_number":null}',
  ].join('\n'));

  assert.deepEqual(parsed.summary, { total: 7, insert: 1, backfill_descriptor: 1, replace_descriptor: 1, skip_existing: 1, fail_closed: 3 });
  assert.deepEqual(parsed.rows[0], { row_index: 0, fullname: 'scp-173', filename: 'a|pipe.png', action: 'insert', reason: null, page_id: 101, file_id: null, revision_number: 0 });
  assert.equal(parsed.rows[1].action, 'backfill_descriptor');
  assert.equal(parsed.rows[2].action, 'replace_descriptor');
  assert.equal(parsed.rows[6].reason, 'existing_mismatch');
  assert.throws(() => parseAttachmentStagingResults('{"row_index":0,"fullname":"scp-173","filename":"a.png","action":"defer"}'), /unknown action/);
  assert.throws(() => parseAttachmentStagingResults('0|too|few'), /expected JSON staging row/);
});
