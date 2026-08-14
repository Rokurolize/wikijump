import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const script = path.join(
  root,
  "install/local/wikidot-verification/scripts/build-compatibility-ledger.mjs",
);

const surface = (surfaceId) => ({
  surface_id: surfaceId,
  kind: "catalog_feature",
  public_reference: [],
  existing_refs: { issues: [], cases: [], tests: [] },
  evidence: { status: "pending", references: [] },
  source: { status: "pending", references: [] },
  candidate: { status: "pending", references: [] },
  standing: { status: "pending", references: [] },
  closure: { status: "open", references: [] },
  specification_owner: "spec:a",
  implementation_owners: ["impl:a"],
});

function inventory(surfaces = [surface("catalog-feature:b")]) {
  return {
    schema: "wikijump.compatibility_surface_inventory.v2",
    counts: {
      total: surfaces.length,
      by_kind: { catalog_feature: surfaces.length },
    },
    sources: { catalog: "catalog.json" },
    provenance: {
      wikijump: { commit: "1".repeat(40), tree: "2".repeat(40) },
      ftml: { commit: "3".repeat(40), tree: "4".repeat(40) },
      registries: [],
    },
    owner_keys: {
      specification: ["spec:a"],
      implementation: ["ftml", "impl:a"],
    },
    relationship_edge_types: ["alias"],
    relationship_edges: [
      {
        source: "ftml.block-alias:b->b",
        type: "alias",
        target: "ftml.block:b",
      },
    ],
    surfaces,
    ftml_raw_surface_manifest: {
      schema: "wikijump.ftml_raw_surface_manifest.v1",
      source: { commit: "3".repeat(40), tree: "4".repeat(40) },
      registries: [],
      counts: { total: 2 },
      records: [
        {
          surface_id: "ftml.block:b",
          kind: "canonical_block",
          name: "b",
          source_reference: "blocks.toml",
        },
        {
          surface_id: "ftml.block-alias:b->b",
          kind: "block_alias",
          name: "b",
          source_reference: "blocks.toml",
        },
      ],
      catalog_crosswalk: [],
    },
  };
}

test("compatibility ledger builder preserves opaque identities and rejects broken inputs", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "wikijump-ledger-"));
  const input = path.join(directory, "inventory.json");
  const output = path.join(directory, "ledger.json");
  writeFileSync(input, JSON.stringify(inventory()));
  execFileSync(process.execPath, [
    script,
    "--inventory",
    input,
    "--output",
    output,
  ]);
  const first = JSON.parse(readFileSync(output));

  assert.deepEqual(first.counts, {
    raw_records: 3,
    public_inventory_records: 1,
    canonical_surfaces: 1,
    input_alias_edges: 1,
    deduplication_relationships: 0,
  });
  assert.deepEqual(
    first.surface_assignments.map(({ surface_id }) => surface_id),
    ["surface:00000001"],
  );
  assert.deepEqual(first.relationships, []);
  assert.equal(first.source_manifests[0].path, input);
  assert.equal(first.rows[0].actor.state, "missing");
  assert.equal(first.rows[0].owners.state, "present");

  const firstLocalIds = new Map(
    first.source_local_identities.map((row) => [
      row.raw_record_id,
      row.source_local_id,
    ]),
  );
  const prior = Object.fromEntries(
    first.surface_assignments.map((row) => [
      firstLocalIds.get(row.raw_record_id),
      row.surface_id,
    ]),
  );
  const priorAssignment = first.surface_assignments.find(
    (row) => firstLocalIds.get(row.raw_record_id) === "catalog-feature:b",
  ).assignment_id;
  writeFileSync(
    input,
    JSON.stringify(
      inventory([surface("catalog-feature:a"), surface("catalog-feature:b")]),
    ),
  );
  execFileSync(process.execPath, [
    script,
    "--inventory",
    input,
    "--output",
    output,
  ]);
  const second = JSON.parse(readFileSync(output));
  const secondLocalIds = new Map(
    second.source_local_identities.map((row) => [
      row.raw_record_id,
      row.source_local_id,
    ]),
  );
  const retained = second.surface_assignments.find(
    (row) => secondLocalIds.get(row.raw_record_id) === "catalog-feature:b",
  );
  assert.equal(retained.surface_id, prior["catalog-feature:b"]);
  assert.equal(retained.assignment_id, priorAssignment);

  const deduplicated = inventory([
    surface("catalog-feature:alias"),
    surface("catalog-feature:b"),
  ]);
  deduplicated.relationship_edges.push({
    source: "catalog-feature:alias",
    type: "equivalence",
    target: "catalog-feature:b",
  });
  deduplicated.relationship_edge_types.push("equivalence");
  writeFileSync(input, JSON.stringify(deduplicated));
  execFileSync(process.execPath, [
    script,
    "--inventory",
    input,
    "--output",
    output,
  ]);
  const third = JSON.parse(readFileSync(output));
  assert.equal(third.counts.canonical_surfaces, 1);
  assert.equal(third.counts.deduplication_relationships, 1);
  assert.equal(third.relationships[0].relationship_type, "equivalence");

  const broken = inventory();
  broken.relationship_edges[0].target = "ftml.block:missing";
  writeFileSync(input, JSON.stringify(broken));
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [script, "--inventory", input, "--output", output],
        { stdio: "pipe" },
      ),
    /alias target is missing/u,
  );

  const unknownOwner = inventory();
  unknownOwner.surfaces[0].implementation_owners = ["impl:unknown"];
  writeFileSync(input, JSON.stringify(unknownOwner));
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [script, "--inventory", input, "--output", output],
        { stdio: "pipe" },
      ),
    /unknown implementation owner/u,
  );
});
