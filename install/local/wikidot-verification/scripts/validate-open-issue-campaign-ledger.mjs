#!/usr/bin/env node
import fs from "node:fs/promises";
import process from "node:process";

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) throw new Error(`missing ${name}`);
  return args[index + 1];
};
const ledgerPath = value("--ledger");
const openPath = args.includes("--open-issues") ? value("--open-issues") : null;
const ledger = JSON.parse(await fs.readFile(ledgerPath, "utf8"));
const gitHash = /^[0-9a-f]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;
const terminalStatuses = new Set(["passed", "closed", "superseded"]);
const caseFields = {
  unit: "unit_cases",
  integration: "integration_cases",
  runtime: "runtime_cases",
  browser: "browser_cases",
};
if (ledger.schema !== "roku.wikijump.open_issue_campaign.v2") throw new Error("unexpected ledger schema");
if (!Array.isArray(ledger.entries) || ledger.entries.length !== ledger.open_issue_count) throw new Error("ledger count mismatch");
const numbers = ledger.entries.map((entry) => entry.number);
if (new Set(numbers).size !== numbers.length) throw new Error("duplicate issue number");
for (const entry of ledger.entries) {
  if (!Number.isSafeInteger(entry.number) || entry.number <= 0) throw new Error("invalid issue number");
  if (!Object.hasOwn(ledger.batches, entry.batch)) throw new Error(`unknown batch for #${entry.number}`);
  if (!Array.isArray(entry.artifacts) || !Array.isArray(entry.implementation_commits)) throw new Error(`invalid evidence fields for #${entry.number}`);
  if (entry.status === "passed") {
    if (entry.artifacts.length === 0) throw new Error(`passed issue #${entry.number} has no artifact`);
    if (entry.number !== 1089 && entry.implementation_commits.length === 0) {
      throw new Error(`passed implemented issue #${entry.number} has no implementation commit`);
    }
    if (entry.number !== 1089) {
      const identity = entry.candidate_identity;
      if (!identity
          || !gitHash.test(identity.wikijump_commit)
          || !gitHash.test(identity.wikijump_tree)
          || !gitHash.test(identity.ftml_commit)
          || !sha256.test(identity.cargo_lock_sha256)
          || !sha256.test(identity.fixture_overlay_sha256)) {
        throw new Error(`passed issue #${entry.number} has no exact candidate identity`);
      }
      if (!Array.isArray(entry.required_case_kinds) || entry.required_case_kinds.length === 0) {
        throw new Error(`passed issue #${entry.number} has no required case kinds`);
      }
      for (const kind of entry.required_case_kinds) {
        const field = typeof kind === "string" && Object.hasOwn(caseFields, kind) ? caseFields[kind] : null;
        if (!field) throw new Error(`passed issue #${entry.number} has unknown required case kind ${kind}`);
        if (!Array.isArray(entry[field]) || entry[field].length === 0) {
          throw new Error(`passed issue #${entry.number} has no required ${kind} case`);
        }
      }
    }
  }
}
const tracking = ledger.entries.find((entry) => entry.number === 1089);
if (!tracking) throw new Error("tracking issue #1089 missing");
if (tracking.status === "passed" && ledger.entries.some((entry) => entry.number !== 1089 && !terminalStatuses.has(entry.status))) {
  throw new Error("tracking issue passed before all child issues became terminal");
}
for (const [batch, descriptor] of Object.entries(ledger.batches)) {
  const count = ledger.entries.filter((entry) => entry.batch === batch).length;
  if (count !== descriptor.count) throw new Error(`batch ${batch} count mismatch`);
}
if (openPath) {
  const open = JSON.parse(await fs.readFile(openPath, "utf8"));
  const openNumbers = new Set(open.map((entry) => entry.number));
  const ledgerNumbers = new Set(
    ledger.entries
      .filter((entry) => !terminalStatuses.has(entry.status))
      .map((entry) => entry.number),
  );
  const missing = [...openNumbers].filter((number) => !ledgerNumbers.has(number));
  const extra = [...ledgerNumbers].filter((number) => !openNumbers.has(number));
  if (missing.length || extra.length) throw new Error(`open issue mismatch missing=${missing} extra=${extra}`);
}
process.stdout.write(JSON.stringify({status:"ok",count:numbers.length,batches:ledger.batches}) + "\n");
