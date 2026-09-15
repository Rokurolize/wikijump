#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { runCliIfMain } from "../src/cli-entry.mjs";

export const CURRENT_OPEN43_MATRIX_SCHEMA =
  "wikijump.open43.current_open_issue_matrix.v1";

const TRACKING_ISSUE = 1089;
const CLASSIFICATIONS = Object.freeze([
  "source_ready",
  "needs_source",
  "candidate_required",
  "blocked_evidence",
]);
const AUDIT_NAMES = Object.freeze([
  "open43-q-search-users-closure-audit.json",
  "open43-q-forum-closure-audit.json",
  "open43-q-page-query-closure-audit.json",
  "open43-a-actions-membership-closure-audit.json",
  "open43-a-authoring-closure-audit.json",
  "open43-m-closure-audit.json",
  "open43-s-settings-browser-closure-audit.json",
]);
const ROUTING_PATH = "docs/development/open43-blocked-evidence-routing.json";

function fail(message) {
  throw new Error(message);
}

function zeroCounts() {
  return Object.fromEntries(CLASSIFICATIONS.map((name) => [name, 0]));
}

function issueNumber(issue, label) {
  if (!Number.isSafeInteger(issue?.number) || issue.number <= 0) {
    fail(`${label} has an invalid issue number`);
  }
  return issue.number;
}

function issueRows(issue, auditPath) {
  if (Array.isArray(issue.subrows)) {
    return issue.subrows.map((row) => ({
      ...row,
      classification: row.classification ?? row.status,
    }));
  }
  const rows = [];
  for (const classification of CLASSIFICATIONS) {
    const values = issue[classification] ?? [];
    if (!Array.isArray(values)) {
      fail(`${auditPath} issue ${issue.issue ?? issue.number} ${classification} must be an array`);
    }
    rows.push(...values.map((row) => ({ ...row, classification })));
  }
  return rows;
}

function countRows(rows, label) {
  const counts = zeroCounts();
  for (const row of rows) {
    if (!CLASSIFICATIONS.includes(row.classification)) {
      fail(`${label} has unknown classification ${row.classification}`);
    }
    counts[row.classification] += 1;
  }
  return counts;
}

function canonicalOpenIssues(openIssues) {
  return [...openIssues]
    .sort((left, right) => left.number - right.number)
    .map((issue) => ({
      number: issue.number,
      title: issue.title ?? "",
      state: issue.state ?? "",
      body: issue.body ?? "",
      labels: issue.labels ?? [],
      assignees: issue.assignees ?? [],
      blockedBy: issue.blockedBy ?? { nodes: [], totalCount: 0 },
      blocking: issue.blocking ?? { nodes: [], totalCount: 0 },
      url: issue.url ?? "",
      updatedAt: issue.updatedAt ?? "",
    }));
}

function snapshotSha256(openIssues) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalOpenIssues(openIssues)))
    .digest("hex");
}

function dependencyNumbers(issue, openNumbers) {
  return [...new Set((issue.blockedBy?.nodes ?? [])
    .filter((blocker) =>
      openNumbers.has(blocker.number) &&
      String(blocker.state ?? "").toUpperCase() === "OPEN",
    )
    .map((blocker) => blocker.number))].sort((left, right) => left - right);
}

function auditRows(audits) {
  const owners = new Map();
  const allRows = [];
  for (const { path: auditPath, value: audit } of audits) {
    if (!Array.isArray(audit.issues)) fail(`${auditPath} has no issues array`);
    for (const issue of audit.issues) {
      const number = issueNumber({ number: issue.issue ?? issue.number }, `${auditPath} issue`);
      if (owners.has(number)) {
        fail(`issue #${number} is owned by multiple audits: ${owners.get(number)}, ${auditPath}`);
      }
      const rows = issueRows(issue, auditPath);
      owners.set(number, { path: auditPath, audit, rows });
      for (const row of rows) {
        if (typeof row.case_id !== "string" || row.case_id === "") {
          fail(`${auditPath} issue #${number} has a missing case_id`);
        }
        allRows.push({ issue: number, audit: auditPath, ...row });
      }
    }
  }
  const caseOwners = new Map();
  for (const row of allRows) {
    const previous = caseOwners.get(row.case_id);
    if (previous) {
      fail(`case ${row.case_id} is duplicated by #${previous.issue} and #${row.issue}`);
    }
    caseOwners.set(row.case_id, row);
  }
  return owners;
}

function currentIssueMatrix(openIssues, audits) {
  if (!Array.isArray(openIssues) || openIssues.length === 0) {
    fail("open issue snapshot must be a non-empty array");
  }
  const openNumbers = new Set(openIssues.map((issue) => issueNumber(issue, "open issue snapshot")));
  if (openNumbers.size !== openIssues.length) fail("open issue snapshot has duplicate issue numbers");
  if (openIssues.some((issue) => String(issue.state ?? "").toUpperCase() !== "OPEN")) {
    fail("open issue snapshot contains a non-open issue");
  }
  const tracking = openIssues.find((issue) => issue.number === TRACKING_ISSUE);
  if (!tracking || String(tracking.state ?? "").toUpperCase() !== "OPEN") {
    fail("tracking issue #1089 is not open");
  }
  const owners = auditRows(audits);
  const products = [...openIssues]
    .filter((issue) => issue.number !== TRACKING_ISSUE)
    .sort((left, right) => left.number - right.number);
  const counts = zeroCounts();
  const issues = products.map((issue) => {
    const owner = owners.get(issue.number);
    if (!owner) fail(`current open product issue #${issue.number} has no audit owner`);
    if (owner.rows.length === 0) fail(`current open product issue #${issue.number} has no acceptance rows`);
    const issueCounts = countRows(owner.rows, `issue #${issue.number}`);
    for (const classification of CLASSIFICATIONS) counts[classification] += issueCounts[classification];
    const issueCases = owner.rows
      .map((row) => ({ case_id: row.case_id, classification: row.classification }))
      .sort((left, right) => left.case_id.localeCompare(right.case_id, "en"));
    return {
      number: issue.number,
      title: issue.title ?? "",
      url: issue.url ?? "",
      audit: owner.path,
      case_count: owner.rows.length,
      classification_counts: issueCounts,
      cases: issueCases,
      blocked_by_open: dependencyNumbers(issue, openNumbers),
    };
  });
  const dependencies = issues
    .flatMap((issue) => issue.blocked_by_open.map((blocker) => ({
      blocker_issue: blocker,
      blocked_issue: issue.number,
    })))
    .sort((left, right) => left.blocked_issue - right.blocked_issue || left.blocker_issue - right.blocker_issue);
  const frontier = issues
    .filter((issue) => issue.blocked_by_open.length === 0)
    .map((issue) => issue.number);
  const staleAuditIssueNumbers = [...owners.keys()]
    .filter((number) => !openNumbers.has(number))
    .sort((left, right) => left - right);
  const unownedOpenIssueNumbers = products
    .filter((issue) => !owners.has(issue.number))
    .map((issue) => issue.number);
  return {
    schema: CURRENT_OPEN43_MATRIX_SCHEMA,
    status: "audit_only",
    tracking_issue: TRACKING_ISSUE,
    snapshot: {
      open_issue_count: openIssues.length,
      product_issue_count: products.length,
      open_issue_numbers: [...openNumbers].sort((left, right) => left - right),
      sha256: snapshotSha256(openIssues),
    },
    counts: {
      product_issue_count: products.length,
      acceptance_row_count: Object.values(counts).reduce((sum, value) => sum + value, 0),
      classifications: counts,
    },
    issues,
    dependencies,
    closure_frontier: {
      currently_unblocked_issue_numbers: frontier,
      currently_blocked_issue_numbers: issues
        .filter((issue) => issue.blocked_by_open.length > 0)
        .map((issue) => issue.number),
      no_issue_is_pre_standing_ready: issues.every((issue) =>
        issue.classification_counts.needs_source > 0 ||
        issue.classification_counts.candidate_required > 0 ||
        issue.classification_counts.blocked_evidence > 0,
      ),
    },
    reconciliation: {
      stale_audit_issue_numbers: staleAuditIssueNumbers,
      unowned_open_issue_numbers: unownedOpenIssueNumbers,
      duplicate_case_ids: [],
    },
  };
}

export { currentIssueMatrix as buildCurrentOpen43Matrix };

async function readJson(filePath, name) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    fail(`${name} is not valid JSON: ${error.message}`);
  }
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const args = { root: process.cwd(), openIssues: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--root" || flag === "--open-issues") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
      args[flag === "--root" ? "root" : "openIssues"] = value;
      index += 1;
      continue;
    }
    fail(`unknown option: ${flag}`);
  }
  if (!args.openIssues) fail("--open-issues is required");
  return args;
}

async function readOpenIssues(filePath) {
  if (filePath === "-") {
    return JSON.parse(await new Promise((resolve, reject) => {
      let text = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { text += chunk; });
      process.stdin.on("end", () => resolve(text));
      process.stdin.on("error", reject);
    }));
  }
  return readJson(path.resolve(filePath), "open issue snapshot");
}

export async function main(argv = process.argv.slice(2), { stdout = console.log } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout("Usage: verify-current-open43-matrix.mjs --open-issues FILE|- [--root REPOSITORY]");
    return 0;
  }
  const root = path.resolve(args.root);
  const routing = await readJson(path.join(root, ROUTING_PATH), ROUTING_PATH);
  if (routing.schema !== "wikijump.open43.blocked_evidence_routing.v1") {
    fail(`${ROUTING_PATH} has an unsupported schema`);
  }
  const auditPaths = routing.source_audits ?? AUDIT_NAMES.map((name) => `docs/development/${name}`);
  const audits = await Promise.all(auditPaths.map(async (auditPath) => ({
    path: auditPath,
    value: await readJson(path.join(root, auditPath), auditPath),
  })));
  const result = currentIssueMatrix(await readOpenIssues(args.openIssues), audits);
  stdout(JSON.stringify(result, null, 2));
  return 0;
}

await runCliIfMain(import.meta.url, main, {
  onError: (error) => {
    console.error(error?.stack ?? error?.message ?? String(error));
    return 1;
  },
});
