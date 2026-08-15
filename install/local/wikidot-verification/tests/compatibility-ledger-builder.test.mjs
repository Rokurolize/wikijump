import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const script = path.join(
  root,
  "install/local/wikidot-verification/scripts/build-compatibility-ledger.mjs",
);
const contractVerifier = path.join(
  root,
  "install/local/wikidot-verification/scripts/verify-compatibility-denominator-contract.mjs",
);
const denominatorContract = path.join(
  root,
  "docs/development/compatibility-denominator-contract.json",
);

const surface = (surfaceId, overrides = {}) => ({
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
  ...overrides,
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

function deferredScopeInventory() {
  const surfaces = [
    surface("catalog-feature:api-pages-get-one", {
      specification_owner: "catalog.feature:api-pages-get-one",
      implementation_owners: [],
    }),
    surface("catalog-feature:api-not-xmlrpc"),
    surface("framerail-amc-action:ForumAction:createPageDiscussionThread", {
      kind: "framerail_amc_action_shape",
      specification_owner: "wikijump.registry:framerail-amc",
      implementation_owners: ["wikijump.framerail"],
    }),
    surface("framerail-amc-module:forum/ForumStartModule:parameters=hidden", {
      kind: "framerail_amc_module_shape",
      specification_owner: "wikijump.registry:framerail-amc",
      implementation_owners: ["wikijump.framerail"],
    }),
    surface("framerail-xmlrpc:pages.get_one", {
      kind: "framerail_xmlrpc_method",
      specification_owner: "wikijump.registry:framerail-xmlrpc",
      implementation_owners: ["wikijump.framerail"],
    }),
    surface("wikidot-py-amc-module:edit/EditMetaModule:parameters=pageId", {
      kind: "wikidot_py_amc_module_shape",
      specification_owner: "wikijump.registry:wikidot-py-amc",
      implementation_owners: ["external.wikidot-py"],
    }),
  ];
  const value = inventory(surfaces);
  value.owner_keys.specification = [
    "catalog.feature:api-pages-get-one",
    "spec:a",
    "wikijump.registry:framerail-amc",
    "wikijump.registry:framerail-xmlrpc",
    "wikijump.registry:wikidot-py-amc",
  ];
  value.owner_keys.implementation = [
    "external.wikidot-py",
    "ftml",
    "impl:a",
    "wikijump.framerail",
  ];
  return value;
}

test("compatibility ledger builder preserves opaque identities and rejects broken inputs", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "wikijump-ledger-"));
  const input = path.join(directory, "inventory.json");
  const output = path.join(directory, "ledger.json");
  const initial = inventory();
  initial.surfaces[0].evidence.status = "available";
  initial.surfaces[0].source.status = "implemented";
  initial.surfaces[0].existing_refs.tests = [
    "tests/public.test.js#observed case",
  ];
  initial.surfaces[0].existing_refs.issues = [1365];
  writeFileSync(input, JSON.stringify(initial));
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
  assert.equal(first.rows[0].source.state, "present");
  assert.equal(first.rows[0].evidence.state, "present");
  assert.deepEqual(first.rows[0].tests, {
    state: "present",
    references: ["test:tests/public.test.js#observed case"],
  });
  assert.deepEqual(first.rows[0].issues, {
    state: "present",
    numbers: [1365],
  });
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

  writeFileSync(input, JSON.stringify(inventory()));
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [script, "--inventory", input, "--output", output],
        { stdio: "pipe" },
      ),
    /raw source disappeared: catalog-feature:a/u,
  );
  writeFileSync(output, JSON.stringify(first));

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

  writeFileSync(output, JSON.stringify(first));
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

  const duplicateIdentity = structuredClone(first);
  duplicateIdentity.surface_assignments.push({
    ...duplicateIdentity.surface_assignments[0],
    assignment_id: "assignment:00000002",
  });
  writeFileSync(output, JSON.stringify(duplicateIdentity));
  writeFileSync(input, JSON.stringify(initial));
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [script, "--inventory", input, "--output", output],
        { stdio: "pipe" },
      ),
    /duplicate existing surface identity/u,
  );
});

test("compatibility ledger builder admits only the current scope and audits deferred exclusions", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "wikijump-ledger-scope-"));
  const input = path.join(directory, "inventory.json");
  const output = path.join(directory, "ledger.json");
  const deferred = deferredScopeInventory();
  writeFileSync(input, JSON.stringify(deferred));
  execFileSync(process.execPath, [
    script,
    "--inventory",
    input,
    "--output",
    output,
  ]);
  const ledger = JSON.parse(readFileSync(output));

  assert.deepEqual(ledger.deferred_exclusions, {
    count: 3,
    by_kind: {
      catalog_feature: 1,
      framerail_xmlrpc_method: 1,
      wikidot_py_amc_module_shape: 1,
    },
    by_owner: {
      "external.wikidot-py": 1,
      "wikijump.xmlrpc-api": 2,
    },
    records: [
      {
        source_local_id: "catalog-feature:api-pages-get-one",
        kind: "catalog_feature",
        deferred_owner: "wikijump.xmlrpc-api",
      },
      {
        source_local_id: "framerail-xmlrpc:pages.get_one",
        kind: "framerail_xmlrpc_method",
        deferred_owner: "wikijump.xmlrpc-api",
      },
      {
        source_local_id: "wikidot-py-amc-module:edit/EditMetaModule:parameters=pageId",
        kind: "wikidot_py_amc_module_shape",
        deferred_owner: "external.wikidot-py",
      },
    ],
  });
  const sourceLocalIds = new Set(
    ledger.source_local_identities.map(({ source_local_id: sourceLocalId }) => sourceLocalId),
  );
  for (const excluded of ledger.deferred_exclusions.records) {
    assert.equal(sourceLocalIds.has(excluded.source_local_id), false);
  }
  for (const included of [
    "catalog-feature:api-not-xmlrpc",
    "framerail-amc-action:ForumAction:createPageDiscussionThread",
    "framerail-amc-module:forum/ForumStartModule:parameters=hidden",
  ]) {
    assert.equal(sourceLocalIds.has(included), true);
  }
  assert.equal(ledger.counts.canonical_surfaces, 3);

  const unknownOwner = deferredScopeInventory();
  unknownOwner.surfaces.find(({ kind }) => kind === "wikidot_py_amc_module_shape").implementation_owners = ["impl:a"];
  writeFileSync(input, JSON.stringify(unknownOwner));
  assert.throws(
    () => execFileSync(process.execPath, [script, "--inventory", input, "--output", output], { stdio: "pipe" }),
    /unknown deferred ownership/u,
  );

  const duplicateExclusion = JSON.parse(readFileSync(output));
  duplicateExclusion.deferred_exclusions.records.push(duplicateExclusion.deferred_exclusions.records[0]);
  writeFileSync(output, JSON.stringify(duplicateExclusion));
  writeFileSync(input, JSON.stringify(deferred));
  assert.throws(
    () => execFileSync(process.execPath, [script, "--inventory", input, "--output", output], { stdio: "pipe" }),
    /duplicate existing deferred exclusion identity/u,
  );

  writeFileSync(output, JSON.stringify(ledger));
  const changedOwnership = JSON.parse(readFileSync(output));
  changedOwnership.deferred_exclusions.records[0].deferred_owner = "external.wikidot-py";
  writeFileSync(output, JSON.stringify(changedOwnership));
  assert.throws(
    () => execFileSync(process.execPath, [script, "--inventory", input, "--output", output], { stdio: "pipe" }),
    /unknown deferred ownership/u,
  );

  writeFileSync(output, JSON.stringify(ledger));
  const changedSpecification = deferredScopeInventory();
  changedSpecification.surfaces.find(({ kind }) => kind === "framerail_xmlrpc_method").specification_owner = "spec:a";
  writeFileSync(input, JSON.stringify(changedSpecification));
  assert.throws(
    () => execFileSync(process.execPath, [script, "--inventory", input, "--output", output], { stdio: "pipe" }),
    /unknown deferred ownership/u,
  );

  const changedAmcSpecification = deferredScopeInventory();
  changedAmcSpecification.surfaces.find(({ kind }) => kind === "wikidot_py_amc_module_shape").specification_owner = "spec:a";
  writeFileSync(input, JSON.stringify(changedAmcSpecification));
  assert.throws(
    () => execFileSync(process.execPath, [script, "--inventory", input, "--output", output], { stdio: "pipe" }),
    /unknown deferred ownership/u,
  );
});

test("compatibility ledger builder rejects deferred sources in a previous current ledger", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "wikijump-ledger-stale-scope-"));
  const input = path.join(directory, "inventory.json");
  const output = path.join(directory, "ledger.json");
  const deferred = deferredScopeInventory();
  writeFileSync(input, JSON.stringify(deferred));
  execFileSync(process.execPath, [script, "--inventory", input, "--output", output]);

  const previous = JSON.parse(readFileSync(output));
  previous.source_local_identities.push({
    source_manifest_id: "manifest:00000001",
    raw_record_id: "raw:99999999",
    source_local_id: "framerail-xmlrpc:pages.get_one",
  });
  writeFileSync(output, JSON.stringify(previous));
  assert.throws(
    () => execFileSync(process.execPath, [script, "--inventory", input, "--output", output], { stdio: "pipe" }),
    /deferred source in current ledger/u,
  );
});

test("compatibility ledger builder partitions the pinned inventory without FTML leakage", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "wikijump-ledger-real-"));
  const input = path.join(directory, "inventory.json");
  const output = path.join(directory, "ledger.json");
  const inventoryPath = path.join(
    root,
    "docs/development/compatibility-surface-inventory.json",
  );
  try {
    execFileSync(process.execPath, [
      script,
      "--inventory",
      inventoryPath,
      "--output",
      output,
    ]);
    const inventory = JSON.parse(readFileSync(inventoryPath));
    const ledger = JSON.parse(readFileSync(output));
    const rawIds = new Set([
      ...inventory.surfaces.map(({ surface_id: surfaceId }) => surfaceId),
      ...inventory.ftml_raw_surface_manifest.records.map(
        ({ surface_id: surfaceId }) => surfaceId,
      ),
    ]);
    const currentIds = new Set(
      ledger.source_local_identities.map(
        ({ source_local_id: sourceLocalId }) => sourceLocalId,
      ),
    );
    const excludedIds = new Set(
      ledger.deferred_exclusions.records.map(
        ({ source_local_id: sourceLocalId }) => sourceLocalId,
      ),
    );

    assert.deepEqual(ledger.deferred_exclusions.by_kind, {
      catalog_feature: 15,
      framerail_xmlrpc_method: 17,
      wikidot_py_amc_module_shape: 22,
    });
    assert.equal(ledger.counts.public_inventory_records, 867);
    assert.equal(ledger.counts.raw_records, 1266);
    assert.equal(excludedIds.size, 54);
    assert.equal(currentIds.size + excludedIds.size, 1320);
    assert.deepEqual(new Set([...currentIds, ...excludedIds]), rawIds);
    assert(
      [...ledger.deferred_exclusions.records].every(({ source_local_id: sourceLocalId }) =>
        inventory.surfaces.some(({ surface_id: id }) => id === sourceLocalId),
      ),
    );
    for (const sourceLocalId of excludedIds) {
      for (const [name, value] of [
        ["rows", ledger.rows],
        ["source identities", ledger.source_local_identities],
        ["relationships", ledger.relationships],
      ]) {
        assert.equal(
          JSON.stringify(value).includes(sourceLocalId),
          false,
          `${sourceLocalId} leaked through ${name}`,
        );
      }
    }

    const ftmlMatch = structuredClone(inventory);
    ftmlMatch.ftml_raw_surface_manifest.records.push({
      surface_id: "ftml.raw:matching-deferred-kind",
      kind: "framerail_xmlrpc_method",
      implementation_owners: ["wikijump.framerail"],
      source_reference: "test",
    });
    ftmlMatch.ftml_raw_surface_manifest.counts.total += 1;
    writeFileSync(input, JSON.stringify(ftmlMatch));
    execFileSync(process.execPath, [
      script,
      "--inventory",
      input,
      "--output",
      output,
    ]);
    const guardedLedger = JSON.parse(readFileSync(output));
    assert.equal(guardedLedger.deferred_exclusions.count, 54);
    assert.equal(
      guardedLedger.source_local_identities.some(
        ({ source_local_id: sourceLocalId }) =>
          sourceLocalId === "ftml.raw:matching-deferred-kind",
      ),
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("compatibility ledger builder projects recorded proof claims without erasing failures", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "wikijump-ledger-proof-"));
  const input = path.join(directory, "inventory.json");
  const output = path.join(directory, "ledger.json");

  const pendingFixture = inventory();
  pendingFixture.surfaces[0].candidate.status = "pending";
  pendingFixture.surfaces[0].standing.status = "pending";
  writeFileSync(input, JSON.stringify(pendingFixture));
  execFileSync(process.execPath, [
    script,
    "--inventory",
    input,
    "--output",
    output,
  ]);
  const pending = JSON.parse(readFileSync(output));
  assert.deepEqual(pending.rows[0].candidate, {
    state: "pending",
    artifacts: [],
  });
  assert.deepEqual(pending.rows[0].standing, {
    state: "pending",
    artifacts: [],
  });

  const failedFixture = inventory();
  failedFixture.surfaces[0].candidate.status = "passed";
  failedFixture.surfaces[0].standing.status = "failed";
  writeFileSync(input, JSON.stringify(failedFixture));
  execFileSync(process.execPath, [
    script,
    "--inventory",
    input,
    "--output",
    output,
  ]);
  const projected = JSON.parse(readFileSync(output));
  const boundArtifact = {
    path: input,
    sha256: createHash("sha256").update(readFileSync(input)).digest("hex"),
  };
  assert.deepEqual(projected.rows[0].candidate, {
    state: "pass",
    artifacts: [boundArtifact],
  });
  assert.deepEqual(projected.rows[0].standing, {
    state: "fail",
    artifacts: [boundArtifact],
  });

  const blockedFixture = inventory();
  blockedFixture.surfaces[0].candidate.status = "blocked";
  blockedFixture.surfaces[0].standing.status = "not_applicable";
  writeFileSync(input, JSON.stringify(blockedFixture));
  execFileSync(process.execPath, [
    script,
    "--inventory",
    input,
    "--output",
    output,
  ]);
  const blocked = JSON.parse(readFileSync(output));
  assert.deepEqual(blocked.rows[0].candidate, {
    state: "blocked",
    artifacts: [],
  });
  assert.deepEqual(blocked.rows[0].standing, {
    state: "blocked",
    artifacts: [],
  });
});

test("ledger builder resolves a relative inventory path before emitting proof artifacts", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "wikijump-ledger-relative-"));
  const relativeInput = "inventory.json";
  const input = path.join(directory, relativeInput);
  const output = path.join(directory, "ledger.json");

  const fixture = inventory();
  fixture.surfaces[0].candidate.status = "passed";
  fixture.surfaces[0].standing.status = "failed";
  writeFileSync(input, JSON.stringify(fixture));
  execFileSync(
    process.execPath,
    [script, "--inventory", relativeInput, "--output", output],
    { cwd: directory },
  );
  const ledger = JSON.parse(readFileSync(output));
  const resolvedPath = path.resolve(directory, relativeInput);
  const resolvedSha256 = createHash("sha256")
    .update(readFileSync(resolvedPath))
    .digest("hex");
  for (const dimension of ["candidate", "standing"]) {
    const [artifact] = ledger.rows[0][dimension].artifacts;
    assert.ok(path.isAbsolute(artifact.path), `${dimension} artifact path`);
    assert.equal(artifact.path, resolvedPath);
    assert.equal(artifact.sha256, resolvedSha256);
  }

  const contract = JSON.parse(readFileSync(denominatorContract));
  const row = contract.structural_examples.rows[0];
  row.candidate = {
    state: "pass",
    artifacts: [ledger.rows[0].candidate.artifacts[0]],
  };
  row.standing = {
    state: "fail",
    artifacts: [ledger.rows[0].standing.artifacts[0]],
  };
  const contractPath = path.join(directory, "contract.json");
  writeFileSync(contractPath, JSON.stringify(contract));
  execFileSync(process.execPath, [contractVerifier, "--contract", contractPath], {
    cwd: directory,
  });
});
