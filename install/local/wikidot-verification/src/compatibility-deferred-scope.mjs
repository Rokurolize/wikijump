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

export const DEFERRED_SCOPE_COUNTS = Object.freeze({
  total: 54,
  by_kind: Object.freeze({
    catalog_feature: 15,
    framerail_xmlrpc_method: 17,
    wikidot_py_amc_module_shape: 22,
  }),
  by_owner: Object.freeze({
    "external.wikidot-py": 22,
    "wikijump.xmlrpc-api": 32,
  }),
});

export function deferredCompatibilityOwner(sourceClass, record) {
  if (sourceClass !== "wikijump") return null;
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("compatibility source record must be an object");
  }

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
      throw new Error(`unknown deferred ownership: ${record.surface_id}`);
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
    throw new Error(`unknown deferred ownership: ${record.surface_id}`);
  }
  return kindOwner.deferred_owner;
}

export function compatibilityDeferredEntries(inventorySurfaces) {
  if (!Array.isArray(inventorySurfaces)) {
    throw new Error("compatibility inventory surfaces must be an array");
  }
  return inventorySurfaces.flatMap((record) => {
    const deferredOwner = deferredCompatibilityOwner("wikijump", record);
    return deferredOwner === null
      ? []
      : [{
          record,
          source_local_id: record.surface_id,
          kind: record.kind,
          deferred_owner: deferredOwner,
        }];
  });
}

export function assertExactCompatibilityDeferredScope(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("deferred compatibility entries must be an array");
  }
  const countBy = (field) =>
    Object.fromEntries(
      [...new Set(entries.map((entry) => entry[field]))]
        .sort()
        .map((value) => [value, entries.filter((entry) => entry[field] === value).length]),
    );
  const byKind = countBy("kind");
  const byOwner = countBy("deferred_owner");
  if (entries.length !== DEFERRED_SCOPE_COUNTS.total) {
    throw new Error(`deferred compatibility scope must contain exactly ${DEFERRED_SCOPE_COUNTS.total} rows`);
  }
  if (JSON.stringify(byKind) !== JSON.stringify(DEFERRED_SCOPE_COUNTS.by_kind)) {
    throw new Error("deferred compatibility kind counts do not match the frozen scope");
  }
  if (JSON.stringify(byOwner) !== JSON.stringify(DEFERRED_SCOPE_COUNTS.by_owner)) {
    throw new Error("deferred compatibility owner counts do not match the frozen scope");
  }
  return true;
}
