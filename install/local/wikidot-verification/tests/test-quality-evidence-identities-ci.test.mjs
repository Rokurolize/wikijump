import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const script = resolve(root, "scripts/verify-test-quality-evidence-identities.mjs");
const original = JSON.parse(readFileSync(resolve(root, "docs/development/test-quality-audit.json"), "utf8"));

function invoke(t, update = () => {}) {
  const temp = mkdtempSync(join(tmpdir(), "wj-ci-audit-identity-"));
  t.after(() => rmSync(temp, {force: true, recursive: true}));
  const ledger = structuredClone(original);
  update(ledger);
  const file = join(temp, "ledger.json");
  writeFileSync(file, JSON.stringify(ledger));
  return spawnSync(process.execPath, [script], {
    cwd: root,
    env: {...process.env, WIKIJUMP_TEST_QUALITY_LEDGER: file},
    encoding: "utf8", timeout: 30_000,
  });
}

test("local identity gate accepts current source, test, and lockfile identities", (t) => {
  const result = invoke(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\d+ source files, 9 inputs, 2 owner\(s\), 1 mutation owner\(s\)/u);
  assert.match(result.stdout, /Mutation results not rechecked/u);
});

test("local identity gate rejects outdated production source SHA", (t) => {
  const result = invoke(t, (ledger) => {
    ledger.records[0].sha256 = "0".repeat(64);
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /production source SHA-256 drift/u);
});

test("local identity gate rejects a missing behavioral test anchor", (t) => {
  const result = invoke(t, (ledger) => {
    ledger.owners[0].anchors[0] = `${ledger.owners[0].anchors[0].split("#")[0]}#definitely_not_a_function_000000`;
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid or missing anchor/u);
});

test("local identity gate rejects missing and duplicate owners", (t) => {
  const missing = invoke(t, (ledger) => { ledger.owners = []; });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /missing required collections/u);

  const duplicate = invoke(t, (ledger) => { ledger.owners.push(structuredClone(ledger.owners[0])); });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /duplicate owner id/u);
});

test("local identity gate rejects path escapes without reading outside source bytes", (t) => {
  const absolute = invoke(t, (ledger) => { ledger.inputs[0].path = "/etc/hosts"; });
  assert.notEqual(absolute.status, 0);
  assert.match(absolute.stderr, /repository-relative path/u);

  const relativeEscape = invoke(t, (ledger) => {
    ledger.owners[0].anchors[0] = "../../../etc/hosts#outside";
  });
  assert.notEqual(relativeEscape.status, 0);
  assert.match(relativeEscape.stderr, /escapes repository/u);
});

test("local identity gate rejects invalid mutation inventory identities", (t) => {
  const result = invoke(t, (ledger) => {
    ledger.owners.find((owner) => owner.mutation_inventory_sha256).mutation_inventory_sha256 = "bad";
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid mutation inventory identity/u);
});
