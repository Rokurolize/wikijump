import assert from "node:assert/strict";
import test from "node:test";

import {
  assertExactCompatibilityDeferredScope,
  compatibilityDeferredEntries,
  deferredCompatibilityOwner,
} from "../src/compatibility-deferred-scope.mjs";

function catalogRecord(surfaceId, overrides = {}) {
  return {
    surface_id: surfaceId,
    kind: "catalog_feature",
    specification_owner: surfaceId.replace("catalog-feature:", "catalog.feature:"),
    implementation_owners: [],
    ...overrides,
  };
}

function kindRecord(kind, specificationOwner, implementationOwner) {
  return {
    surface_id: `deferred-${kind}-probe`,
    kind,
    specification_owner: specificationOwner,
    implementation_owners: [implementationOwner],
  };
}

test("records outside the wikijump source class are never deferred", () => {
  const record = catalogRecord("catalog-feature:api-pages-select");
  assert.equal(deferredCompatibilityOwner("external", record), null);
  assert.equal(deferredCompatibilityOwner("framerail", record), null);
});

test("non-object compatibility records are rejected", () => {
  for (const record of [null, 42, "catalog-feature:api-pages-select", []]) {
    assert.throws(
      () => deferredCompatibilityOwner("wikijump", record),
      /compatibility source record must be an object/,
    );
  }
});

test("listed catalog features route to the XML-RPC API owner", () => {
  assert.equal(
    deferredCompatibilityOwner(
      "wikijump",
      catalogRecord("catalog-feature:api-pages-select"),
    ),
    "wikijump.xmlrpc-api",
  );
  assert.equal(
    deferredCompatibilityOwner(
      "wikijump",
      catalogRecord("catalog-feature:api-users-get-me"),
    ),
    "wikijump.xmlrpc-api",
  );
});

test("catalog records with unexpected shape throw instead of routing", () => {
  const surfaceId = "catalog-feature:api-pages-select";
  assert.throws(
    () =>
      deferredCompatibilityOwner(
        "wikijump",
        catalogRecord(surfaceId, { kind: "catalog_query" }),
      ),
    /unknown deferred ownership: catalog-feature:api-pages-select/,
  );
  assert.throws(
    () =>
      deferredCompatibilityOwner(
        "wikijump",
        catalogRecord(surfaceId, { specification_owner: "other:api-pages-select" }),
      ),
    /unknown deferred ownership: catalog-feature:api-pages-select/,
  );
  assert.throws(
    () =>
      deferredCompatibilityOwner(
        "wikijump",
        catalogRecord(surfaceId, { implementation_owners: ["wikijump.framerail"] }),
      ),
    /unknown deferred ownership: catalog-feature:api-pages-select/,
  );
});

test("unlisted surfaces with unknown kinds are not deferred", () => {
  assert.equal(
    deferredCompatibilityOwner("wikijump", {
      surface_id: "custom-surface",
      kind: "custom_kind",
      specification_owner: "custom.owner",
      implementation_owners: [],
    }),
    null,
  );
});

test("framerail XML-RPC methods route to the XML-RPC API owner", () => {
  assert.equal(
    deferredCompatibilityOwner(
      "wikijump",
      kindRecord(
        "framerail_xmlrpc_method",
        "wikijump.registry:framerail-xmlrpc",
        "wikijump.framerail",
      ),
    ),
    "wikijump.xmlrpc-api",
  );
});

test("wikidot-py AMC shapes route to the external owner", () => {
  assert.equal(
    deferredCompatibilityOwner(
      "wikijump",
      kindRecord(
        "wikidot_py_amc_module_shape",
        "wikijump.registry:wikidot-py-amc",
        "external.wikidot-py",
      ),
    ),
    "external.wikidot-py",
  );
});

test("kind records with unexpected ownership throw instead of routing", () => {
  assert.throws(
    () =>
      deferredCompatibilityOwner(
        "wikijump",
        kindRecord(
          "framerail_xmlrpc_method",
          "wikijump.registry:framerail-xmlrpc",
          "wikijump.registry:framerail-xmlrpc",
        ),
      ),
    /unknown deferred ownership/,
  );
  assert.throws(
    () =>
      deferredCompatibilityOwner("wikijump", {
        surface_id: "deferred-shape-probe",
        kind: "wikidot_py_amc_module_shape",
        specification_owner: "wikijump.registry:wikidot-py-amc",
        implementation_owners: ["external.wikidot-py", "wikijump.framerail"],
      }),
    /unknown deferred ownership/,
  );
});

test("deferred entries keep only routed records with their deferred owner", () => {
  const routed = catalogRecord("catalog-feature:api-tags-select");
  const unrouted = {
    surface_id: "custom-surface",
    kind: "custom_kind",
    specification_owner: "custom.owner",
    implementation_owners: [],
  };
  assert.deepEqual(compatibilityDeferredEntries([routed, unrouted]), [
    {
      record: routed,
      source_local_id: "catalog-feature:api-tags-select",
      kind: "catalog_feature",
      deferred_owner: "wikijump.xmlrpc-api",
    },
  ]);
  assert.deepEqual(compatibilityDeferredEntries([unrouted]), []);
});

test("non-array inventory input is rejected", () => {
  assert.throws(
    () => compatibilityDeferredEntries(null),
    /compatibility inventory surfaces must be an array/,
  );
  assert.throws(
    () => assertExactCompatibilityDeferredScope({}),
    /deferred compatibility entries must be an array/,
  );
});

function frozenScopeEntries() {
  const entries = [];
  for (let index = 0; index < 15; index += 1) {
    entries.push({ kind: "catalog_feature", deferred_owner: "wikijump.xmlrpc-api" });
  }
  for (let index = 0; index < 17; index += 1) {
    entries.push({
      kind: "framerail_xmlrpc_method",
      deferred_owner: "wikijump.xmlrpc-api",
    });
  }
  for (let index = 0; index < 22; index += 1) {
    entries.push({
      kind: "wikidot_py_amc_module_shape",
      deferred_owner: "external.wikidot-py",
    });
  }
  return entries;
}

test("the frozen deferred scope counts are accepted exactly", () => {
  assert.equal(assertExactCompatibilityDeferredScope(frozenScopeEntries()), true);
});

test("a short deferred scope is rejected", () => {
  assert.throws(
    () => assertExactCompatibilityDeferredScope(frozenScopeEntries().slice(1)),
    /deferred compatibility scope must contain exactly 54 rows/,
  );
});

test("a full-size scope with shifted kind counts is rejected", () => {
  const entries = frozenScopeEntries();
  entries[0] = {
    kind: "framerail_xmlrpc_method",
    deferred_owner: "wikijump.xmlrpc-api",
  };
  assert.throws(
    () => assertExactCompatibilityDeferredScope(entries),
    /deferred compatibility kind counts do not match the frozen scope/,
  );
});

test("a full-size scope with shifted owner counts is rejected", () => {
  const entries = frozenScopeEntries();
  entries[entries.length - 1] = {
    kind: "wikidot_py_amc_module_shape",
    deferred_owner: "wikijump.xmlrpc-api",
  };
  assert.throws(
    () => assertExactCompatibilityDeferredScope(entries),
    /deferred compatibility owner counts do not match the frozen scope/,
  );
});
