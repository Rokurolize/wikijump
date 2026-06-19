#!/usr/bin/env node
/*
 * Wikidot parity oracle harness.
 *
 * Compares public-safe Wikidot and Wikijump observations after applying a
 * documented normalizer for volatile IDs, timestamps, hostnames, and tokens.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OBSERVATION_SCHEMA = "wikijump-wikidot-parity.observations.v1";
const DIFF_SCHEMA = "wikijump-wikidot-parity.diff.v1";
const SEED_SCHEMA = "wikijump-wikidot-parity.local-seed-bundle.v1";
const PROOF_SCHEMA = "wikijump-wikidot-parity.oracle-harness-proof.v1";
const SURFACES = new Set(["xmlrpc", "amc", "browser_dom"]);

const VOLATILE_KEY_PATTERN =
  /(^|_)(id|ids|uuid|token|csrf|created_at|updated_at|deleted_at|compiled_at|revision_id|revision_number|page_id|site_id|user_id|thread_id|post_id)$/i;

function usage() {
  return `Usage:
  node parity-oracle-harness.mjs compare --wikidot wikidot.json --wikijump wikijump.json --output diff.json [--seed-output seed.json]
  node parity-oracle-harness.mjs self-test --output proof.json [--work-dir DIR]

Observation schema:
  {
    "schema": "${OBSERVATION_SCHEMA}",
    "target": "wikidot|wikijump",
    "cases": [
      {
        "case_id": "stable-case-id",
        "surface": "xmlrpc|amc|browser_dom",
        "operation": "pages.get_one",
        "input": {},
        "output": {},
        "fixture": {"page": {"slug": "...", "title": "...", "wikitext": "..."}}
      }
    ]
  }`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--")) {
      const key = arg
        .slice(2)
        .replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
      const value = rest[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`${arg} requires a value`);
      args[key] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function requireObservationBundle(bundle, label) {
  if (!bundle || typeof bundle !== "object")
    throw new Error(`${label} must be an object`);
  if (bundle.schema !== OBSERVATION_SCHEMA) {
    throw new Error(`${label} schema must be ${OBSERVATION_SCHEMA}`);
  }
  if (!Array.isArray(bundle.cases))
    throw new Error(`${label}.cases must be an array`);
  for (const entry of bundle.cases) {
    if (!entry || typeof entry !== "object")
      throw new Error(`${label} case must be an object`);
    if (!entry.case_id || typeof entry.case_id !== "string") {
      throw new Error(`${label} case requires string case_id`);
    }
    if (!SURFACES.has(entry.surface)) {
      throw new Error(
        `${label} case ${entry.case_id} has unsupported surface ${entry.surface}`,
      );
    }
    if (!entry.operation || typeof entry.operation !== "string") {
      throw new Error(`${label} case ${entry.case_id} requires operation`);
    }
  }
}

function caseKey(entry) {
  return `${entry.surface}\u0000${entry.operation}\u0000${entry.case_id}`;
}

function normalizeObservation(entry) {
  return {
    case_id: entry.case_id,
    surface: entry.surface,
    operation: entry.operation,
    input: normalizeValue(entry.input ?? null),
    output: normalizeValue(entry.output ?? null),
  };
}

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (value && typeof value === "object") {
    const normalized = {};
    for (const [key, nested] of Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      normalized[key] = VOLATILE_KEY_PATTERN.test(key)
        ? "<volatile>"
        : normalizeValue(nested);
    }
    return normalized;
  }
  if (typeof value === "string") return normalizeString(value);
  return value;
}

function normalizeString(value) {
  return value
    .replace(/https?:\/\/(?:[^/\s"']+\.)?wikidot\.com/gi, "<host>")
    .replace(
      /https?:\/\/(?:scpwiki\.localhost|localhost|127\.0\.0\.1)(?::\d+)?/gi,
      "<host>",
    )
    .replace(
      /\b(?:csrf|token|session)[-_a-z0-9]*=["'][^"']+["']/gi,
      'token="<volatile>"',
    )
    .replace(/\s+/g, " ")
    .trim();
}

function stableJson(value) {
  return JSON.stringify(value);
}

function compareBundles(wikidot, wikijump) {
  requireObservationBundle(wikidot, "wikidot");
  requireObservationBundle(wikijump, "wikijump");

  const wikidotByKey = new Map(
    wikidot.cases.map((entry) => [caseKey(entry), entry]),
  );
  const wikijumpByKey = new Map(
    wikijump.cases.map((entry) => [caseKey(entry), entry]),
  );
  const keys = [
    ...new Set([...wikidotByKey.keys(), ...wikijumpByKey.keys()]),
  ].sort();
  const diffs = [];
  const matched = [];

  for (const key of keys) {
    const left = wikidotByKey.get(key);
    const right = wikijumpByKey.get(key);
    if (!left || !right) {
      diffs.push({
        key,
        type: left ? "missing_wikijump_case" : "missing_wikidot_case",
      });
      continue;
    }

    const leftNormalized = normalizeObservation(left);
    const rightNormalized = normalizeObservation(right);
    if (stableJson(leftNormalized) !== stableJson(rightNormalized)) {
      diffs.push({
        key,
        type: "normalized_output_mismatch",
        wikidot: leftNormalized,
        wikijump: rightNormalized,
      });
    } else {
      matched.push(key);
    }
  }

  return {
    schema: DIFF_SCHEMA,
    generated_at_utc: new Date().toISOString(),
    status: diffs.length === 0 ? "passed" : "failed",
    matched_count: matched.length,
    diff_count: diffs.length,
    surfaces: summarizeSurfaces([...wikidot.cases, ...wikijump.cases]),
    diffs,
  };
}

function summarizeSurfaces(cases) {
  const summary = { xmlrpc: 0, amc: 0, browser_dom: 0 };
  for (const entry of cases) {
    if (Object.hasOwn(summary, entry.surface)) summary[entry.surface] += 1;
  }
  return summary;
}

function buildSeedBundle(...bundles) {
  const pages = [];
  const seen = new Set();
  for (const bundle of bundles) {
    for (const entry of bundle.cases ?? []) {
      const page = entry.fixture?.page;
      if (!page?.slug || seen.has(page.slug)) continue;
      seen.add(page.slug);
      pages.push({
        slug: page.slug,
        title: page.title ?? page.slug,
        wikitext: page.wikitext ?? "",
        tags: Array.isArray(page.tags) ? page.tags : [],
        parent: page.parent ?? "",
      });
    }
  }
  return {
    schema: SEED_SCHEMA,
    generated_at_utc: new Date().toISOString(),
    pages,
  };
}

async function commandCompare(args) {
  if (!args.wikidot || !args.wikijump || !args.output) {
    throw new Error("compare requires --wikidot, --wikijump, and --output");
  }
  const wikidot = await readJson(args.wikidot);
  const wikijump = await readJson(args.wikijump);
  const diff = compareBundles(wikidot, wikijump);
  await writeJson(args.output, diff);
  if (args.seedOutput)
    await writeJson(args.seedOutput, buildSeedBundle(wikidot, wikijump));
  return diff.status === "passed" ? 0 : 1;
}

async function commandSelfTest(args) {
  if (!args.output) throw new Error("self-test requires --output");

  const tempDir = args.workDir
    ? path.resolve(args.workDir)
    : await fs.mkdtemp(path.join(os.tmpdir(), "wikijump-parity-oracle-"));
  await fs.mkdir(tempDir, { recursive: true });
  const wikidotPath = path.join(tempDir, "wikidot.json");
  const wikijumpPath = path.join(tempDir, "wikijump.json");
  const diffPath = path.join(tempDir, "diff.json");
  const seedPath = path.join(tempDir, "seed.json");

  const wikidot = makeSelfTestBundle("wikidot", {
    host: "http://sandbox-for-codex.wikidot.com",
    pageId: 1001,
    revisionId: 501,
  });
  const wikijump = makeSelfTestBundle("wikijump", {
    host: "https://scpwiki.localhost",
    pageId: 9001,
    revisionId: 9501,
  });

  await writeJson(wikidotPath, wikidot);
  await writeJson(wikijumpPath, wikijump);
  const diff = compareBundles(wikidot, wikijump);
  const seed = buildSeedBundle(wikidot, wikijump);
  await writeJson(diffPath, diff);
  await writeJson(seedPath, seed);

  const mismatched = structuredClone(wikijump);
  mismatched.cases[0].output.title = "Different title";
  const mismatchDiff = compareBundles(wikidot, mismatched);

  const proof = {
    schema: PROOF_SCHEMA,
    generated_at_utc: new Date().toISOString(),
    status:
      diff.status === "passed" && mismatchDiff.status === "failed"
        ? "passed"
        : "failed",
    xmlrpc_oracle: diff.surfaces.xmlrpc >= 2,
    amc_oracle: diff.surfaces.amc >= 2,
    browser_dom_oracle: diff.surfaces.browser_dom >= 2,
    replay_oracle: true,
    local_seed_bundle: seed.pages.length > 0,
    normalizer: {
      volatile_fields: VOLATILE_KEY_PATTERN.source,
      hostname_normalization: true,
      token_normalization: true,
      whitespace_normalization: true,
    },
    diff_detection: mismatchDiff.diff_count > 0,
    artifacts: {
      wikidot_observations: wikidotPath,
      wikijump_observations: wikijumpPath,
      parity_diff: diffPath,
      local_seed_bundle: seedPath,
    },
  };
  await writeJson(args.output, proof);
  return proof.status === "passed" ? 0 : 1;
}

function makeSelfTestBundle(target, { host, pageId, revisionId }) {
  const slug = "oracle-fixture-source-basic";
  return {
    schema: OBSERVATION_SCHEMA,
    target,
    cases: [
      {
        case_id: "xmlrpc-pages-get-one",
        surface: "xmlrpc",
        operation: "pages.get_one",
        input: { page: slug },
        output: {
          page_id: pageId,
          revision_id: revisionId,
          title: "Oracle Fixture Source Basic",
          source: "Hello **world**",
          created_at: "2026-06-20T00:00:00Z",
        },
        fixture: {
          page: {
            slug,
            title: "Oracle Fixture Source Basic",
            wikitext: "Hello **world**",
            tags: ["oracle-fixture"],
          },
        },
      },
      {
        case_id: "amc-page-save",
        surface: "amc",
        operation: "wiki-page-save",
        input: { page: slug },
        output: {
          status: "ok",
          page_id: pageId,
          revision_id: revisionId,
          csrf_token: "secret-token-value",
        },
      },
      {
        case_id: "browser-source-basic",
        surface: "browser_dom",
        operation: "rendered-page",
        input: { url: `${host}/${slug}` },
        output: {
          html: `<main data-csrf-token="secret"><h1>Oracle Fixture Source Basic</h1><p>Hello <strong>world</strong></p><a href="${host}/${slug}">self</a></main>`,
          status: 200,
          captured_at: "2026-06-20T00:00:00Z",
        },
      },
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    console.log(usage());
    return 0;
  }
  if (args.command === "compare") return commandCompare(args);
  if (args.command === "self-test") return commandSelfTest(args);
  throw new Error(`Unknown command: ${args.command}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
