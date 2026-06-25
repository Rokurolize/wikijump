#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_API_URL = 'http://localhost:2747/jsonrpc';
const DEFAULT_DB_CONTAINER = 'local-database-1';
const DEFAULT_SITE_ID = 6000005;
const DEFAULT_USER_ID = -1;
const DEFAULT_IP_ADDRESS = '127.0.0.1';

function parseArgs(argv) {
  const args = {
    manifest: null,
    migration: path.resolve('deepwell/migrations/20260625104500_wikidot_corpus_import.sql'),
    applyMigration: false,
    apiUrl: DEFAULT_API_URL,
    dbContainer: DEFAULT_DB_CONTAINER,
    siteId: DEFAULT_SITE_ID,
    userId: DEFAULT_USER_ID,
    ipAddress: DEFAULT_IP_ADDRESS,
    rpcTimeoutMs: 120_000,
    slug: [],
    slugFile: null,
    limit: null,
    adoptExisting: false,
    skipExistingDone: false,
    skipRerender: false,
    createMode: 'rpc',
    dryRun: false,
    sourceSite: 'scp-wiki',
    sourceBranch: 'en',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === '--manifest') args.manifest = next();
    else if (arg === '--migration') args.migration = next();
    else if (arg === '--apply-migration') args.applyMigration = true;
    else if (arg === '--api-url') args.apiUrl = next();
    else if (arg === '--db-container') args.dbContainer = next();
    else if (arg === '--site-id') args.siteId = Number.parseInt(next(), 10);
    else if (arg === '--user-id') args.userId = Number.parseInt(next(), 10);
    else if (arg === '--ip-address') args.ipAddress = next();
    else if (arg === '--rpc-timeout-ms') args.rpcTimeoutMs = Number.parseInt(next(), 10);
    else if (arg === '--slug') args.slug.push(next());
    else if (arg === '--slug-file') args.slugFile = next();
    else if (arg === '--limit') args.limit = Number.parseInt(next(), 10);
    else if (arg === '--adopt-existing') args.adoptExisting = true;
    else if (arg === '--skip-existing-done') args.skipExistingDone = true;
    else if (arg === '--skip-rerender') args.skipRerender = true;
    else if (arg === '--create-mode') {
      args.createMode = next();
      if (args.createMode === 'db') args.skipRerender = true;
    }
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--source-site') args.sourceSite = next();
    else if (arg === '--source-branch') args.sourceBranch = next();
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: apply-corpus-import-manifest.mjs --manifest <manifest.jsonl> [--apply-migration] [--slug <slug>...] [--adopt-existing] [--skip-existing-done] [--skip-rerender] [--create-mode rpc|db] [--dry-run]

Imports current corpus snapshot pages into a local Wikijump mirror. This is an operator-only local tool: it uses Deepwell JSON-RPC for page create/rerender and direct Postgres SQL for corpus snapshot metadata, timestamps, and tags.`);
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!args.manifest) throw new Error('--manifest is required');
  if (!Number.isInteger(args.siteId)) throw new Error('--site-id must be an integer');
  if (!Number.isInteger(args.userId)) throw new Error('--user-id must be an integer');
  if (!Number.isInteger(args.rpcTimeoutMs) || args.rpcTimeoutMs <= 0) throw new Error('--rpc-timeout-ms must be a positive integer');
  if (!['rpc', 'db'].includes(args.createMode)) throw new Error('--create-mode must be rpc or db');
  if (args.limit !== null && (!Number.isInteger(args.limit) || args.limit < 0)) {
    throw new Error('--limit must be a non-negative integer');
  }
  return args;
}

function sqlQuote(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlTimestamp(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `TIMESTAMPTZ ${sqlQuote(value)}`;
}

function sqlInt(value) {
  if (!Number.isInteger(value)) throw new Error(`expected integer, got ${value}`);
  return String(value);
}

function sqlByteaFromHex(hex) {
  if (!/^[0-9a-f]{64}$/iu.test(hex)) throw new Error(`expected sha256 hex, got ${hex}`);
  return `decode(${sqlQuote(hex.toLowerCase())}, 'hex')`;
}

function sqlTextHash(hex) {
  if (!/^[0-9a-f]{32}$/iu.test(hex)) throw new Error(`expected 16-byte text hash hex, got ${hex}`);
  return `decode(${sqlQuote(hex.toLowerCase())}, 'hex')`;
}

function textHashHex(contents) {
  return crypto.createHash('md5').update(contents).digest('hex');
}

function sqlTextArray(values) {
  return `ARRAY[${values.map((value) => sqlQuote(value)).join(',')}]::text[]`;
}

function runPsql(args, sql, { capture = false } = {}) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', '-e', 'PGPASSWORD=wikijump', args.dbContainer, 'psql', '-h', 'localhost', '-U', 'wikijump', '-d', 'wikijump', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'],
    { input: sql, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`psql failed (${result.status})\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}\nSQL:\n${sql}`);
  }
  return capture ? result.stdout.trim() : null;
}

function applyMigration(args) {
  const migrationSql = fs.readFileSync(args.migration, 'utf8');
  runPsql(args, migrationSql);
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcSequence, method, params }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`${method} timed out after ${args.rpcTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const data = await response.json();
  if (data.error) {
    throw new Error(`${method} failed: ${JSON.stringify(data.error)}`);
  }
  return data.result;
}

function readRows(manifestPath) {
  return fs.readFileSync(manifestPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function readSlugSet(args) {
  const slugs = new Set(args.slug);
  if (args.slugFile) {
    for (const line of fs.readFileSync(args.slugFile, 'utf8').split('\n')) {
      const slug = line.trim();
      if (slug && !slug.startsWith('#')) slugs.add(slug);
    }
  }
  return slugs;
}

function filterRows(args, rows) {
  const slugSet = readSlugSet(args);
  let filtered = rows;
  if (slugSet.size > 0) filtered = filtered.filter((row) => slugSet.has(row.fullname));
  if (args.limit !== null) filtered = filtered.slice(0, args.limit);
  return filtered;
}

function fallbackTitle(row) {
  return row.title || row.title_shown || row.fullname;
}

function sourceText(row) {
  return fs.readFileSync(row.source_path, 'utf8');
}

function metaJsonText(row) {
  return fs.readFileSync(row.meta_path, 'utf8');
}

function ensureImportRun(args, rows, completeInventory) {
  const manifestSha = rows.length === 0 ? '0'.repeat(64) : pseudoManifestSha(rows);
  const summary = JSON.stringify({ selected_row_count: rows.length, complete_inventory: completeInventory });
  const sql = `
INSERT INTO wikidot_corpus_import_run (
  site_id,
  source_branch,
  source_site,
  manifest_sha256,
  manifest_row_count,
  complete_inventory,
  state,
  summary
) VALUES (
  ${sqlInt(args.siteId)},
  ${sqlQuote(args.sourceBranch)},
  ${sqlQuote(args.sourceSite)},
  ${sqlByteaFromHex(manifestSha)},
  ${sqlInt(rows.length)},
  ${completeInventory ? 'true' : 'false'},
  'running',
  ${sqlQuote(summary)}::jsonb
)
RETURNING import_run_id;
`;
  return Number.parseInt(runPsql(args, sql, { capture: true }), 10);
}

function pseudoManifestSha(rows) {
  // The canonical full-manifest SHA is produced by the manifest generator. For
  // selected ad-hoc subsets we derive an operator-run hash from stable source
  // row hashes so reruns of the same subset are still auditable.
  const hash = crypto.createHash('sha256');
  for (const row of rows) hash.update(`${row.source_entity_id}\t${row.source_sha256}\t${row.meta_sha256}\n`);
  return hash.digest('hex');
}

async function getPage(args, slug) {
  return await rpc(args, 'page_get', {
    site_id: args.siteId,
    page: slug,
    details: { wikitext: false, compiled: false },
  });
}

async function createPage(args, row) {
  return await rpc(args, 'page_create', {
    site_id: args.siteId,
    wikitext: sourceText(row),
    title: fallbackTitle(row),
    alt_title: null,
    slug: row.fullname,
    layout: 'wikidot',
    revision_comments: 'local scp-wiki mirror import from scp-wiki-translation corpus',
    user_id: args.userId,
    bypass_filter: true,
    ip_address: args.ipAddress,
  });
}

function categoryName(slug) {
  const index = slug.lastIndexOf(':');
  return index === -1 ? '_default' : slug.slice(0, index);
}

function shellCreatePage(args, row) {
  const wikitext = sourceText(row);
  const bodyHtml = '<div class="wj-proof-stub corpus-shell-import">Content not rendered yet for local Wikidot corpus snapshot import.</div>';
  const wikitextHash = textHashHex(wikitext);
  const bodyHash = textHashHex(bodyHtml);
  const title = fallbackTitle(row);
  const category = categoryName(row.fullname);
  const sql = `
INSERT INTO text (hash, contents)
VALUES (${sqlTextHash(wikitextHash)}, ${sqlQuote(wikitext)})
ON CONFLICT (hash) DO NOTHING;

INSERT INTO text (hash, contents)
VALUES (${sqlTextHash(bodyHash)}, ${sqlQuote(bodyHtml)})
ON CONFLICT (hash) DO NOTHING;

WITH category AS (
  INSERT INTO page_category (site_id, slug)
  VALUES (${sqlInt(args.siteId)}, ${sqlQuote(category)})
  ON CONFLICT (site_id, slug) DO UPDATE SET slug = EXCLUDED.slug
  RETURNING category_id
), target_page AS (
  SELECT page_id, page_category_id, latest_revision_id
  FROM page
  WHERE site_id = ${sqlInt(args.siteId)}
    AND slug = ${sqlQuote(row.fullname)}
    AND deleted_at IS NULL
  ORDER BY page_id
  LIMIT 1
), new_page AS (
  INSERT INTO page (created_at, updated_at, from_wikidot, site_id, page_category_id, slug)
  SELECT ${sqlTimestamp(row.created_at)}, ${sqlTimestamp(row.updated_at)}, true, ${sqlInt(args.siteId)}, category_id, ${sqlQuote(row.fullname)}
  FROM category
  WHERE NOT EXISTS (SELECT 1 FROM target_page)
  RETURNING page_id, page_category_id, latest_revision_id
), page_row AS (
  SELECT page_id, page_category_id, latest_revision_id FROM target_page
  UNION ALL
  SELECT page_id, page_category_id, latest_revision_id FROM new_page
  LIMIT 1
), new_revision AS (
  INSERT INTO page_revision (
    revision_type,
    created_at,
    revision_number,
    page_id,
    site_id,
    user_id,
    from_wikidot,
    changes,
    wikitext_hash,
    compiled_body_html_hash,
    compiled_top_bar_html_hash,
    compiled_side_bar_html_hash,
    compiled_at,
    compiled_generator,
    comments,
    hidden,
    title,
    alt_title,
    slug,
    tags
  )
  SELECT
    'create',
    ${sqlTimestamp(row.updated_at)},
    0,
    page_id,
    ${sqlInt(args.siteId)},
    ${sqlInt(args.userId)},
    true,
    ARRAY['wikitext', 'title', 'alt_title', 'slug', 'tags']::text[],
    ${sqlTextHash(wikitextHash)},
    ${sqlTextHash(bodyHash)},
    NULL,
    NULL,
    NOW(),
    'corpus db import',
    'local scp-wiki mirror DB import from scp-wiki-translation corpus',
    ARRAY[]::text[],
    ${sqlQuote(title)},
    NULL,
    ${sqlQuote(row.fullname)},
    ${sqlTextArray(row.tags)}
  FROM page_row
  WHERE latest_revision_id IS NULL
  RETURNING revision_id, page_id
), revision_row AS (
  SELECT latest_revision_id AS revision_id, page_id
  FROM page_row
  WHERE latest_revision_id IS NOT NULL
  UNION ALL
  SELECT revision_id, page_id FROM new_revision
  LIMIT 1
), updated_page AS (
  UPDATE page
  SET
    latest_revision_id = (SELECT revision_id FROM revision_row),
    created_at = ${sqlTimestamp(row.created_at)},
    updated_at = ${sqlTimestamp(row.updated_at)},
    from_wikidot = true,
    page_category_id = (SELECT category_id FROM category)
  WHERE page_id = (SELECT page_id FROM page_row)
  RETURNING page_id, page_category_id, latest_revision_id
)
SELECT page_id || '|' || page_category_id || '|' || latest_revision_id FROM updated_page;
`;
  const output = runPsql(args, sql, { capture: true });
  const [pageId, categoryId, revisionId] = output.split('|').map((value) => Number.parseInt(value, 10));
  if (![pageId, categoryId, revisionId].every(Number.isInteger)) {
    throw new Error(`invalid DB import output: ${output}`);
  }
  return { page_id: pageId, page_category_id: categoryId, revision_id: revisionId };
}

async function rerenderPage(args, pageId, categoryId) {
  return await rpc(args, 'page_rerender', {
    site_id: args.siteId,
    category_id: categoryId,
    page_id: pageId,
  });
}

function upsertSnapshotSql(args, row, pageId, revisionId, importRunId) {
  const metaText = metaJsonText(row);
  const title = fallbackTitle(row);
  return `
UPDATE page
SET
  created_at = ${sqlTimestamp(row.created_at)},
  updated_at = ${sqlTimestamp(row.updated_at)},
  from_wikidot = true
WHERE page_id = ${sqlInt(pageId)};

UPDATE page_revision
SET
  created_at = ${sqlTimestamp(row.updated_at)},
  from_wikidot = true,
  title = ${sqlQuote(title)},
  tags = ${sqlTextArray(row.tags)}
WHERE revision_id = ${sqlInt(revisionId)};

INSERT INTO wikidot_page_snapshot (
  page_id,
  source_branch,
  source_site,
  source_entity_id,
  source_fullname,
  source_created_at,
  source_updated_at,
  source_revision_count,
  imported_rating,
  created_by_name,
  updated_by_name,
  title_shown,
  parent_fullname,
  comments,
  commented_at,
  commented_by_name,
  source_sha256,
  meta_sha256,
  meta_json,
  last_import_run_id
) VALUES (
  ${sqlInt(pageId)},
  ${sqlQuote(row.source_branch)},
  ${sqlQuote(row.source_site)},
  ${sqlQuote(row.source_entity_id)},
  ${sqlQuote(row.fullname)},
  ${sqlTimestamp(row.created_at)},
  ${sqlTimestamp(row.updated_at)},
  ${sqlInt(row.revisions)},
  ${sqlInt(row.rating)},
  ${sqlQuote(row.created_by)},
  ${sqlQuote(row.updated_by)},
  ${sqlQuote(row.title_shown)},
  ${sqlQuote(row.parent_fullname)},
  ${sqlInt(row.comments)},
  ${sqlTimestamp(row.commented_at)},
  ${sqlQuote(row.commented_by)},
  ${sqlByteaFromHex(row.source_sha256)},
  ${sqlByteaFromHex(row.meta_sha256)},
  ${sqlQuote(metaText)}::jsonb,
  ${sqlInt(importRunId)}
)
ON CONFLICT (page_id) DO UPDATE SET
  source_branch = EXCLUDED.source_branch,
  source_site = EXCLUDED.source_site,
  source_entity_id = EXCLUDED.source_entity_id,
  source_fullname = EXCLUDED.source_fullname,
  source_created_at = EXCLUDED.source_created_at,
  source_updated_at = EXCLUDED.source_updated_at,
  source_revision_count = EXCLUDED.source_revision_count,
  imported_rating = EXCLUDED.imported_rating,
  created_by_name = EXCLUDED.created_by_name,
  updated_by_name = EXCLUDED.updated_by_name,
  title_shown = EXCLUDED.title_shown,
  parent_fullname = EXCLUDED.parent_fullname,
  comments = EXCLUDED.comments,
  commented_at = EXCLUDED.commented_at,
  commented_by_name = EXCLUDED.commented_by_name,
  source_sha256 = EXCLUDED.source_sha256,
  meta_sha256 = EXCLUDED.meta_sha256,
  meta_json = EXCLUDED.meta_json,
  last_import_run_id = EXCLUDED.last_import_run_id,
  imported_at = NOW();
`;
}

function existingSnapshotPageId(args, row) {
  const sql = `
SELECT page_id
FROM wikidot_page_snapshot
WHERE source_site = ${sqlQuote(row.source_site)}
  AND source_entity_id = ${sqlQuote(row.source_entity_id)}
  AND encode(source_sha256, 'hex') = ${sqlQuote(row.source_sha256)}
  AND encode(meta_sha256, 'hex') = ${sqlQuote(row.meta_sha256)}
LIMIT 1;
`;
  const output = runPsql(args, sql, { capture: true });
  if (!output) return null;
  const pageId = Number.parseInt(output, 10);
  if (!Number.isInteger(pageId)) throw new Error(`invalid snapshot page_id output: ${output}`);
  return pageId;
}

function recordItemSql(row, pageId, importRunId, state, error = null) {
  return `
INSERT INTO wikidot_corpus_import_item (
  import_run_id,
  source_entity_id,
  source_fullname,
  page_id,
  source_sha256,
  meta_sha256,
  state,
  error
) VALUES (
  ${sqlInt(importRunId)},
  ${sqlQuote(row.source_entity_id)},
  ${sqlQuote(row.fullname)},
  ${pageId === null ? 'NULL' : sqlInt(pageId)},
  ${sqlByteaFromHex(row.source_sha256)},
  ${sqlByteaFromHex(row.meta_sha256)},
  ${sqlQuote(state)},
  ${error === null ? 'NULL' : `${sqlQuote(JSON.stringify(error))}::jsonb`}
)
ON CONFLICT (import_run_id, source_entity_id) DO UPDATE SET
  page_id = EXCLUDED.page_id,
  state = EXCLUDED.state,
  error = EXCLUDED.error,
  updated_at = NOW();
`;
}

async function importRow(args, row, importRunId) {
  if (args.skipExistingDone) {
    const snapshotPageId = existingSnapshotPageId(args, row);
    if (snapshotPageId !== null) {
      runPsql(args, recordItemSql(row, snapshotPageId, importRunId, 'done'));
      return { slug: row.fullname, action: 'skipped_existing_done', page_id: snapshotPageId };
    }
  }

  const existing = await getPage(args, row.fullname);
  let pageId;
  let revisionId;
  let categoryId;
  let action;

  if (existing === null) {
    if (args.dryRun) return { slug: row.fullname, action: args.createMode === 'db' ? 'would_db_create' : 'would_create' };
    if (args.createMode === 'db') {
      const created = shellCreatePage(args, row);
      pageId = created.page_id;
      revisionId = created.revision_id;
      categoryId = created.page_category_id;
      action = 'created_shell';
    } else {
      const created = await createPage(args, row);
      const pageAfterCreate = await getPage(args, row.fullname);
      pageId = created.page_id;
      revisionId = created.revision_id;
      categoryId = pageAfterCreate.page_category_id;
      action = 'created';
    }
  } else {
    if (!args.adoptExisting) {
      if (!args.dryRun) runPsql(args, recordItemSql(row, existing.page_id ?? null, importRunId, 'failed', { collision: 'existing_page_requires_adopt' }));
      return { slug: row.fullname, action: 'collision_existing_page', page_id: existing.page_id };
    }
    if (args.dryRun) return { slug: row.fullname, action: 'would_adopt', page_id: existing.page_id };
    pageId = existing.page_id;
    revisionId = existing.revision_id;
    categoryId = existing.page_category_id;
    action = 'adopted';
  }

  runPsql(args, upsertSnapshotSql(args, row, pageId, revisionId, importRunId));
  if (args.skipRerender) {
    runPsql(args, recordItemSql(row, pageId, importRunId, 'render_pending'));
    return { slug: row.fullname, action: `${action}_snapshot_ready`, page_id: pageId, revision_id: revisionId, rating: row.rating, tags: row.tags.length };
  }

  await rerenderPage(args, pageId, categoryId);
  runPsql(args, recordItemSql(row, pageId, importRunId, 'done'));
  return { slug: row.fullname, action, page_id: pageId, revision_id: revisionId, rating: row.rating, tags: row.tags.length };
}

function finishRun(args, importRunId, summary, state = 'done') {
  runPsql(args, `
UPDATE wikidot_corpus_import_run
SET state = ${sqlQuote(state)}, finished_at = NOW(), summary = ${sqlQuote(JSON.stringify(summary))}::jsonb
WHERE import_run_id = ${sqlInt(importRunId)};
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const allRows = readRows(args.manifest);
  const selectedRows = filterRows(args, allRows);
  const completeInventory = selectedRows.length === allRows.length && args.limit === null && args.slug.length === 0 && args.slugFile === null;

  if (args.applyMigration && !args.dryRun) applyMigration(args);
  if (args.dryRun) {
    console.log(JSON.stringify({ dry_run: true, selected_rows: selectedRows.length, complete_inventory: completeInventory }, null, 2));
    return;
  }

  const importRunId = ensureImportRun(args, selectedRows, completeInventory);
  const results = [];
  const summary = { created: 0, created_shell_snapshot_ready: 0, adopted: 0, created_snapshot_ready: 0, adopted_snapshot_ready: 0, skipped_existing_done: 0, collision_existing_page: 0, failed: 0, import_run_id: importRunId };

  for (const row of selectedRows) {
    try {
      const result = await importRow(args, row, importRunId);
      results.push(result);
      summary[result.action] = (summary[result.action] ?? 0) + 1;
      console.log(JSON.stringify(result));
    } catch (error) {
      summary.failed += 1;
      runPsql(args, recordItemSql(row, null, importRunId, 'failed', { message: error.message }));
      console.error(JSON.stringify({ slug: row.fullname, action: 'failed', error: error.message }));
    }
  }

  finishRun(args, importRunId, summary, summary.failed > 0 ? 'failed' : 'done');
  console.log(JSON.stringify({ summary }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
