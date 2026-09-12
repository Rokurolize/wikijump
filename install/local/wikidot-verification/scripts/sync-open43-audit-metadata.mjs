#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CLASSIFICATIONS = Object.freeze([
  "source_ready",
  "needs_source",
  "candidate_required",
  "blocked_evidence",
]);

const ROUTING_PATH = "docs/development/open43-blocked-evidence-routing.json";
const RECONCILIATION_PATH =
  "docs/development/open43-closure-audit-ownership-reconciliation.json";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const sortedUnique = (values) => [...new Set(values)].sort();

function usage() {
  return "Usage: sync-open43-audit-metadata.mjs [--root REPOSITORY]\n";
}

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  return error;
}

function parseArguments(args) {
  let root = ".";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return { help: true, root: null };
    if (argument === "--root") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw usageError("--root requires a repository path");
      root = value;
      index += 1;
      continue;
    }
    throw usageError(`unknown option: ${argument}`);
  }
  return { help: false, root: path.resolve(root) };
}

function zeroCounts() {
  return Object.fromEntries(CLASSIFICATIONS.map((classification) => [classification, 0]));
}

function rowsForIssue(issue) {
  const rows = [];
  if (Array.isArray(issue.subrows)) {
    for (const row of issue.subrows) {
      rows.push({ row, classification: row.classification ?? row.status });
    }
    return rows;
  }
  for (const classification of CLASSIFICATIONS) {
    const values = issue[classification] ?? [];
    if (!Array.isArray(values)) {
      throw new Error(`issue ${issue.issue ?? issue.number} ${classification} must be an array`);
    }
    for (const row of values) rows.push({ row, classification });
  }
  return rows;
}

function countRows(rows) {
  const counts = zeroCounts();
  for (const { classification } of rows) {
    if (!(classification in counts)) throw new Error(`unknown Open43 classification ${classification}`);
    counts[classification] += 1;
  }
  return counts;
}

async function readJson(root, relativePath) {
  return JSON.parse(await fs.readFile(path.join(root, relativePath), "utf8"));
}

function renderRouting(routing) {
  const placeholder = "__OPEN43_ROUTING_ROWS__";
  const skeleton = JSON.stringify({ ...routing, rows: placeholder }, null, 2);
  const rows = routing.rows.map((row) => `    ${JSON.stringify(row)}`).join(",\n");
  return `${skeleton.replace(`"${placeholder}"`, `[\n${rows}\n  ]`)}\n`;
}

export async function syncOpen43AuditMetadata(root, { write = true } = {}) {
  const routing = await readJson(root, ROUTING_PATH);
  const reconciliation = await readJson(root, RECONCILIATION_PATH);
  if (routing.schema !== "wikijump.open43.blocked_evidence_routing.v1") {
    throw new Error(`${ROUTING_PATH} has an unsupported schema`);
  }
  if (reconciliation.schema !== "wikijump.open43.closure_audit_ownership_reconciliation.v1") {
    throw new Error(`${RECONCILIATION_PATH} has an unsupported schema`);
  }
  if (!Array.isArray(routing.source_audits) || routing.source_audits.length === 0) {
    throw new Error(`${ROUTING_PATH} has no source audits`);
  }

  const previousAudits = new Map(
    (reconciliation.closure_audits ?? []).map((entry) => [entry.path, entry]),
  );
  const closureAudits = [];
  const allRows = [];
  for (const auditPath of routing.source_audits) {
    const text = await fs.readFile(path.join(root, auditPath), "utf8");
    const audit = JSON.parse(text);
    if (!Array.isArray(audit.issues)) throw new Error(`${auditPath} has no issues array`);
    const previous = previousAudits.get(auditPath);
    if (!previous || !/^[0-9a-f]{40}$/u.test(previous.source_revision ?? "")) {
      throw new Error(`${auditPath} has no preserved source_revision authority`);
    }
    const issueSummaries = [];
    const auditRows = [];
    for (const issue of audit.issues) {
      const issueNumber = issue.issue ?? issue.number;
      if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
        throw new Error(`${auditPath} contains an invalid issue owner`);
      }
      const issueRows = rowsForIssue(issue);
      for (const item of issueRows) {
        if (!item.row || typeof item.row.case_id !== "string" || item.row.case_id === "") {
          throw new Error(`${auditPath} issue ${issueNumber} contains a case without case_id`);
        }
        auditRows.push({ ...item, issueNumber, auditPath });
        allRows.push({ ...item, issueNumber, auditPath });
      }
      issueSummaries.push({
        issue: issueNumber,
        case_count: issueRows.length,
        classification_counts: countRows(issueRows),
      });
    }
    closureAudits.push({
      ...previous,
      path: auditPath,
      sha256: sha256(text),
      issue_count: audit.issues.length,
      case_count: auditRows.length,
      classification_counts: countRows(auditRows),
      issue_summaries: issueSummaries,
    });
  }

  const caseIds = allRows.map(({ row }) => row.case_id);
  const duplicateCaseIds = sortedUnique(
    caseIds.filter((caseId, index) => caseIds.indexOf(caseId) !== index),
  );
  const blockedIds = new Set(
    allRows
      .filter(({ classification }) => classification === "blocked_evidence")
      .map(({ row }) => row.case_id),
  );

  const existingRoutes = new Map();
  for (const row of routing.rows ?? []) {
    if (existingRoutes.has(row.case_id)) throw new Error(`duplicate routing row ${row.case_id}`);
    existingRoutes.set(row.case_id, row);
  }
  const missingRoutes = [...blockedIds].filter((caseId) => !existingRoutes.has(caseId)).sort();
  if (missingRoutes.length > 0) {
    throw new Error(
      `new blocked evidence requires an explicit routing decision before synchronization: ${missingRoutes.join(", ")}`,
    );
  }
  const rows = (routing.rows ?? []).filter(({ case_id: caseId }) => blockedIds.has(caseId));
  const routeClassNames = Object.keys(routing.route_classes ?? {});
  const routeCounts = Object.fromEntries(routeClassNames.map((routeClass) => [routeClass, 0]));
  for (const row of rows) {
    if (!(row.route_class in routeCounts)) {
      throw new Error(`routing row ${row.case_id} has unknown route class ${row.route_class}`);
    }
    routeCounts[row.route_class] += 1;
  }
  routeCounts.total = rows.length;

  const nextRouting = { ...routing, counts: routeCounts, rows };
  const aggregateCounts = countRows(allRows);
  const nextReconciliation = {
    ...reconciliation,
    closure_audits: closureAudits,
    after: {
      ...reconciliation.after,
      case_count: allRows.length,
      unique_case_count: new Set(caseIds).size,
      duplicate_case_ids: duplicateCaseIds,
      unknown_classifications: [],
      classification_counts: aggregateCounts,
    },
    validation: {
      ...reconciliation.validation,
      committed_inventory_verifier: {
        ...reconciliation.validation?.committed_inventory_verifier,
        case_count: allRows.length,
        blocked_routing_count: rows.length,
      },
    },
  };

  for (const manifest of nextReconciliation.authoritative_manifests ?? []) {
    const text = await fs.readFile(path.join(root, manifest.path));
    manifest.sha256 = sha256(text);
  }

  if (write) {
    await fs.writeFile(path.join(root, ROUTING_PATH), renderRouting(nextRouting));
    await fs.writeFile(
      path.join(root, RECONCILIATION_PATH),
      `${JSON.stringify(nextReconciliation, null, 2)}\n`,
    );
  }
  return {
    caseCount: allRows.length,
    blockedCount: rows.length,
    resolvedRoutingRows: (routing.rows ?? []).length - rows.length,
    classificationCounts: aggregateCounts,
    routeCounts,
    routing: nextRouting,
    reconciliation: nextReconciliation,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const root = options.root;
  const result = await syncOpen43AuditMetadata(root);
  process.stdout.write(
    `${JSON.stringify({
      case_count: result.caseCount,
      blocked_count: result.blockedCount,
      resolved_routing_rows: result.resolvedRoutingRows,
      classification_counts: result.classificationCounts,
      route_counts: result.routeCounts,
    })}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.exitCode === 2 ? `${error.message}\n${usage().trimEnd()}` : (error?.stack ?? error?.message ?? String(error)));
    process.exitCode = error?.exitCode ?? 1;
  });
}
