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
if (ledger.schema !== "roku.wikijump.open_issue_campaign.v2") throw new Error("unexpected ledger schema");
if (!Array.isArray(ledger.entries) || ledger.entries.length !== ledger.open_issue_count) throw new Error("ledger count mismatch");
const numbers = ledger.entries.map((entry) => entry.number);
if (new Set(numbers).size !== numbers.length) throw new Error("duplicate issue number");
for (const entry of ledger.entries) {
  if (!Number.isSafeInteger(entry.number) || entry.number <= 0) throw new Error("invalid issue number");
  if (!ledger.batches[entry.batch]) throw new Error(`unknown batch for #${entry.number}`);
  if (!Array.isArray(entry.artifacts) || !Array.isArray(entry.implementation_commits)) throw new Error(`invalid evidence fields for #${entry.number}`);
  if (entry.status === "passed") {
    if (entry.artifacts.length === 0) throw new Error(`passed issue #${entry.number} has no artifact`);
    if (entry.number !== 1089 && entry.implementation_commits.length === 0 && entry.goal !== "current implementation; exact current-head replay") {
      throw new Error(`passed implemented issue #${entry.number} has no implementation commit`);
    }
  }
}
const tracking = ledger.entries.find((entry) => entry.number === 1089);
if (!tracking) throw new Error("tracking issue #1089 missing");
if (tracking.status === "passed" && ledger.entries.some((entry) => entry.number !== 1089 && !["passed", "closed", "superseded"].includes(entry.status))) {
  throw new Error("tracking issue passed before all child issues became terminal");
}
for (const [batch, descriptor] of Object.entries(ledger.batches)) {
  const count = ledger.entries.filter((entry) => entry.batch === batch).length;
  if (count !== descriptor.count) throw new Error(`batch ${batch} count mismatch`);
}
if (openPath) {
  const open = JSON.parse(await fs.readFile(openPath, "utf8"));
  const openNumbers = new Set(open.map((entry) => entry.number));
  const ledgerNumbers = new Set(numbers);
  const missing = [...openNumbers].filter((number) => !ledgerNumbers.has(number));
  const extra = [...ledgerNumbers].filter((number) => !openNumbers.has(number));
  if (missing.length || extra.length) throw new Error(`open issue mismatch missing=${missing} extra=${extra}`);
}
process.stdout.write(JSON.stringify({status:"ok",count:numbers.length,batches:ledger.batches}) + "\n");
