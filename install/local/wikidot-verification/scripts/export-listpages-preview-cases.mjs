#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const SYNTAX_CASE_SCHEMA = "wikijump_syntax_differential.syntax_case.v1";

function nextValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing value for ${option}`);
  return value;
}

export function parseArgs(argv) {
  const args = {
    matrixDir: null,
    output: null,
    lanes: [],
    limit: null,
    deduplicateSource: false,
    excludeReferencePaths: [],
  };
  for (let index = 2; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--matrix-dir") {
      args.matrixDir = path.resolve(nextValue(argv, index, option));
      index += 1;
    } else if (option === "--output") {
      args.output = path.resolve(nextValue(argv, index, option));
      index += 1;
    } else if (option === "--lane") {
      args.lanes.push(nextValue(argv, index, option));
      index += 1;
    } else if (option === "--limit") {
      const raw = nextValue(argv, index, option);
      if (!/^[1-9]\d*$/u.test(raw)) throw new Error("--limit must be a positive integer");
      args.limit = Number(raw);
      index += 1;
    } else if (option === "--deduplicate-source") {
      args.deduplicateSource = true;
    } else if (option === "--exclude-reference") {
      args.excludeReferencePaths.push(
        path.resolve(nextValue(argv, index, option)),
      );
      index += 1;
    } else if (option === "--help" || option === "-h") {
      return { help: true };
    } else {
      throw new Error(`unknown argument: ${option}`);
    }
  }
  if (!args.matrixDir) throw new Error("--matrix-dir is required");
  if (!args.output) throw new Error("--output is required");
  if (args.lanes.length === 0) args.lanes = ["generated"];
  return args;
}

function printHelp() {
  console.log("Usage: node install/local/wikidot-verification/scripts/export-listpages-preview-cases.mjs --matrix-dir DIR --output FILE [--lane generated] [--lane corpus-cluster] [--lane corpus-invocation] [--lane corpus-literal-context] [--deduplicate-source] [--exclude-reference FILE]... [--limit N]");
}

async function readJsonl(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  if (!text.trim()) return [];
  return text.trimEnd().split(/\r?\n/u).map((line) => JSON.parse(line));
}

async function laneRows(matrixDir, lane) {
  if (lane === "generated") {
    return readJsonl(path.join(matrixDir, "generated-listpages-cases.jsonl"));
  }
  if (lane === "corpus-cluster") {
    return readJsonl(path.join(matrixDir, "corpus-cluster-cases.jsonl"));
  }
  if (lane === "corpus-invocation") {
    return readJsonl(path.join(matrixDir, "corpus-invocation-cases.jsonl"));
  }
  if (lane === "corpus-literal-context") {
    return (await readJsonl(
      path.join(matrixDir, "corpus-invocation-cases.jsonl"),
    ))
      .filter(
        (row) =>
          row.execution_context === "literal" &&
          typeof row.context_replay_source === "string",
      )
      .map((row) => ({
        ...row,
        id: `${row.id}:literal-context`,
        origin: "corpus-literal-context",
        source: row.context_replay_source,
        source_sha256: row.context_replay_source_sha256,
        provenance: {
          ...row.provenance,
          invocation_id: row.id,
          literal_owner: row.literal_owner,
        },
      }));
  }
  throw new Error(`unsupported lane: ${lane}`);
}

function syntaxCase(row) {
  if (typeof row.source !== "string") {
    throw new Error(`matrix row ${row.id} does not carry source text`);
  }
  return {
    schema: SYNTAX_CASE_SCHEMA,
    case_id: row.id,
    source: row.source,
    title: row.label ?? row.id,
    wikidot_observation_tier: "page-preview",
    local_execution_tier: "wikijump-runtime",
    campaign_matrix: {
      origin: row.origin,
      dimensions: row.dimensions ?? [],
      documentation_claim_ids: row.documentation_claim_ids ?? [],
      provenance: row.provenance ?? null,
    },
  };
}

function uniqueExactSources(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (typeof row.source_sha256 !== "string" || !row.source_sha256) {
      throw new Error(
        `matrix row ${row.id} has no exact source identity for deduplication`,
      );
    }
    if (seen.has(row.source_sha256)) return false;
    seen.add(row.source_sha256);
    return true;
  });
}

export async function exportPreviewCases({
  matrixDir,
  lanes,
  limit,
  deduplicateSource = false,
  excludeReferencePaths = [],
  output,
}) {
  const rows = [];
  for (const lane of lanes) rows.push(...(await laneRows(matrixDir, lane)));
  const uniqueRows = deduplicateSource
    ? uniqueExactSources(rows)
    : rows;
  const existingSourceHashes = new Set();
  for (const referencePath of excludeReferencePaths) {
    for (const reference of await readJsonl(referencePath)) {
      if (
        typeof reference.source_sha256 !== "string" ||
        !reference.source_sha256
      ) {
        throw new Error(
          `reference row in ${referencePath} has no source identity`,
        );
      }
      existingSourceHashes.add(reference.source_sha256);
    }
  }
  const novelRows = uniqueRows.filter(
    (row) => !existingSourceHashes.has(row.source_sha256),
  );
  const selected = limit === null ? novelRows : novelRows.slice(0, limit);
  const cases = selected.map(syntaxCase);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(
    output,
    cases.map((record) => `${JSON.stringify(record)}\n`).join(""),
    { mode: 0o600 },
  );
  return {
    output,
    lane_count: lanes.length,
    input_case_count: rows.length,
    case_count: cases.length,
    exact_source_duplicates_omitted: rows.length - uniqueRows.length,
    existing_reference_sources_omitted: uniqueRows.length - novelRows.length,
  };
}

export async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }
  console.log(JSON.stringify(await exportPreviewCases(args)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
