import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("../scripts/validate-open-issue-campaign-ledger.mjs", import.meta.url).pathname;
const canonical = new URL("../artifacts/open-issue-campaign-20260809.json", import.meta.url).pathname;
const run = (ledger) => spawnSync(process.execPath, [script, "--ledger", ledger], {encoding:"utf8"});

test("canonical open-issue campaign ledger is structurally complete", () => {
  const result = run(canonical);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.count, 87);
});

test("duplicate issue numbers fail closed", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "wj-ledger-"));
  const ledger = JSON.parse(await fs.readFile(canonical, "utf8"));
  ledger.entries[1].number = ledger.entries[0].number;
  const file = path.join(temporary, "ledger.json");
  await fs.writeFile(file, JSON.stringify(ledger));
  const result = run(file);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate issue number/);
});

test("tracking completion fails while child work remains", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "wj-ledger-"));
  const ledger = JSON.parse(await fs.readFile(canonical, "utf8"));
  ledger.entries.find((entry) => entry.number === 1089).status = "passed";
  ledger.entries.find((entry) => entry.number === 1089).artifacts.push({kind:"receipt",sha256:"0".repeat(64)});
  const file = path.join(temporary, "ledger.json");
  await fs.writeFile(file, JSON.stringify(ledger));
  const result = run(file);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tracking issue passed before/);
});

test("passed issues require an exact candidate identity", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "wj-ledger-"));
  const ledger = JSON.parse(await fs.readFile(canonical, "utf8"));
  const entry = ledger.entries.find((candidate) => candidate.number === 1038);
  entry.status = "passed";
  entry.candidate_identity = null;
  const file = path.join(temporary, "ledger.json");
  await fs.writeFile(file, JSON.stringify(ledger));
  const result = run(file);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /candidate identity/);
});

test("passed issues cover every declared case kind", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "wj-ledger-"));
  const ledger = JSON.parse(await fs.readFile(canonical, "utf8"));
  const entry = ledger.entries.find((candidate) => candidate.number === 1038);
  entry.status = "passed";
  entry.candidate_identity = {
    wikijump_commit: "1".repeat(40),
    wikijump_tree: "2".repeat(40),
    ftml_commit: "3".repeat(40),
    cargo_lock_sha256: "4".repeat(64),
    fixture_overlay_sha256: "5".repeat(64),
  };
  entry.required_case_kinds = ["unit", "integration", "runtime"];
  const file = path.join(temporary, "ledger.json");
  await fs.writeFile(file, JSON.stringify(ledger));
  const result = run(file);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required integration case/);
});
