#!/usr/bin/env node
// Refresh an imported mirror site to the canonical corpus (operator tool).
//
// For every mirrored page whose current source, title or tags differ from
// the corpus copy, append a new page revision with the corpus values through
// Deepwell's ordinary page_edit, so history, recorded links and dependent
// renders follow normally (no row rewrite). Only pages whose every revision
// came from the mirror import or seed are touched; a page with any other
// revision is reported and left alone. An empty corpus title keeps the local
// title (Wikidot then shows the page name). Without --apply the command only
// prints the plan.
//
// Usage:
//   refresh-mirror-from-corpus.mjs --corpus-root <path> [--branch en] \
//     [--site scp-wiki] [--site-id 6000006] \
//     [--db-container <name> | --db-url <url>] \
//     [--rpc-url http://127.0.0.1:2747/jsonrpc] [--slug <page>...] [--apply]
//
// Auth: DEEPWELL_RPC_TOKEN for the service, and DEEPWELL_SESSION_TOKEN or the
// local seed administrator (WIKIDOT_VERIFY_ADMIN_EMAIL / _PASS) for the edit
// actor. Edits are attributed to the session's user.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {runCliIfMain} from '../src/cli-entry.mjs';
import {createSqlExecutor} from '../src/corpus-import-sql.mjs';
import {sqlQuote} from '../src/corpus-import-sql-values.mjs';
import {deepwellRpcAuthorization} from '../src/deepwell-rpc-auth.mjs';
import {validateRpcUrl} from '../src/import-page.mjs';

const IMPORT_COMMENT_PREFIX = 'local scp-wiki mirror';
const BATCH_SESSION_EDITS = 100;

export function parseArgs(argv) {
  const args = {
    corpusRoot: null, branch: 'en', site: 'scp-wiki', siteId: 6000006,
    dbContainer: 'wikijump-standing-database-1', dbUrl: process.env.DEEPWELL_VERIFY_DB_URL ?? null,
    rpcUrl: 'http://127.0.0.1:2747/jsonrpc', slugs: [], apply: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === '--corpus-root') args.corpusRoot = next();
    else if (arg === '--branch') args.branch = next();
    else if (arg === '--site') args.site = next();
    else if (arg === '--site-id') args.siteId = Number.parseInt(next(), 10);
    else if (arg === '--db-container') args.dbContainer = next();
    else if (arg === '--db-url') args.dbUrl = next();
    else if (arg === '--rpc-url') args.rpcUrl = next();
    else if (arg === '--slug') args.slugs.push(next());
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--help' || arg === '-h') return {help: true};
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.corpusRoot) throw new Error('--corpus-root is required');
  if (!Number.isInteger(args.siteId)) throw new Error('--site-id must be an integer');
  validateRpcUrl(args.rpcUrl);
  return args;
}

export function usage() {
  return 'Usage: refresh-mirror-from-corpus.mjs --corpus-root <path> [--branch en] [--site scp-wiki] [--site-id <id>] [--db-container <name> | --db-url <url>] [--rpc-url <url>] [--slug <page>...] [--apply]';
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Decide the refresh for each local page from its corpus copy.
 *
 * @param {{slug: string, sourceSha256: string, title: string, tags: string[], importOnly: boolean}[]} pages
 * @param {(slug: string) => ({source: string, title: string, tags: string[], run: string} | null)} readCorpus
 */
export function planMirrorRefresh(pages, readCorpus) {
  const plan = [];
  const skipped = [];
  for (const page of pages) {
    const corpus = readCorpus(page.slug);
    if (!corpus) continue;
    const update = {};
    if (sha256(corpus.source) !== page.sourceSha256) update.wikitext = corpus.source;
    if (corpus.title && corpus.title !== page.title) update.title = corpus.title;
    const tags = [...corpus.tags].sort();
    if (JSON.stringify(tags) !== JSON.stringify([...page.tags].sort())) update.tags = tags;
    if (Object.keys(update).length === 0) continue;
    if (!page.importOnly) {
      skipped.push({slug: page.slug, reason: 'has-local-revisions', fields: Object.keys(update)});
      continue;
    }
    plan.push({slug: page.slug, run: corpus.run, ...update});
  }
  return {plan, skipped};
}

export function corpusReader(corpusRoot, branch) {
  return (slug) => {
    const directory = path.join(corpusRoot, branch, 'pages', slug);
    const sourcePath = path.join(directory, 'source.wikidot.txt');
    const metaPath = path.join(directory, 'meta.json');
    if (!fs.existsSync(sourcePath) || !fs.existsSync(metaPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    let run = 'corpus';
    try {
      run = JSON.parse(fs.readFileSync(path.join(directory, 'current.json'), 'utf8')).run_id ?? run;
    } catch {}
    return {source: fs.readFileSync(sourcePath, 'utf8'), title: meta.title ?? '', tags: meta.tags ?? [], run};
  };
}

function localPagesSql(site, slugs) {
  const filter = slugs.length ? ` AND p.slug IN (${slugs.map(sqlQuote).join(',')})` : '';
  // The seed (system user) and mirror-import revisions are the only
  // revisions a mirror page may have for it to be refreshed.
  return `SELECT json_build_object('slug', p.slug, 'sha', encode(sha256(convert_to(t.contents, 'UTF8')), 'hex'),
      'title', r.title, 'tags', r.tags,
      'importOnly', bool_and(r2.user_id = -2 OR (r2.user_id = -1 AND coalesce(r2.comments, '') LIKE ${sqlQuote(`${IMPORT_COMMENT_PREFIX}%`)})))
    FROM page p JOIN site s ON s.site_id = p.site_id
    JOIN page_revision r ON r.revision_id = p.latest_revision_id
    JOIN text t ON t.hash = r.wikitext_hash
    JOIN page_revision r2 ON r2.page_id = p.page_id
    WHERE s.slug = ${sqlQuote(site)} AND p.deleted_at IS NULL${filter}
    GROUP BY p.slug, t.contents, r.title, r.tags;`;
}

async function rpc(rpcUrl, method, params, sessionToken) {
  const headers = {Authorization: deepwellRpcAuthorization(), 'Content-Type': 'application/json'};
  if (sessionToken) headers['X-Deepwell-Session-Token'] = sessionToken;
  const response = await fetch(rpcUrl, {method: 'POST', redirect: 'error', headers, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  if (!response.ok) throw new Error(`${method}: RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function session(rpcUrl) {
  if (process.env.DEEPWELL_SESSION_TOKEN) return process.env.DEEPWELL_SESSION_TOKEN;
  const result = await rpc(rpcUrl, 'login', {
    name_or_email: process.env.WIKIDOT_VERIFY_ADMIN_EMAIL ?? 'admin@wikijump',
    password: process.env.WIKIDOT_VERIFY_ADMIN_PASS ?? 'wikijumpadmin1',
    ip_address: '127.0.0.1',
    user_agent: 'refresh-mirror-from-corpus',
  });
  return result.session_token;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const sql = createSqlExecutor({dbUrl: args.dbUrl, dbContainer: args.dbContainer});
  const output = await sql.runSql(localPagesSql(args.site, args.slugs), {capture: true});
  const pages = output.split('\n').filter((line) => line.startsWith('{')).map((line) => {
    const row = JSON.parse(line);
    return {slug: row.slug, sourceSha256: row.sha, title: row.title ?? '', tags: row.tags ?? [], importOnly: row.importOnly === true};
  });
  const {plan, skipped} = planMirrorRefresh(pages, corpusReader(args.corpusRoot, args.branch));
  for (const item of skipped) console.log(JSON.stringify({slug: item.slug, skipped: item.reason, fields: item.fields}));
  if (!args.apply) {
    for (const item of plan) console.log(JSON.stringify({slug: item.slug, plan: Object.keys(item).filter((key) => !['slug', 'run'].includes(key))}));
    console.log(JSON.stringify({pages: pages.length, refresh: plan.length, skipped: skipped.length, applied: false}));
    return 0;
  }
  let failed = 0;
  let token = null;
  for (const [index, item] of plan.entries()) {
    if (index % BATCH_SESSION_EDITS === 0) token = await session(args.rpcUrl);
    try {
      const page = await rpc(args.rpcUrl, 'page_get', {site_id: args.siteId, page: item.slug, details: {compiled_html: false, wikitext: false}}, token);
      const params = {
        site_id: args.siteId, page: page.page_id, last_revision_id: page.revision_id, slug: page.slug,
        user_id: -1, ip_address: '::1',
        revision_comments: `${IMPORT_COMMENT_PREFIX} refresh from corpus ${item.run}`,
      };
      for (const key of ['wikitext', 'title', 'tags']) if (item[key] !== undefined) params[key] = item[key];
      const result = await rpc(args.rpcUrl, 'page_edit', params, token);
      console.log(JSON.stringify({slug: item.slug, ok: true, revision: result?.revision_number}));
    } catch (error) {
      failed += 1;
      console.log(JSON.stringify({slug: item.slug, ok: false, error: String(error.message).slice(0, 2000)}));
    }
  }
  console.log(JSON.stringify({pages: pages.length, refresh: plan.length, skipped: skipped.length, failed, applied: true}));
  return failed ? 1 : 0;
}

await runCliIfMain(import.meta.url, main);
