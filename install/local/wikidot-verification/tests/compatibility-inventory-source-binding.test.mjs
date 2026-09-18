import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const script = path.join(root, "install/local/wikidot-verification/scripts/bind-compatibility-inventory-source.mjs");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "compat-source-binding-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: directory });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: directory });
  fs.mkdirSync(path.join(directory, "docs/development"), { recursive: true });
  fs.mkdirSync(path.join(directory, "src"), { recursive: true });
  const registryPath = "src/registry.txt";
  const registryBytes = Buffer.from("registry-v1\n");
  fs.writeFileSync(path.join(directory, registryPath), registryBytes);
  const registries = [{ path: registryPath, sha256: sha256(registryBytes) }];
  const sourceInputSetSha256 = sha256(JSON.stringify(registries.map(({ path: p, sha256: digest }) => [p, digest])));
  const inventory = {
    schema: "wikijump.compatibility_surface_inventory.v3",
    provenance: {
      wikijump: { source_input_set_sha256: sourceInputSetSha256 },
      ftml: { commit: "1".repeat(40), tree: "2".repeat(40) },
      registries,
    },
    counts: { total: 0, by_kind: {} },
    surfaces: [],
  };
  const inventoryPath = path.join(directory, "docs/development/compatibility-surface-inventory.json");
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2) + "\n");
  execFileSync("git", ["add", "."], { cwd: directory });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: directory });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: directory, encoding: "utf8" }).trim();
  return { directory, inventoryPath, registryPath, commit, tree };
}

function run(value, output) {
  return spawnSync(process.execPath, [
    script,
    "--root", value.directory,
    "--inventory", value.inventoryPath,
    "--revision", value.commit,
    "--output", output,
  ], { encoding: "utf8" });
}

test("source binding seals exact committed inventory and registry bytes", (t) => {
  const value = fixture(t);
  const output = path.join(value.directory, "binding.json");
  const result = run(value, output);
  assert.equal(result.status, 0, result.stderr);
  const binding = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(binding.schema, "wikijump.compatibility_inventory_source_binding.v1");
  assert.equal(binding.status, "pass");
  assert.deepEqual(binding.wikijump, { commit: value.commit, tree: value.tree });
  assert.equal(binding.inventory.sha256, sha256(fs.readFileSync(value.inventoryPath)));
});

test("source binding rejects inventory, registry, and revision drift", (t) => {
  const inventoryDrift = fixture(t);
  fs.appendFileSync(inventoryDrift.inventoryPath, " ");
  let result = run(inventoryDrift, path.join(inventoryDrift.directory, "inventory-drift.json"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /selected commit does not contain the selected inventory bytes/u);

  const registryDrift = fixture(t);
  fs.writeFileSync(path.join(registryDrift.directory, registryDrift.registryPath), "registry-v2\n");
  execFileSync("git", ["add", registryDrift.registryPath], { cwd: registryDrift.directory });
  execFileSync("git", ["commit", "-qm", "registry drift"], { cwd: registryDrift.directory });
  registryDrift.commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: registryDrift.directory, encoding: "utf8" }).trim();
  result = run(registryDrift, path.join(registryDrift.directory, "registry-drift.json"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /selected commit registry digest drift/u);

  const abbreviated = fixture(t);
  abbreviated.commit = abbreviated.commit.slice(0, 12);
  result = run(abbreviated, path.join(abbreviated.directory, "abbreviated.json"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exact 40-character commit/u);
});
