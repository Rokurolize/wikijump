import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const command = resolve(root, "scripts/run-test-quality-audit.mjs");
const referenceLedger = JSON.parse(readFileSync(resolve(root, "docs/development/test-quality-audit.json"), "utf8"));
const ownerId = "deepwell:listpages:generated_gate_module_close";

function auditedOwner(ledger) {
  const owner = ledger.owners.find(({id}) => id === ownerId);
  assert.ok(owner, `expected reviewed mutation owner ${ownerId}`);
  return owner;
}

function withLedger(t, modify = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), "wikijump-quality-audit-test-"));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const ledger = structuredClone(referenceLedger);
  modify(ledger);
  const ledgerPath = join(directory, "ledger.json");
  writeFileSync(ledgerPath, JSON.stringify(ledger));
  return {directory, ledgerPath};
}

function audit(operation, {directory, ledgerPath}, additionalArgs = []) {
  return spawnSync(process.execPath, [
    command, operation, "--output-dir", join(directory, "output"),
    "--owner", ownerId, ...additionalArgs,
  ], {
    cwd: root,
    env: {...process.env, WIKIJUMP_TEST_QUALITY_LEDGER: ledgerPath},
    encoding: "utf8",
    timeout: 30_000,
  });
}

test("audit verify accepts a reviewed removed mutation owner", (t) => {
  const result = audit("verify", withLedger(t));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified 1 audit owner/u);
});

test("audit verify rejects an owner with no declared tests", (t) => {
  const result = audit("verify", withLedger(t, (ledger) => {
    auditedOwner(ledger).tests = [];
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /has no tests/u);
});

test("audit verify rejects a stale production source hash", (t) => {
  const result = audit("verify", withLedger(t, (ledger) => {
    auditedOwner(ledger).source.sha256 = "0".repeat(64);
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source.*hash is stale/u);
});

test("audit verify rejects a missing behavioral test anchor", (t) => {
  const result = audit("verify", withLedger(t, (ledger) => {
    auditedOwner(ledger).tests[0].anchors = ["nonexistent_owner_test_000000"];
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid test anchor/u);
});

test("audit verify rejects contradictory mutation counts", (t) => {
  const result = audit("verify", withLedger(t, (ledger) => {
    auditedOwner(ledger).mutation.completed_evidence[0].caught += 1;
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /contradictory mutation evidence/u);
});

test("audit verify rejects a removed owner whose symbol still exists", (t) => {
  const result = audit("verify", withLedger(t, (ledger) => {
    auditedOwner(ledger).symbol = "first_module_opening_candidate";
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /removed owner.*still contains symbol/u);
});

test("audit verify rejects an unsupported removed-owner classification", (t) => {
  const result = audit("verify", withLedger(t, (ledger) => {
    auditedOwner(ledger).status = "in_progress";
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /removed mutation owner.*contradictory status/u);
});

test("audit verify requires removal evidence for a retired mutation owner", (t) => {
  const result = audit("verify", withLedger(t, (ledger) => {
    delete auditedOwner(ledger).mutation.removal_evidence;
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /lacks reviewed removal evidence/u);
});

test("audit verify rejects an omitted owner identity", (t) => {
  const result = audit("verify", withLedger(t), ["--owner", "deepwell:nonexistent:owner"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown audit owner/u);
});

test("audit verify rejects a changed live mutation inventory", (t) => {
  const result = audit("verify", withLedger(t, (ledger) => {
    const owner = auditedOwner(ledger);
    owner.status = "in_progress";
    owner.mutation.removed = false;
    owner.mutation.function = "first_module_opening_candidate";
    owner.mutation.inventory_count = 1;
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mutation inventory mismatch/u);
});

test("audit mutate rejects a removed owner before starting services", (t) => {
  const fixture = withLedger(t);
  const result = audit("mutate", fixture, [
    "--mutation-run", "scanner-result-and-complexity",
    "--shard", "0/8",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /was removed after reviewed mutation evidence/u);
});

test("audit inventory resolves side-effect suite imports and transitive owners", (t) => {
  const fixture = withLedger(t);
  const result = audit("inventory", fixture);
  assert.equal(result.status, 0, result.stderr);

  const report = JSON.parse(readFileSync(join(fixture.directory, "output/inventory.json"), "utf8"));
  const owner = report.executable_owners.find(({path}) => path === "framerail/tests/article-response-cache.test.js");
  assert.ok(owner, "the imported Framerail suite wrapper must be inventoried");
  assert.deepEqual(owner.imported_modules, [
    "framerail/tests/article-response-cache/fences.test.js",
    "framerail/tests/article-response-cache/hot.test.js",
    "framerail/tests/article-response-cache/primitives.test.js",
    "framerail/tests/article-response-cache/redis.test.js",
    "framerail/tests/article-response-cache/storage.test.js",
  ]);
  assert.ok(owner.reachable_imported_modules.includes("framerail/src/lib/server/cache/article-response/index.js"));
  assert.ok(owner.reachable_imported_modules.includes("framerail/tests/article-response-fast-path/helpers.js"));
});
