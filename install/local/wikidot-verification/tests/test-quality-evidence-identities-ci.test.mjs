import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const script = resolve(root, "scripts/verify-test-quality-evidence-identities.mjs");
const original = JSON.parse(readFileSync(resolve(root,"docs/development/test-quality-audit.json"), "utf8"));

function invoke(t, update = () => {}) {
  const temp = mkdtempSync(join(tmpdir(), "wj-ci-audit-identity-"));
  t.after(() => rmSync(temp, {force:true,recursive:true}));
  const ledger = structuredClone(original);
  update(ledger);
  const file = join(temp, "ledger.json");
  writeFileSync(file, JSON.stringify(ledger));
  return spawnSync(process.execPath, [script], {
    cwd: root,
    env:{...process.env, WIKIJUMP_TEST_QUALITY_LEDGER:file},
    encoding:"utf8", timeout:30_000,
  });
}

test("local identity gate accepts current frozen source, tests, and lockfiles", (t) => {
  const result = invoke(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /7 files, 1 owner\(s\), 1 frontier\(s\)/u);
  assert.match(result.stdout, /Mutation results not rechecked/u);
});

test("local identity gate rejects outdated test SHA", (t) => {
  const result = invoke(t, (ledger) => {
    ledger.owners[0].tests.find((entry)=>entry.path === "deepwell/tests/list_pages.rs").sha256 = "0".repeat(64);
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /test .*SHA-256 drift/u);
});

test("local identity gate rejects missing behavioral test anchor", (t) => {
  const result = invoke(t, (ledger) => {
    ledger.owners[0].tests[0].anchors=["definitely_not_a_function_000000"];
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr,/invalid or missing anchor/u);
});

test("local identity gate rejects missing/duplicate owners", (t) => {
  const a = invoke(t, (ledger) => {ledger.owners = []});
  assert.notEqual(a.status, 0);
  assert.match(a.stderr,/missing required collections/u);
  const b = invoke(t, (ledger) => {ledger.owners.push(structuredClone(ledger.owners[0]))});
  assert.notEqual(b.status, 0);
  assert.match(b.stderr,/duplicate owner id/u);
});

test("local identity gate rejects path escapes and does not consult outside source bytes", (t) => {
  const a = invoke(t, (ledger) => {ledger.lockfiles[0].path = "/etc/hosts"});
  assert.notEqual(a.status, 0);
  assert.match(a.stderr,/repository-relative path/u);
  const b = invoke(t, (ledger) => {ledger.owners[0].tests[0].path = "../../../etc/hosts"});
  assert.notEqual(b.status, 0);
  assert.match(b.stderr,/escapes repository/u);
});

test("local identity gate rejects mutable frontier source hashes", (t) => {
  const result = invoke(t, (ledger) => {
    ledger.next_mutation_frontier[0].source_sha256 = "0".repeat(64);
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /frontier .*SHA-256 drift/u);
});
