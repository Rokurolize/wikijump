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

test("full audit verify rejects a changed mutation frontier list identity", (t) => {
  const fixture = withLedger(t, (ledger) => {
    ledger.next_mutation_frontier[0].mutation_list_sha256 = "0".repeat(64);
  });
  const result = spawnSync(process.execPath, [
    command, "verify", "--output-dir", join(fixture.directory, "output"),
  ], {
    cwd: root, env: {...process.env, WIKIJUMP_TEST_QUALITY_LEDGER: fixture.ledgerPath},
    encoding: "utf8", timeout: 30_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mutation frontier.*list identity changed/u);
});

test("full audit verify validates inventory and accounting for replayed survivor frontiers", (t) => {
  const fixture = withLedger(t, (ledger) => {
    const frontier = ledger.next_mutation_frontier[0];
    frontier.status = "replayed_unreviewed_survivors";
    frontier.replay = {
      date: "2026-10-08",
      mutants: 136,
      caught: 72,
      missed: 60,
      unviable: 4,
      timeout: 0,
      owner: "deepwell/src/services/render/list_pages/scanner/tests.rs",
      evidence: [
        "/tmp/wj-1990-scanner-shard-0-8-before-tests-20261008",
        "/tmp/wj-1990-scanner-targeted-verified-20261008",
        "/tmp/wj-1990-scanner-shard-1-8-20261008",
        "/tmp/wj-1990-scanner-shard-1-targeted-verified-20261008",
        "/tmp/wj-1990-scanner-shard-1-resume-verified-20261008",
        "/tmp/wj-1990-scanner-shard-2-8-20261008",
        "/tmp/wj-1990-scanner-shard-2-targeted-20261008",
        "/tmp/wj-1990-scanner-shard-3-8-20261008",
        "/tmp/wj-1990-scanner-shard-4-8-20261008",
        "/tmp/wj-1990-scanner-shard-5-8-20261008",
        "/tmp/wj-1990-scanner-shard-6-8-20261008",
        "/tmp/wj-1990-scanner-shard-7-8-20261008",
      ],
      survivor_disposition: "pending_independent_review",
    };
  });
  const result = spawnSync(process.execPath, [
    command, "verify", "--output-dir", join(fixture.directory, "output"),
  ], {
    cwd: root,
    env: {...process.env, WIKIJUMP_TEST_QUALITY_LEDGER: fixture.ledgerPath},
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("full audit verify rejects contradictory replayed frontier outcomes", (t) => {
  const fixture = withLedger(t, (ledger) => {
    const frontier = ledger.next_mutation_frontier[0];
    frontier.status = "replayed_unreviewed_survivors";
    frontier.replay = {
      mutants: 136,
      caught: 72,
      missed: 59,
      unviable: 4,
      timeout: 0,
    };
  });
  const result = spawnSync(process.execPath, [
    command, "verify", "--output-dir", join(fixture.directory, "output"),
  ], {
    cwd: root,
    env: {...process.env, WIKIJUMP_TEST_QUALITY_LEDGER: fixture.ledgerPath},
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /outcomes sum to 135, expected 136/u);
});

test("audit inventory resolves side-effect suite imports and transitive owners", (t) => {
  const fixture = withLedger(t);
  const result = audit("inventory", fixture);
  assert.equal(result.status, 0, result.stderr);

  const report = JSON.parse(readFileSync(join(fixture.directory, "output/inventory.json"), "utf8"));
  assert.ok(report.production.some(({path}) => path === "deepwell/relation-impl-derive/src/lib.rs"),
    "proc-macro production sources must be included in the independent inventory");
  assert.ok(report.production.some(({path}) => path === "framerail/article-response-fast-path.js"),
    "production entrypoints outside Framerail src must not be omitted");
  assert.ok(report.executable_owners.some(({path}) => path === "deepwell/relation-impl-derive/src/lib.rs"),
    "proc-macro inline test ownership must be inventoried");
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
  const ownership = report.static_import_ownership;
  assert.equal(ownership.production_file_count, report.production.length);
  assert.equal(ownership.with_static_import_candidates + ownership.without_static_import_candidates,
    ownership.production_file_count);
  assert.match(ownership.semantics, /not behavioral coverage/u);
  const cacheSource = ownership.source_candidates.find(({source}) => source ===
    "framerail/src/lib/server/cache/article-response/index.js");
  assert.ok(cacheSource.static_importing_tests.includes("framerail/tests/article-response-cache.test.js"));
});
