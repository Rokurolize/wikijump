import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import coverageExclusions from "../fixtures/test-quality-coverage-exclusions.json" with {type: "json"};
import {
  buildAuditInventory, createAuditLedger, jsonHash, loadAuditProofs, sha256, validateAuditLedger, validateMutationReceipt,
} from "../src/test-quality-inventory.mjs";
import {applyNodeMutation, runNodeMutations} from "../src/test-quality-mutations.mjs";
import {coverageInstrumentationExclusions, mergeLcovReports, summarizeLcov} from "../src/test-quality-coverage.mjs";
import {runAuditCommand} from "../src/audit-command.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-audit-test-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const sources = {
    "deepwell/src/lib.rs": "pub fn owner() {}\n#[cfg(test)]\nmod test_owner;\n",
    "deepwell/src/test_owner.rs": "#[test]\nfn real_rust_owner() { assert_eq!(1, 1); }\n",
    "framerail/src/server.js": "export const production = true;\n",
    "framerail/tests/wrapper.test.js": "import './nested/behavior.test.js';\n",
    "framerail/tests/nested/behavior.test.js": "import test from 'node:test';\ntest('real browser owner', () => {});\n",
    "install/local/wikidot-verification/scripts/probe.py": "def probe(): pass\n",
    "install/local/wikidot-verification/tests/test_probe.py": "def test_probe(): pass\n",
    "framerail/src/app.html": "<main>%sveltekit.body%</main>\n",
    "framerail/tests/fixtures/observation.json": "{\"expected\": true}\n",
    "deepwell/migrations/one.sql": "CREATE TABLE real_table (id bigint);\n",
    "scripts/run-test-quality-audit.mjs": "export const runner = true;\n",
    "scripts/test-network-guard.c": "int guard(void) { return 1; }\n",
  };
  for (const [file, source] of Object.entries(sources)) {
    await fs.mkdir(path.dirname(path.join(root, file)), {recursive: true});
    await fs.writeFile(path.join(root, file), source);
  }
  return {root, files: Object.keys(sources)};
}

test("audit inventory discovers imported suites and non-JavaScript executable sources independently of reports", async (t) => {
  const {root, files} = await fixture(t);
  const inventory = await buildAuditInventory(root, files);
  const byPath = new Map(inventory.entries.map((entry) => [entry.path, entry]));
  assert.deepEqual(byPath.get("framerail/tests/wrapper.test.js").imports, ["framerail/tests/nested/behavior.test.js"]);
  assert.deepEqual(byPath.get("framerail/tests/wrapper.test.js").tests, []);
  assert.deepEqual(byPath.get("deepwell/src/lib.rs").imports, ["deepwell/src/test_owner.rs"]);
  assert.equal(byPath.get("deepwell/src/test_owner.rs").tests[0].name, "real_rust_owner");
  assert.equal(byPath.get("install/local/wikidot-verification/scripts/probe.py").role, "production");
  assert.equal(byPath.get("install/local/wikidot-verification/tests/test_probe.py").tests[0].name, "test_probe");
  assert.equal(byPath.get("scripts/run-test-quality-audit.mjs").role, "production");
  assert.equal(byPath.get("deepwell/migrations/one.sql").role, "production");
  assert.equal(byPath.get("framerail/src/app.html").role, "input");
  assert.equal(byPath.get("framerail/tests/fixtures/observation.json").role, "input");
  assert.deepEqual(inventory.entrypoints, ["framerail/tests/wrapper.test.js"]);
  await fs.writeFile(path.join(root, "framerail/tests/fixtures/observation.json"), '{"expected": false}\n');
  assert.notEqual((await buildAuditInventory(root, files)).digest, inventory.digest);
});

test("audit verification fails closed on unresolved, omitted, stale, duplicate or invented ownership", async (t) => {
  const {root, files} = await fixture(t);
  const inventory = await buildAuditInventory(root, files);
  const ledger = createAuditLedger(inventory);
  assert.throws(() => validateAuditLedger(ledger, inventory), /remain unresolved/u);
  assert.equal(validateAuditLedger(ledger, inventory, {allowIncomplete: true}).closure_ready, false);
  const mutate = (change, expected) => {
    const copy = structuredClone(ledger);
    change(copy);
    assert.throws(() => validateAuditLedger(copy, inventory, {allowIncomplete: true}), expected);
  };
  mutate((copy) => copy.records.pop(), /omitted production owner/u);
  mutate((copy) => copy.records.push(copy.records[0]), /duplicate production record/u);
  mutate((copy) => copy.records[0].sha256 = "0".repeat(64), /stale source/u);
  mutate((copy) => copy.records[0].anchors.push("framerail/tests/wrapper.test.js#invented"), /nonexistent named anchor/u);
  mutate((copy) => copy.inventory_digest = "0".repeat(64), /stale inventory/u);
  mutate((copy) => {
    copy.records[0].status = "boundary";
    copy.records[0].review = {author: "implementer", reviewer: "implementer", accepted: true, evidence: ["note"]};
  }, /independent review/u);
  mutate((copy) => {
    for (const record of copy.records) {
      record.status = "covered";
      record.anchors = ["deepwell/src/test_owner.rs#real_rust_owner"];
      record.review = {reviewer: "someone", evidence: "nonexistent-artifact"};
    }
  }, /independent review/u);
  mutate((copy) => {
    copy.records[0].findings.push({status: "boundary", classification: "instrumentation blind spot", evidence: ["note"], review: {author: "a", reviewer: "b", accepted: true, evidence: ["note"]}});
  }, /missing review evidence/u);
});

test("audit verification counts mutation owners without a current receipt as unresolved", async (t) => {
  const {root, files} = await fixture(t);
  const inventory = await buildAuditInventory(root, files);
  const ledger = createAuditLedger(inventory, [{
    id: "resource-scanner",
    kind: "node",
    files: ["framerail/src/server.js"],
    anchors: ["framerail/tests/nested/behavior.test.js#real browser owner"],
    mutation_inventory_sha256: "a".repeat(64),
    command: [process.execPath, "--test", "framerail/tests/nested/behavior.test.js"],
  }]);
  const verification = validateAuditLedger(ledger, inventory, {allowIncomplete: true});
  assert.equal(verification.unresolved_mutations, 1);
  assert.equal(verification.closure_ready, false);
});

test("mutation acceptance rejects changed inventories and missing or unjustified outcomes", () => {
  const inventory = [{id: "one"}, {id: "two"}];
  const definition = {id: "owner", kind: "node", command: ["node", "--test", "owner.test.js"]};
  const a = "a".repeat(64), b = "b".repeat(64);
  const receipt = {owner: "owner", owner_sha256: jsonHash(definition), source_sha256: "source", inventory, inventory_sha256: jsonHash(inventory), tool: "node v24", source_restored: true, command: definition.command, artifacts: [{path: "baseline.log", sha256: a}, {path: "mutation.log", sha256: b}], baselines: [{code: 0, elapsed_ms: 10, log_sha256: a}], outcomes: [{id: "one", outcome: "caught", target: definition.command, log_sha256: a}, {id: "two", outcome: "caught", target: definition.command, log_sha256: b}]};
  const binding = {owner: "owner", definition, ownerHash: jsonHash(definition), sourceHash: "source", inventoryHash: jsonHash(inventory)};
  assert.deepEqual(validateMutationReceipt(receipt, binding), {unresolved: 0});
  assert.throws(() => validateMutationReceipt({...receipt, outcomes: receipt.outcomes.slice(1)}, binding), /unexecuted/u);
  assert.throws(() => validateMutationReceipt({...receipt, inventory: inventory.slice(1)}, binding), /inventory bytes/u);
  const survivor = {...receipt.outcomes[1], outcome: "missed"};
  assert.throws(() => validateMutationReceipt({...receipt, outcomes: [receipt.outcomes[0], survivor]}, binding), /unresolved surviving/u);
  assert.throws(() => validateMutationReceipt({...receipt, baselines: [{code: 1, elapsed_ms: 10}]}, binding), /successful bound mutation baseline/u);
  assert.throws(() => validateMutationReceipt({...receipt, outcomes: [receipt.outcomes[0], {...survivor, disposition: "compilation failure"}]}, binding), /contradictory mutation/u);
  assert.throws(() => validateMutationReceipt({...receipt, command: ["unrelated"]}, binding), /command does not match/u);
  assert.throws(() => validateMutationReceipt({...receipt, outcomes: [receipt.outcomes[0], {...survivor, disposition: "equivalent / non-actionable mutant", evidence: ["missing"], review: {author: "a", reviewer: "b", accepted: true, evidence: ["missing"]}}]}, binding), /missing mutation disposition evidence/u);
});

test("proof admission rejects missing artifacts and stale supporting bytes", async (t) => {
  const {root, files} = await fixture(t);
  const ledger = createAuditLedger(await buildAuditInventory(root, files));
  const proof = {id: "coverage", kind: "coverage", inventory_digest: ledger.inventory_digest};
  const admit = async () => {
    const bytes = JSON.stringify(proof);
    await fs.writeFile(path.join(root, "proof.json"), bytes);
    ledger.proofs = [{id: proof.id, kind: proof.kind, path: "proof.json", sha256: sha256(bytes)}];
    return loadAuditProofs(root, ledger);
  };
  await assert.rejects(admit(), /missing supporting artifacts/u);
  proof.artifacts = [{path: "framerail/src/app.html", sha256: "0".repeat(64)}];
  await assert.rejects(admit(), /stale supporting artifact/u);
});

test("Node mutation spans must match the exact original bytes and preserve surrounding source", () => {
  const source = "return actor === owner;\n";
  const descriptor = {id: "guard", start: 13, end: 16, original: "===", replacement: "!=="};
  assert.equal(applyNodeMutation(source, descriptor), "return actor !== owner;\n");
  assert.throws(() => applyNodeMutation(source, {...descriptor, start: 0}), /stale\/invalid/u);
});

test("coverage parsing preserves zero-coverage files and distinguishes line, function and branch denominators", () => {
  assert.deepEqual(summarizeLcov("SF:owner.js\nLF:12\nLH:0\nFNF:2\nFNH:0\nBRF:4\nBRH:0\nend_of_record\n"), [{path: "owner.js", lines: {total: 12, hit: 0}, functions: {total: 2, hit: 0}, branches: {total: 4, hit: 0}}]);
});

test("coverage batches merge hits by line, function and branch without double-counting", () => {
  const merged = mergeLcovReports([
    "TN:\nSF:owner.js\nFN:1,run\nFNDA:0,run\nFNF:1\nFNH:0\nBRDA:1,0,0,0\nBRDA:1,0,1,-\nBRF:2\nBRH:0\nDA:1,0\nDA:2,1\nLF:2\nLH:1\nend_of_record\n",
    "TN:\nSF:owner.js\nFN:1,run\nFNDA:2,run\nFNF:1\nFNH:1\nBRDA:1,0,0,1\nBRDA:1,0,1,1\nBRF:2\nBRH:2\nDA:1,3\nDA:2,0\nLF:2\nLH:1\nend_of_record\n",
  ]);
  assert.deepEqual(summarizeLcov(merged), [{path: "owner.js", lines: {total: 2, hit: 2}, functions: {total: 1, hit: 1}, branches: {total: 2, hit: 2}}]);
});

test("Wikidot verification coverage exclusions are exact and fail on inventory drift", () => {
  const files = coverageExclusions.test_files;
  assert.deepEqual(coverageInstrumentationExclusions("install/local/wikidot-verification", files), files);
  assert.deepEqual(coverageInstrumentationExclusions("framerail", files), []);
  assert.throws(() => coverageInstrumentationExclusions("install/local/wikidot-verification", files.slice(1)), /stale Wikidot verification instrumentation exclusions/u);
});

test("interrupted commands await child restoration before caller cleanup", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wj-audit-interrupt-"));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const source = path.join(directory, "source");
  const ready = path.join(directory, "ready");
  const controller = new AbortController();
  const run = runAuditCommand(process.execPath, ["-e", `
    const fs = require('node:fs');
    fs.writeFileSync(${JSON.stringify(source)}, 'mutated');
    process.on('SIGINT', () => setTimeout(() => { fs.writeFileSync(${JSON.stringify(source)}, 'original'); process.exit(0); }, 30));
    fs.writeFileSync(${JSON.stringify(ready)}, 'ready');
    setInterval(() => {}, 100);
  `], {signal: controller.signal, capture: true});
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await fs.stat(ready).then(() => true, () => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  try {
    assert.equal(await fs.readFile(ready, "utf8"), "ready");
  } finally {
    controller.abort(new Error("run interrupted"));
  }
  await assert.rejects(run, /run interrupted/u);
  assert.equal(await fs.readFile(source, "utf8"), "original");
});

test("interrupted Node mutation restores exact source bytes and mode before cleanup", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wj-audit-real-interrupt-"));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const source = "export const allowed = true;\n";
  const file = path.join(directory, "owner.mjs");
  const ready = path.join(directory, "ready");
  await fs.writeFile(file, source, {mode: 0o644});
  await fs.chmod(file, 0o644);
  const descriptor = {id: "deny", start: source.indexOf("true"), end: source.indexOf("true") + 4, original: "true", replacement: "false"};
  const owner = {id: "owner", kind: "node", files: ["owner.mjs"], source_sha256: sha256(source), mutations: [descriptor], command: [process.execPath, "-e", `
    const fs = require('node:fs');
    if (fs.readFileSync(${JSON.stringify(file)}, 'utf8').includes('false')) {
      fs.writeFileSync(${JSON.stringify(ready)}, 'ready');
      setInterval(() => {}, 100);
    }
  `]};
  const controller = new AbortController();
  const run = runNodeMutations(directory, owner, path.join(directory, "reports"), controller.signal);
  // Attach rejection handling while waiting for the fresh mutant process.
  const result = assert.rejects(run, /mutation interrupted/u);
  try {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await fs.stat(ready).then(() => true, () => false)) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(await fs.readFile(ready, "utf8"), "ready");
  } finally {
    controller.abort(new Error("mutation interrupted"));
  }
  await result;
  assert.equal(await fs.readFile(file, "utf8"), source);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o644);
  assert.deepEqual((await fs.readdir(directory)).filter(name => name.includes("audit-")), []);
});

test("repeated interrupts leave the supervisor alive until restoration finishes", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wj-audit-repeat-interrupt-"));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const ready = path.join(directory, "ready");
  const restored = path.join(directory, "restored");
  const restoring = path.join(directory, "restoring");
  const release = path.join(directory, "release");
  const moduleUrl = new URL("../src/audit-command.mjs", import.meta.url).href;
  const run = runAuditCommand(process.execPath, ["--input-type=module", "-e", `
    import fs from 'node:fs';
    import {withAuditSignals} from ${JSON.stringify(moduleUrl)};
    await withAuditSignals(signal => new Promise(resolve => {
      const interval = setInterval(() => {}, 100);
      signal.addEventListener('abort', () => {
        fs.writeFileSync(${JSON.stringify(restoring)}, 'restoring');
        const poll = setInterval(() => {
          if (!fs.existsSync(${JSON.stringify(release)})) return;
          fs.writeFileSync(${JSON.stringify(restored)}, 'original');
          clearInterval(interval); clearInterval(poll); resolve();
        }, 5);
      });
      fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid));
    }));
  `], {capture: true});
  let pid, finished = false;
  try {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const value = await fs.readFile(ready, "utf8").catch(() => null);
      if (value) { pid = Number(value); break; }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.ok(pid);
    process.kill(pid, "SIGINT");
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await fs.stat(restoring).then(() => true, () => false)) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(await fs.readFile(restoring, "utf8"), "restoring");
    process.kill(pid, "SIGINT");
    await fs.writeFile(release, "release");
    assert.equal((await run).code, 0);
    finished = true;
    assert.equal(await fs.readFile(restored, "utf8"), "original");
  } finally {
    await fs.writeFile(release, "release");
    if (pid && !finished) { try { process.kill(pid, "SIGTERM"); } catch { /* Already exited. */ } }
  }
});
