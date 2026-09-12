function sortedUnique(values, context) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error(`${context} must be an array of non-empty strings`);
  }
  const sorted = [...new Set(values)].sort();
  if (sorted.length !== values.length || JSON.stringify(sorted) !== JSON.stringify(values)) {
    throw new Error(`${context} must be sorted and duplicate-free`);
  }
  return sorted;
}

function equalStrings(actual, expected, context) {
  const a = [...actual].sort();
  const e = [...expected].sort();
  if (JSON.stringify(a) !== JSON.stringify(e)) {
    throw new Error(`${context} drift: expected ${e.length} entries, found ${a.length}`);
  }
}

function requireObject(value, context) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value;
}

function expectedWwsSurfaceIds(denominator) {
  if (
    denominator?.schema !== "wikijump.wws_route_registration_denominator.v2" ||
    !Array.isArray(denominator.registrations) ||
    denominator.counts?.registrations !== denominator.registrations.length
  ) {
    throw new Error("WWS route denominator is malformed");
  }
  const registrations = new Set();
  const byPath = new Map();
  for (const registration of denominator.registrations) {
    const method = registration?.declared_method_class;
    const routePath = registration?.path;
    const registrationId = `wws-route-registration:${method}:${routePath}`;
    if (
      !["ANY", "GET"].includes(method) ||
      typeof routePath !== "string" ||
      routePath.length === 0 ||
      registration.registration_id !== registrationId ||
      registrations.has(registrationId)
    ) {
      throw new Error("WWS route denominator has an invalid or duplicate registration");
    }
    registrations.add(registrationId);
    const pathRegistrations = byPath.get(routePath) ?? [];
    pathRegistrations.push(registration);
    byPath.set(routePath, pathRegistrations);
  }
  const ids = [];
  for (const [routePath, pathRegistrations] of byPath) {
    const getRegistration = pathRegistrations.find(({ declared_method_class: method }) => method === "GET") ?? null;
    const anyRegistration = pathRegistrations.find(({ declared_method_class: method }) => method === "ANY") ?? null;
    if (pathRegistrations.length > Number(getRegistration !== null) + Number(anyRegistration !== null)) {
      throw new Error(`WWS route denominator has duplicate method classes for ${routePath}`);
    }
    if (getRegistration === null) {
      ids.push(`wws-route:ANY:${routePath}`);
      continue;
    }
    ids.push(`wws-route:GET:${routePath}`, `wws-route:HEAD:${routePath}`);
    if (anyRegistration !== null || getRegistration.fallback_handler_symbol !== null) {
      ids.push(`wws-route:FALLBACK:${routePath}`);
    }
  }
  return ids.sort();
}

export function verifyTrackedContractConsistency({
  inventory,
  semantics,
  deepwellManifest,
  wwsDenominator,
}) {
  if (inventory?.schema !== "wikijump.compatibility_surface_inventory.v2" || !Array.isArray(inventory.surfaces)) {
    throw new Error("compatibility surface inventory is malformed");
  }
  if (semantics?.schema !== "wikijump.compatibility_surface_semantics.v1") {
    throw new Error("compatibility surface semantics registry is malformed");
  }
  if (
    deepwellManifest?.schema !== "wikijump.deepwell_jsonrpc_contract_manifest.v1" ||
    !Array.isArray(deepwellManifest.methods) ||
    deepwellManifest.method_count !== deepwellManifest.methods.length
  ) {
    throw new Error("Deepwell JSON-RPC contract manifest is malformed");
  }

  const surfaceIds = inventory.surfaces.map(({ surface_id: surfaceId }) => surfaceId);
  if (surfaceIds.some((surfaceId) => typeof surfaceId !== "string" || surfaceId.length === 0)) {
    throw new Error("compatibility inventory has an invalid surface ID");
  }
  if (new Set(surfaceIds).size !== surfaceIds.length) throw new Error("compatibility inventory has duplicate surface IDs");

  const byKind = new Map();
  for (const surface of inventory.surfaces) {
    if (typeof surface.kind !== "string" || surface.kind.length === 0) throw new Error("compatibility inventory has an invalid surface kind");
    byKind.set(surface.kind, (byKind.get(surface.kind) ?? 0) + 1);
  }
  if (inventory.counts?.total !== inventory.surfaces.length) throw new Error("compatibility inventory total count is stale");
  const countedKinds = Object.fromEntries([...byKind.entries()].sort(([a], [b]) => a.localeCompare(b)));
  if (JSON.stringify(countedKinds) !== JSON.stringify(inventory.counts?.by_kind ?? null)) {
    throw new Error("compatibility inventory kind counts are stale");
  }

  const deepwellMethods = deepwellManifest.methods.map(({ method }) => method);
  if (deepwellMethods.some((method) => typeof method !== "string" || method.length === 0) || new Set(deepwellMethods).size !== deepwellMethods.length) {
    throw new Error("Deepwell JSON-RPC contract manifest has invalid or duplicate methods");
  }
  const expectedDeepwell = deepwellMethods.map((method) => `deepwell-jsonrpc:${method}`);
  const actualDeepwell = inventory.surfaces
    .filter(({ kind }) => kind === "deepwell_jsonrpc_method")
    .map(({ surface_id: surfaceId }) => surfaceId);
  equalStrings(actualDeepwell, expectedDeepwell, "Deepwell inventory surface denominator");

  const actualWws = inventory.surfaces
    .filter(({ kind }) => kind === "wws_route")
    .map(({ surface_id: surfaceId }) => surfaceId);
  equalStrings(actualWws, expectedWwsSurfaceIds(wwsDenominator), "WWS inventory surface denominator");

  const specificationOwners = sortedUnique(semantics.specification_owner_keys, "specification owner keys");
  const implementationOwners = sortedUnique(semantics.implementation_owner_keys, "implementation owner keys");
  const specificationOwnerSet = new Set(specificationOwners);
  const implementationOwnerSet = new Set(implementationOwners);
  const usedSpecificationOwners = new Set();
  const usedImplementationOwners = new Set();
  for (const surface of inventory.surfaces) {
    if (typeof surface.specification_owner !== "string" || !specificationOwnerSet.has(surface.specification_owner)) {
      throw new Error(`surface ${surface.surface_id} has an undeclared specification owner`);
    }
    usedSpecificationOwners.add(surface.specification_owner);
    const owners = sortedUnique(surface.implementation_owners, `surface ${surface.surface_id} implementation owners`);
    for (const owner of owners) {
      if (!implementationOwnerSet.has(owner)) throw new Error(`surface ${surface.surface_id} has an undeclared implementation owner`);
      usedImplementationOwners.add(owner);
    }
  }
  equalStrings(usedSpecificationOwners, specificationOwners, "used specification owner denominator");
  equalStrings(usedImplementationOwners, implementationOwners, "used implementation owner denominator");

  const ownerKeys = requireObject(inventory.owner_keys, "compatibility inventory owner_keys");
  equalStrings(ownerKeys.specification ?? [], specificationOwners, "inventory specification owner keys");
  equalStrings(ownerKeys.implementation ?? [], implementationOwners, "inventory implementation owner keys");

  const legacyMappings = requireObject(semantics.implementation_owners_by_legacy_owner, "legacy implementation owner map");
  for (const [legacyOwner, owners] of Object.entries(legacyMappings)) {
    if (legacyOwner.length === 0) throw new Error("legacy implementation owner map has an empty key");
    const mappedOwners = sortedUnique(owners, `legacy implementation owner ${legacyOwner}`);
    for (const owner of mappedOwners) {
      if (!implementationOwnerSet.has(owner)) throw new Error(`legacy implementation owner ${legacyOwner} maps to an undeclared owner`);
    }
  }

  const relationshipTypes = sortedUnique(semantics.relationship_edge_types, "relationship edge types");
  equalStrings(inventory.relationship_edge_types ?? [], relationshipTypes, "inventory relationship edge types");
  if (!Array.isArray(inventory.relationship_edges)) throw new Error("compatibility inventory relationship_edges must be an array");
  const usedRelationshipTypes = new Set();
  for (const edge of inventory.relationship_edges) {
    if (typeof edge?.type !== "string" || !relationshipTypes.includes(edge.type)) {
      throw new Error("compatibility inventory has an undeclared relationship edge type");
    }
    usedRelationshipTypes.add(edge.type);
  }

  return {
    surface_count: inventory.surfaces.length,
    deepwell_method_count: actualDeepwell.length,
    wws_surface_count: actualWws.length,
    specification_owner_count: usedSpecificationOwners.size,
    implementation_owner_count: usedImplementationOwners.size,
    relationship_edge_type_count: relationshipTypes.length,
  };
}
