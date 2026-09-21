import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {
  CAMPAIGN_ONLY_MIGRATED_COUNT,
  FINAL_ZERO_SURFACE_COUNT,
  loadOfflineSurfaceCoverage,
  verifyCoverageAnchorFiles,
} from "../src/offline-surface-coverage.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const repositoryRoot = path.resolve(packageRoot, "../../..");
const fixturePath = path.join(
  packageRoot,
  "fixtures/offline-compatibility/final-zero-surface-coverage.json",
);

test("final-zero 900-surface denominator has portable offline ownership", async () => {
  const fixture = await loadOfflineSurfaceCoverage(fixturePath);
  assert.equal(fixture.rows.length, FINAL_ZERO_SURFACE_COUNT);
  assert.equal(fixture.counts.total, FINAL_ZERO_SURFACE_COUNT);
  assert.equal(
    fixture.rows.filter((row) => row.migrated_from_campaign_only).length,
    CAMPAIGN_ONLY_MIGRATED_COUNT,
  );
  assert.equal(fixture.final_zero.denominator_sha256, "17f8099e0a3afc7ae4ece536b9dc57ac4388eb53de5a8c69db0652ce9e6b0192");
  assert.equal(fixture.final_zero.reconciled_ledger_sha256, "c71e7b17ec5607efe3eca046fb902440ac98b2932e6d305fb11d4d0cbf214fe8");
});

test("every frozen surface anchor resolves inside the repository", async () => {
  const fixture = await loadOfflineSurfaceCoverage(fixturePath);
  const result = await verifyCoverageAnchorFiles(fixture, repositoryRoot);
  assert.equal(result.status, "pass", JSON.stringify(result.missing, null, 2));
  assert.ok(result.checked > 100, `expected broad executable coverage, got ${result.checked}`);
});

test("campaign-only acceptance is no longer represented only by WJLab artifacts", async () => {
  const fixture = await loadOfflineSurfaceCoverage(fixturePath);
  const migrated = fixture.rows.filter((row) => row.migrated_from_campaign_only);
  assert.equal(migrated.length, CAMPAIGN_ONLY_MIGRATED_COUNT);
  for (const row of migrated) {
    assert.ok(row.offline_lanes.length > 0, row.surface_id);
    assert.ok(row.anchors.length > 0, row.surface_id);
    assert.equal(row.anchors.some((anchor) => anchor.startsWith("artifact:")), false);
  }
});
