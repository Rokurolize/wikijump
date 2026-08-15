#!/usr/bin/env node

import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  codePointCompare,
  sha256Hex,
  stableStringify,
} from "../src/canonical-json.mjs";

const [inventoryFlag, inventoryPathArgument, outputFlag, outputPath] =
  process.argv.slice(2);
if (
  process.argv.length !== 6 ||
  inventoryFlag !== "--inventory" ||
  outputFlag !== "--output"
) {
  throw new Error(
    "usage: build-compatibility-ledger.mjs --inventory PATH --output PATH",
  );
}

const inventoryPath = path.resolve(inventoryPathArgument);
const inventoryBytes = await readFile(inventoryPath);
const inventory = JSON.parse(inventoryBytes);

const DEFERRED_CATALOG_FEATURE_OWNERS = new Map([
  ["catalog-feature:api-categories-select", "wikijump.xmlrpc-api"],
  ["catalog-feature:api-deleted-methods", "wikijump.xmlrpc-api"],
  ["catalog-feature:api-files-get-meta", "wikijump.xmlrpc-api"],
  ["catalog-feature:api-files-get-one", "wikijump.xmlrpc-api"],
  ["catalog-feature:api-files-save-one", "wikijump.xmlrpc-api"],
  ["catalog-feature:api-files-select", "wikijump.xmlrpc-api"],
  ["catalog-feature:api-overview", "wikijump.xmlrpc-api"],
  ["catalog-feature:api-pages-get-meta", "wikijump.xmlrpc-api"],
  ["catalog-feature:api-pages-get-one", "wikijump.xmlrpc-api"],
  ["catalog-feature:api-pages-save-one", "wikijump.xmlrpc-api"],
  ["catalog-feature:api-pages-select", "wikijump.xmlrpc-api"],
  ["catalog-feature:api-posts-get", "wikijump.xmlrpc-api"],
  ["catalog-feature:api-posts-select", "wikijump.xmlrpc-api"],
  ["catalog-feature:api-tags-select", "wikijump.xmlrpc-api"],
  ["catalog-feature:api-users-get-me", "wikijump.xmlrpc-api"],
]);
const DEFERRED_KIND_OWNERS = new Map([
  [
    "framerail_xmlrpc_method",
    {
      inventory_owner: "wikijump.framerail",
      specification_owner: "wikijump.registry:framerail-xmlrpc",
      deferred_owner: "wikijump.xmlrpc-api",
    },
  ],
  [
    "wikidot_py_amc_module_shape",
    {
      inventory_owner: "external.wikidot-py",
      specification_owner: "wikijump.registry:wikidot-py-amc",
      deferred_owner: "external.wikidot-py",
    },
  ],
]);
function fail(message) {
  throw new Error(message);
}

function deferredOwner(sourceClass, record) {
  if (sourceClass !== "wikijump") return null;

  const catalogOwner = DEFERRED_CATALOG_FEATURE_OWNERS.get(record.surface_id);
  if (catalogOwner !== undefined) {
    const expectedSpecification = record.surface_id.replace(
      "catalog-feature:",
      "catalog.feature:",
    );
    if (
      record.kind !== "catalog_feature" ||
      record.specification_owner !== expectedSpecification ||
      !Array.isArray(record.implementation_owners) ||
      record.implementation_owners.length !== 0
    ) {
      fail(`unknown deferred ownership: ${record.surface_id}`);
    }
    return catalogOwner;
  }

  const kindOwner = DEFERRED_KIND_OWNERS.get(record.kind);
  if (kindOwner === undefined) return null;
  if (
    record.specification_owner !== kindOwner.specification_owner ||
    !Array.isArray(record.implementation_owners) ||
    record.implementation_owners.length !== 1 ||
    record.implementation_owners[0] !== kindOwner.inventory_owner
  ) {
    fail(`unknown deferred ownership: ${record.surface_id}`);
  }
  return kindOwner.deferred_owner;
}

function countBy(rows, field) {
  return Object.fromEntries(
    [...new Set(rows.map((row) => row[field]))]
      .sort(codePointCompare)
      .map((value) => [value, rows.filter((row) => row[field] === value).length]),
  );
}

function nextId(prefix, used) {
  const maximum = Math.max(
    0,
    ...[...used].map((value) => Number(value.slice(prefix.length))),
  );
  const value = `${prefix}${String(maximum + 1).padStart(8, "0")}`;
  used.add(value);
  return value;
}

if (inventory.schema !== "wikijump.compatibility_surface_inventory.v2")
  fail("unsupported inventory schema");
if (inventory.counts?.total !== inventory.surfaces?.length)
  fail("inventory surface count differs");
if (
  inventory.ftml_raw_surface_manifest?.counts?.total !==
  inventory.ftml_raw_surface_manifest?.records?.length
)
  fail("FTML raw surface count differs");

const rawEntries = [
  ...inventory.surfaces.map((record) => ({ source_class: "wikijump", record })),
  ...inventory.ftml_raw_surface_manifest.records.map((record) => ({
    source_class: "ftml",
    record,
  })),
].sort((left, right) =>
  codePointCompare(left.record.surface_id, right.record.surface_id),
);
const rawIds = rawEntries.map(({ record }) => record.surface_id);
if (rawIds.some((value) => typeof value !== "string" || value === ""))
  fail("raw source identity is missing");
if (new Set(rawIds).size !== rawIds.length)
  fail("duplicate raw source identity");
const deferredEntries = rawEntries.flatMap(({ source_class: sourceClass, record }) => {
  const owner = deferredOwner(sourceClass, record);
  return owner === null
    ? []
    : [{ source_class: sourceClass, record, deferred_owner: owner }];
});
const deferredIdentityIds = deferredEntries.map(({ record }) => record.surface_id);
if (new Set(deferredIdentityIds).size !== deferredIdentityIds.length)
  fail("duplicate deferred exclusion identity");
const deferredIdentityById = new Map(
  deferredEntries.map(({ record, deferred_owner: deferredOwnerValue }) => [
    record.surface_id,
    { kind: record.kind, deferred_owner: deferredOwnerValue },
  ]),
);
const deferredIdentitySet = new Set(deferredIdentityIds);
const currentRawEntries = rawEntries.filter(
  ({ record }) => !deferredIdentitySet.has(record.surface_id),
);
const currentPublicEntries = currentRawEntries.filter(
  ({ source_class: sourceClass }) => sourceClass === "wikijump",
);
const rawIdSet = new Set(rawIds);
const sourceClassByLocal = new Map(
  rawEntries.map(({ source_class: sourceClass, record }) => [
    record.surface_id,
    sourceClass,
  ]),
);
const publicIds = new Set(
  currentPublicEntries.map(({ record }) => record.surface_id),
);

for (const edge of inventory.relationship_edges) {
  if (!inventory.relationship_edge_types.includes(edge.type))
    fail(`untyped relationship: ${edge.type}`);
}
const aliases = inventory.relationship_edges.filter(
  ({ type }) => type === "alias",
);
for (const { source, target } of aliases) {
  if (!rawIdSet.has(source)) fail(`alias source is missing: ${source}`);
  if (!rawIdSet.has(target)) fail(`alias target is missing: ${target}`);
}
const canonicalRelationships = inventory.relationship_edges.filter(
  ({ source, type }) =>
    publicIds.has(source) && ["alias", "equivalence"].includes(type),
);
const relationshipSources = new Set(
  canonicalRelationships.map(({ source }) => source),
);
if (canonicalRelationships.some(({ target }) => !publicIds.has(target)))
  fail("public deduplication target is missing");
if (
  canonicalRelationships.some(({ target }) => relationshipSources.has(target))
)
  fail("public deduplication target must be canonical");
if (relationshipSources.size !== canonicalRelationships.length)
  fail("public source has multiple deduplication targets");

let previous = null;
try {
  previous = JSON.parse(await readFile(outputPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (previous && previous.schema !== "wikijump.compatibility_ledger.v1")
  fail("existing output has an unsupported schema");
const previousDeferredRecords = previous?.deferred_exclusions?.records ?? [];
if (previous?.deferred_exclusions && !Array.isArray(previousDeferredRecords))
  fail("existing deferred exclusions must be an array");
if (
  new Set(previousDeferredRecords.map(({ source_local_id: sourceLocalId }) => sourceLocalId)).size !==
  previousDeferredRecords.length
)
  fail("duplicate existing deferred exclusion identity");
for (const record of previousDeferredRecords) {
  const expected = deferredIdentityById.get(record.source_local_id);
  if (
    expected === undefined ||
    record.kind !== expected.kind ||
    record.deferred_owner !== expected.deferred_owner
  ) {
    fail("unknown deferred ownership");
  }
}
function requireUniqueExisting(rows, field, identity) {
  const values = (rows ?? []).map((row) => row[field]);
  if (values.some((value) => typeof value !== "string" || value === ""))
    fail(`missing existing ${identity}`);
  if (new Set(values).size !== values.length)
    fail(`duplicate existing ${identity}`);
}
for (const [rows, field, identity] of [
  [previous?.source_local_identities, "source_local_id", "source local identity"],
  [previous?.source_local_identities, "raw_record_id", "raw record identity"],
  [previous?.surface_assignments, "assignment_id", "assignment identity"],
  [previous?.surface_assignments, "surface_id", "surface identity"],
  [previous?.surface_assignments, "raw_record_id", "assigned raw record identity"],
  [previous?.relationships, "relationship_id", "relationship identity"],
  [previous?.rows, "surface_id", "row surface identity"],
])
  requireUniqueExisting(rows, field, identity);
for (const { source_local_id: localId } of previous?.source_local_identities ??
  []) {
  if (deferredIdentitySet.has(localId))
    fail(`deferred source in current ledger: ${localId}`);
  if (!rawIdSet.has(localId)) fail(`raw source disappeared: ${localId}`);
}

const previousLocalByRaw = new Map(
  previous?.source_local_identities?.map((row) => [
    row.source_local_id,
    row.raw_record_id,
  ]) ?? [],
);
const usedRawIds = new Set(previousLocalByRaw.values());
const rawRecordIdByLocal = new Map(
  rawIds.map((localId) => [
    localId,
    previousLocalByRaw.get(localId) ?? nextId("raw:", usedRawIds),
  ]),
);

const previousLocalByRawId = new Map(
  previous?.source_local_identities?.map((row) => [
    row.raw_record_id,
    row.source_local_id,
  ]) ?? [],
);
const previousSurfaceByLocal = new Map(
  (previous?.surface_assignments ?? []).map((row) => [
    previousLocalByRawId.get(row.raw_record_id),
    row.surface_id,
  ]),
);
const usedSurfaceIds = new Set(previousSurfaceByLocal.values());
const canonicalLocalIds = currentPublicEntries
  .map(({ record }) => record.surface_id)
  .filter((localId) => !relationshipSources.has(localId));
const surfaceIdByLocal = new Map(
  canonicalLocalIds.map((localId) => [
    localId,
    previousSurfaceByLocal.get(localId) ?? nextId("surface:", usedSurfaceIds),
  ]),
);
const previousAssignmentByLocal = new Map(
  (previous?.surface_assignments ?? []).map((row) => [
    previousLocalByRawId.get(row.raw_record_id),
    row.assignment_id,
  ]),
);
const usedAssignmentIds = new Set(previousAssignmentByLocal.values());

const previousRelationshipByKey = new Map(
  (previous?.relationships ?? []).map((row) => {
    const localId = previousLocalByRawId.get(row.raw_record_id);
    return [
      `${row.relationship_type}\0${localId}\0${row.target_surface_id}`,
      row.relationship_id,
    ];
  }),
);
const usedRelationshipIds = new Set(previousRelationshipByKey.values());
const inventorySha256 = sha256Hex(inventoryBytes);
const manifestByClass = {
  wikijump: "manifest:00000001",
  ftml: "manifest:00000002",
};

const source_manifests = [
  {
    source_manifest_id: manifestByClass.wikijump,
    source_class: "wikijump-consolidated-inventory",
    schema_id: inventory.schema,
    repository: "Rokurolize/wikijump",
    commit: inventory.provenance.wikijump.commit,
    tree: inventory.provenance.wikijump.tree,
    path: inventoryPath,
    sha256: inventorySha256,
  },
  {
    source_manifest_id: manifestByClass.ftml,
    source_class: "ftml-raw-surface-manifest",
    schema_id: inventory.ftml_raw_surface_manifest.schema,
    repository: "Rokurolize/ftml",
    commit: inventory.ftml_raw_surface_manifest.source.commit,
    tree: inventory.ftml_raw_surface_manifest.source.tree,
    path: inventoryPath,
    sha256: inventorySha256,
  },
];

const raw_source_records = currentRawEntries.map(({ record }) => ({
  source_manifest_id:
    manifestByClass[sourceClassByLocal.get(record.surface_id)],
  raw_record_id: rawRecordIdByLocal.get(record.surface_id),
  record_sha256: sha256Hex(stableStringify(record)),
}));
const source_local_identities = currentRawEntries.map(({ record }) => ({
  source_manifest_id:
    manifestByClass[sourceClassByLocal.get(record.surface_id)],
  raw_record_id: rawRecordIdByLocal.get(record.surface_id),
  source_local_id: record.surface_id,
}));
const surface_assignments = canonicalLocalIds.map((localId) => ({
  assignment_id:
    previousAssignmentByLocal.get(localId) ??
    nextId("assignment:", usedAssignmentIds),
  surface_id: surfaceIdByLocal.get(localId),
  source_manifest_id: raw_source_records.find(
    ({ raw_record_id }) => raw_record_id === rawRecordIdByLocal.get(localId),
  ).source_manifest_id,
  raw_record_id: rawRecordIdByLocal.get(localId),
}));

const relationships = canonicalRelationships
  .sort((left, right) => codePointCompare(left.source, right.source))
  .map(({ source, target, type }) => {
    const targetSurface = surfaceIdByLocal.get(target);
    const key = `${type}\0${source}\0${targetSurface}`;
    return {
      relationship_id:
        previousRelationshipByKey.get(key) ??
        nextId("relationship:", usedRelationshipIds),
      relationship_type: type,
      source_manifest_id: manifestByClass[sourceClassByLocal.get(source)],
      raw_record_id: rawRecordIdByLocal.get(source),
      target_surface_id: targetSurface,
      evidence: [{ path: inventoryPath, sha256: inventorySha256 }],
    };
  });

const rawByLocal = new Map(
  rawEntries.map(({ record }) => [record.surface_id, record]),
);
const specificationOwners = new Set(inventory.owner_keys.specification);
const implementationOwners = new Set(inventory.owner_keys.implementation);

function missingReason(status, unwritten = false) {
  if (status === "blocked" || status === "failed") return "blocked";
  return unwritten ? "not_written" : "not_observed";
}

function testReferences(references) {
  return references
    .flatMap((reference) => reference.split(/;\s*/u))
    .filter(Boolean)
    .map((reference) => {
      const anchored = reference.includes("#")
        ? reference
        : reference.replace("::", "#");
      return `test:${anchored.includes("#") ? anchored : `${anchored}#file`}`;
    })
    .sort(codePointCompare);
}

function proofProjection(status) {
  if (status === "pending") return { state: "pending", artifacts: [] };
  if (status === "passed") {
    return {
      state: "pass",
      artifacts: [{ path: inventoryPath, sha256: inventorySha256 }],
    };
  }
  if (status === "failed") {
    return {
      state: "fail",
      artifacts: [{ path: inventoryPath, sha256: inventorySha256 }],
    };
  }
  return { state: "blocked", artifacts: [] };
}

const rows = canonicalLocalIds.map((localId) => {
  const record = rawByLocal.get(localId);
  const specification = record.specification_owner
    ? [record.specification_owner]
    : [];
  const implementation =
    record.implementation_owners ??
    (localId.startsWith("ftml.") ? ["ftml"] : []);
  if (specification.some((owner) => !specificationOwners.has(owner)))
    fail(`unknown specification owner: ${specification[0]}`);
  if (implementation.some((owner) => !implementationOwners.has(owner)))
    fail(`unknown implementation owner: ${implementation[0]}`);
  const issues = [...new Set(record.existing_refs?.issues ?? [])].sort(
    (left, right) => left - right,
  );
  const tests = testReferences(record.existing_refs?.tests ?? []);
  const blocked = [
    record.evidence?.status,
    record.source?.status,
    record.candidate?.status,
    record.standing?.status,
    record.closure?.status,
  ].some((status) => ["blocked", "failed"].includes(status));
  const owners =
    specification.length === 1 && implementation.length > 0
      ? {
          state: "present",
          specification,
          implementation: [...new Set(implementation)].sort(codePointCompare),
        }
      : { state: "missing", reason: "not_recorded" };
  return {
    surface_id: surfaceIdByLocal.get(localId),
    actor: { state: "missing", reason: "not_recorded" },
    input: { state: "missing", reason: "not_recorded" },
    observable_interval: { state: "missing", reason: "not_recorded" },
    result: { state: "missing", reason: "not_recorded" },
    source:
      record.source?.status === "implemented"
        ? {
            state: "present",
            bindings: [
              {
                source_manifest_id:
                  manifestByClass[sourceClassByLocal.get(localId)],
                raw_record_id: rawRecordIdByLocal.get(localId),
              },
            ],
          }
        : {
            state: "missing",
            reason: missingReason(record.source?.status, true),
          },
    evidence:
      record.evidence?.status === "available"
        ? {
            state: "present",
            references: [{ path: inventoryPath, sha256: inventorySha256 }],
          }
        : {
            state: "missing",
            reason: missingReason(record.evidence?.status),
          },
    tests:
      tests.length > 0
        ? { state: "present", references: tests }
        : { state: "missing", reason: "not_written" },
    owners,
    issues:
      issues.length > 0
        ? { state: "present", numbers: issues }
        : { state: "missing", reason: "not_recorded" },
    blockers:
      blocked && issues.length > 0
        ? { state: "present", numbers: issues }
        : { state: "none", numbers: [] },
    candidate: proofProjection(record.candidate?.status),
    standing: proofProjection(record.standing?.status),
    closure: {
      state: record.closure?.status === "closed" ? "closed" : "open",
      references: record.closure?.references ?? [],
    },
  };
});

const ledger = {
  schema: "wikijump.compatibility_ledger.v1",
  counts: {
    raw_records: currentRawEntries.length,
    public_inventory_records: currentPublicEntries.length,
    canonical_surfaces: canonicalLocalIds.length,
    input_alias_edges: aliases.length,
    deduplication_relationships: relationships.length,
  },
  inputs: {
    inventory: { path: inventoryPath, sha256: inventorySha256 },
    wikijump: inventory.provenance.wikijump,
    ftml: inventory.provenance.ftml,
  },
  source_manifests,
  raw_source_records,
  source_local_identities,
  surface_assignments,
  relationships,
  deferred_exclusions: {
    count: deferredEntries.length,
    by_kind: countBy(
      deferredEntries.map(({ record }) => record),
      "kind",
    ),
    by_owner: countBy(deferredEntries, "deferred_owner"),
    records: deferredEntries.map(({ record, deferred_owner: deferredOwnerValue }) => ({
      source_local_id: record.surface_id,
      kind: record.kind,
      deferred_owner: deferredOwnerValue,
    })),
  },
  rows,
};

const temporaryOutput = `${outputPath}.tmp-${process.pid}`;
try {
  await writeFile(temporaryOutput, `${JSON.stringify(ledger, null, 2)}\n`);
  await rename(temporaryOutput, outputPath);
} catch (error) {
  await rm(temporaryOutput, { force: true });
  throw error;
}
process.stdout.write(
  `${ledger.counts.canonical_surfaces} canonical compatibility surfaces\n`,
);
