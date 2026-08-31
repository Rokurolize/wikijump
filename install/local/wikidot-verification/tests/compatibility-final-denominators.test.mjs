import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const ledgerBuilder = path.join(root, "install/local/wikidot-verification/scripts/build-compatibility-ledger.mjs");
const denominatorBuilder = path.join(root, "install/local/wikidot-verification/scripts/build-compatibility-final-denominators.mjs");

const catalogDeferred = [
  "categories-select", "deleted-methods", "files-get-meta", "files-get-one",
  "files-save-one", "files-select", "overview", "pages-get-meta", "pages-get-one",
  "pages-save-one", "pages-select", "posts-get", "posts-select", "tags-select",
  "users-get-me",
].map((id) => `catalog-feature:api-${id}`);

function currentSurface(id) {
  return {
    surface_id: id,
    kind: "catalog_feature",
    public_reference: [],
    existing_refs: {issues: [1394], cases: [], tests: ["tests/example.test.js#case"]},
    evidence: {status: "available", references: []},
    source: {status: "implemented", references: []},
    candidate: {status: "pending", references: []},
    standing: {status: "pending", references: []},
    closure: {status: "open", references: []},
    specification_owner: `catalog.feature:${id.replace("catalog-feature:", "")}`,
    implementation_owners: ["wikijump"],
  };
}

function deferredSurfaces() {
  return [
    ...catalogDeferred.map((surfaceId) => ({
      ...currentSurface(surfaceId),
      specification_owner: surfaceId.replace("catalog-feature:", "catalog.feature:"),
      implementation_owners: [],
    })),
    ...Array.from({length: 17}, (_, index) => ({
      ...currentSurface(`framerail-xmlrpc:fixture.${index}`),
      kind: "framerail_xmlrpc_method",
      specification_owner: "wikijump.registry:framerail-xmlrpc",
      implementation_owners: ["wikijump.framerail"],
    })),
    ...Array.from({length: 22}, (_, index) => ({
      ...currentSurface(`wikidot-py-amc-module:Fixture${index}:parameters=(none)`),
      kind: "wikidot_py_amc_module_shape",
      specification_owner: "wikijump.registry:wikidot-py-amc",
      implementation_owners: ["external.wikidot-py"],
    })),
  ];
}

function inventory() {
  const canonical = currentSurface("catalog-feature:current");
  const alias = currentSurface("catalog-feature:alias");
  const surfaces = [canonical, alias, ...deferredSurfaces()];
  const specificationOwners = [...new Set(surfaces.map((row) => row.specification_owner))];
  return {
    schema: "wikijump.compatibility_surface_inventory.v2",
    counts: {total: surfaces.length, by_kind: {}},
    sources: {},
    provenance: {
      wikijump: {commit: "1".repeat(40), tree: "2".repeat(40)},
      ftml: {commit: "3".repeat(40), tree: "4".repeat(40)},
      registries: [],
    },
    owner_keys: {
      specification: specificationOwners,
      implementation: ["external.wikidot-py", "ftml", "wikijump", "wikijump.framerail"],
    },
    relationship_edge_types: ["equivalence"],
    relationship_edges: [{source: alias.surface_id, type: "equivalence", target: canonical.surface_id}],
    surfaces,
    ftml_raw_surface_manifest: {
      schema: "wikijump.ftml_raw_surface_manifest.v1",
      source: {commit: "3".repeat(40), tree: "4".repeat(40)},
      registries: [], counts: {total: 0}, records: [], catalog_crosswalk: [],
    },
  };
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "compat-final-denominator-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const inventoryPath = path.join(directory, "inventory.json");
  const ledgerPath = path.join(directory, "ledger.json");
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory()));
  execFileSync(process.execPath, [ledgerBuilder, "--inventory", inventoryPath, "--output", ledgerPath]);
  return {directory, inventoryPath, ledgerPath};
}

function runBuilder({directory, inventoryPath, ledgerPath}) {
  const current = path.join(directory, "current.json");
  const deferred = path.join(directory, "deferred.json");
  const deferredLedger = path.join(directory, "deferred-ledger.json");
  execFileSync(process.execPath, [
    denominatorBuilder,
    "--inventory", inventoryPath,
    "--ledger", ledgerPath,
    "--current-output", current,
    "--deferred-output", deferred,
    "--deferred-ledger-output", deferredLedger,
  ]);
  return {
    current,
    deferred,
    deferredLedger,
    currentValue: JSON.parse(fs.readFileSync(current)),
    deferredValue: JSON.parse(fs.readFileSync(deferred)),
    deferredLedgerValue: JSON.parse(fs.readFileSync(deferredLedger)),
  };
}

test("final denominator producer independently reconciles the canonical ledger and exact deferred scope", (t) => {
  const inputs = fixture(t);
  const output = runBuilder(inputs);
  assert.equal(output.currentValue.schema, "wikijump.compatibility_final_zero_denominator.v1");
  assert.equal(output.currentValue.status, "sealed");
  assert.deepEqual(output.currentValue.rows.map(({source_local_id}) => source_local_id), ["catalog-feature:current"]);
  assert.match(output.currentValue.rows[0].surface_id, /^surface:[0-9]{8}$/u);
  assert.deepEqual(
    Object.keys(output.currentValue.rows[0]).sort(),
    ["actor", "input", "kind", "observable_interval", "result", "source_local_id", "surface_id"].sort(),
  );
  for (const field of ["actor", "input", "observable_interval", "result"]) {
    assert.equal(typeof output.currentValue.rows[0][field], "string", field);
    assert.notEqual(output.currentValue.rows[0][field], "", field);
  }
  assert.equal(output.deferredValue.rows.length, 54);
  assert.equal(output.deferredLedgerValue.rows.length, 54);
  assert.deepEqual(
    Object.fromEntries(output.deferredLedgerValue.rows.reduce((entries, row) => {
      entries.set(row.deferred_owner, (entries.get(row.deferred_owner) ?? 0) + 1);
      return entries;
    }, new Map())),
    {"external.wikidot-py": 22, "wikijump.xmlrpc-api": 32},
  );
});

test("final denominator producer rejects inventory drift and immutable output reuse", (t) => {
  const inputs = fixture(t);
  const original = JSON.parse(fs.readFileSync(inputs.inventoryPath));
  const output = runBuilder(inputs);
  assert.throws(
    () => runBuilder(inputs),
    /immutable denominator output already exists/u,
  );

  fs.writeFileSync(inputs.inventoryPath, `${JSON.stringify({...original, sources: {drift: true}})}\n`);
  const changedDir = path.join(inputs.directory, "changed");
  fs.mkdirSync(changedDir);
  assert.throws(
    () => runBuilder({...inputs, directory: changedDir}),
    /not bound to the selected inventory bytes/u,
  );
  assert.equal(fs.existsSync(output.current), true);
});

test("final denominator producer rejects a deferred-scope count change", (t) => {
  const inputs = fixture(t);
  const changed = JSON.parse(fs.readFileSync(inputs.inventoryPath));
  changed.surfaces = changed.surfaces.filter((row) => row.surface_id !== catalogDeferred[0]);
  changed.counts.total = changed.surfaces.length;
  fs.writeFileSync(inputs.inventoryPath, JSON.stringify(changed));
  execFileSync(process.execPath, [ledgerBuilder, "--inventory", inputs.inventoryPath, "--output", path.join(inputs.directory, "changed-ledger.json")]);
  assert.throws(
    () => runBuilder({
      directory: path.join(inputs.directory, "changed-output"),
      inventoryPath: inputs.inventoryPath,
      ledgerPath: path.join(inputs.directory, "changed-ledger.json"),
    }),
    /exactly 54 rows/u,
  );
});
