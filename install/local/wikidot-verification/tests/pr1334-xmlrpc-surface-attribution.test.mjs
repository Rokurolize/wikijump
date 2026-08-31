import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { historicalSha256, historicalText } from "./historical-git.mjs"

const artifactUrl = new URL("artifacts/pr1334-xmlrpc-surface-attribution-20260810.json", new URL("../", import.meta.url))
const captureCommit = "fa8e3f381e290caeff9e78bd8ab4468075e61469"

async function loadArtifact() {
  try {
    return JSON.parse(await readFile(artifactUrl, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("artifact_missing: run bounded XML-RPC source-attribution capture")
    throw error
  }
}

const artifact = await loadArtifact()
const fixture = JSON.parse(historicalText(captureCommit, "install/local/wikidot-verification/fixtures/pr1334-xmlrpc-surface-attribution.json"))
const recordById = new Map(artifact.records.map((record) => [record.surface_id, record]))

test("base, fixture, script, inventory identity, and privacy", async () => {
  assert.equal(artifact.base_commit, fixture.base_commit)
  assert.equal(artifact.fixture_sha256, historicalSha256(captureCommit, "install/local/wikidot-verification/fixtures/pr1334-xmlrpc-surface-attribution.json"))
  assert.equal(artifact.capture_script_sha256, historicalSha256(captureCommit, "install/local/wikidot-verification/scripts/capture_pr1334_xmlrpc_surface_attribution.py"))
  assert.equal(artifact.inventory_sha256, historicalSha256(captureCommit, "docs/development/compatibility-surface-inventory.json"))
  assert.equal(artifact.private_output_retained, false)
  const text = JSON.stringify(artifact)
  assert.doesNotMatch(text, /(?:\/home\/|\/mnt\/|[A-Za-z]:\\)/)
  assert.doesNotMatch(text, /(?:Basic|Bearer)\s+[A-Za-z0-9+/_=-]+/)
  const forbiddenKeys = new Set(["cookie", "setcookie", "password", "secret", "csrf", "authorization", "authorizationheader", "session", "sessionid", "sessiontoken", "bearertoken", "apikey"])
  const visit = (value) => {
    if (!value || typeof value !== "object") return
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key.toLowerCase().replaceAll(/[^a-z0-9]/g, "")), false, `credential-bearing key retained: ${key}`)
      visit(child)
    }
  }
  visit(artifact)
  const allowedSourcePaths = new Set(fixture.allowed_source_input_paths)
  const allowedPublicTestPaths = new Set(fixture.allowed_public_test_paths)
  for (const record of artifact.records) {
    for (const source of [record.registry_declaration, record.dispatch_branch, record.specification, record.route_source].filter(Boolean)) {
      assert.equal(allowedSourcePaths.has(source.path), true, `source path is outside the fixture allowlist: ${source.path}`)
      assert.equal(source.sha256, historicalSha256(artifact.base_commit, source.path))
    }
    for (const source of record.public_test_witnesses ?? []) {
      assert.equal(allowedPublicTestPaths.has(source.path), true, `public test path is outside the fixture allowlist: ${source.path}`)
      assert.equal(source.sha256, historicalSha256(artifact.base_commit, source.path))
    }
  }
})

test("exact 31-ID denominator and ownership", () => {
  assert.equal(artifact.surface_count, 31)
  assert.deepEqual(artifact.surface_ids, [...fixture.surface_ids].sort())
  assert.deepEqual(artifact.records.map((record) => record.surface_id), [...fixture.surface_ids].sort())
  assert.equal(new Set(artifact.surface_ids).size, 31)
  for (const record of artifact.records) {
    assert.equal(record.claim_scope, "source_attribution_only")
    if (record.surface_id.startsWith("framerail-xmlrpc:")) assert.equal(record.inventory_public_owner, "framerail")
    if (record.surface_id.startsWith("catalog-feature:")) assert.equal(record.inventory_public_owner, "docs/wikidot-specifications")
  }
})

test("exact 17 registry declarations and dispatch branches", () => {
  const methods = artifact.records.filter((record) => record.surface_id.startsWith("framerail-xmlrpc:"))
  assert.equal(methods.length, 17)
  for (const record of methods) {
    assert.equal(record.source_owner, "framerail/src/lib/server/xmlrpc")
    assert.match(record.registry_declaration.anchor, /^".+": \{$/)
    assert.match(record.dispatch_branch.anchor, /^case ".+":$/)
    assert.ok(record.public_test_witnesses.length > 0)
    assert.equal(record.claim, "registry_dispatch_and_test_attribution_only")
  }
})

test("exact 13 catalog mappings", () => {
  const catalogs = artifact.records.filter((record) => record.surface_id.startsWith("catalog-feature:"))
  assert.equal(catalogs.length, 13)
  assert.equal(Object.keys(fixture.catalog_method_mappings).length, 13)
  for (const record of catalogs) {
    assert.equal(record.linked_method_surface_id, fixture.catalog_method_mappings[record.surface_id])
    assert.ok(recordById.has(record.linked_method_surface_id))
    assert.ok(record.public_test_witnesses.length > 0)
    assert.equal(record.claim, "catalog_to_existing_xmlrpc_source_attribution_only")
  }
})

test("route attribution, public-test backing, aggregate counts, and no compatibility overclaim", () => {
  const route = recordById.get("framerail-route:/xml-rpc-api.php")
  assert.equal(route.source_owner, "framerail")
  assert.ok(route.public_test_witnesses.length > 0)
  assert.equal(route.claim, "route_source_and_test_attribution_only")
  assert.deepEqual(artifact.counts, fixture.expected_counts)
  assert.equal(artifact.claim_scope, "source_attribution_only")
  assert.equal(artifact.compatibility_verdict, "not_evaluated")
  assert.equal(artifact.candidate_status, "not_run")
  assert.equal(artifact.standing_status, "not_run")
  assert.equal(artifact.network_requests, 0)
  assert.equal(artifact.mutations, 0)
})
