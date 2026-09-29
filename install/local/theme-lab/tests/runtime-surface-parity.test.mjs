import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {KNOWN_THEME_SURFACES, analyzeThemeSurfaceUsage} from "../src/theme-surface-contract.mjs";
import {
  RUNTIME_SURFACE_PARITY,
  annotateRuntimeSurfaceUsage,
  applyRuntimeSurfaceParityGate,
  parityReviewForSurfaceIds,
} from "../src/runtime-surface-parity.mjs";
import {buildVerdict} from "../src/verdict.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const registryById = new Map(RUNTIME_SURFACE_PARITY.surfaces.map((surface) => [surface.surface_id, surface]));

test("registry classifies every discovered and interactive runtime surface explicitly", () => {
  const captureSource = fs.readFileSync(path.join(root, "ports/interactive-visual-fixture/capture-interactive.mjs"), "utf8");
  const interactiveIds = [...captureSource.matchAll(/surface\s*:\s*['"]([^'"]+)['"]/gu)].map((match) => match[1]);
  assert.ok(interactiveIds.length > 0);

  for (const surface of [...KNOWN_THEME_SURFACES.map((row) => row.id), ...interactiveIds]) {
    assert.ok(registryById.has(surface), `missing parity status for ${surface}`);
  }
  for (const surface of RUNTIME_SURFACE_PARITY.surfaces) {
    assert.ok([
      "PARITY_CERTIFIED",
      "PARITY_MISMATCH",
      "INSUFFICIENT_EVIDENCE",
      "THEME_LAB_ONLY_SYNTHETIC_SURFACE",
    ].includes(surface.status), surface.surface_id);
    assert.ok("evidence_reference" in surface, surface.surface_id);
    assert.ok(Array.isArray(surface.implementation_reference), surface.surface_id);
    assert.ok(Array.isArray(surface.test_reference), surface.surface_id);
    assert.equal(typeof surface.may_treat_differences_as_port_requirements, "boolean", surface.surface_id);
    assert.ok(Array.isArray(surface.intentional_differences), surface.surface_id);
    assert.ok(Array.isArray(surface.unresolved_evidence_gaps), surface.surface_id);
  }
});

test("surface CSS auto-discovery includes History and Files even when evidence is insufficient", () => {
  const result = analyzeThemeSurfaceUsage(`
    .page-history td.optionstd a { white-space: nowrap; }
    .file-list .file-name { overflow-wrap: anywhere; }
  `, "auto");
  assert.deepEqual(result.surfaces.map((row) => row.id), ["page.history", "page.files"]);
  const reviewed = annotateRuntimeSurfaceUsage(result);
  assert.equal(reviewed.surfaces.find((row) => row.id === "page.history").parity_review.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(reviewed.surfaces.find((row) => row.id === "page.files").parity_review.may_treat_differences_as_port_requirements, false);
});

test("uncertified and unclassified runtime findings cannot become port next-actions", () => {
  const verdict = buildVerdict({extraIssues: [
    {severity: "error", kind: "surface_fixture_missing", surface: "page.history", selector: ".page-history"},
    {severity: "warn", kind: "missing_selector", selector: ".new-unknown-runtime-selector", reference: 1, candidate: 0},
    {severity: "error", kind: "candidate_asset_missing", asset: "logo.svg"},
  ]});

  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.next_actions.length, 1);
  assert.equal(verdict.next_actions[0].kind, "provide_asset");
  assert.equal(verdict.parity_gate.status, "quarantined_findings_present");
  assert.equal(verdict.parity_gate.quarantined_count, 2);
  assert.ok(verdict.top_issues.every((issue) => issue.parity_review));
  assert.equal(verdict.top_issues.find((issue) => issue.surface === "page.history").parity_review.quarantined, true);
});

test("an explicitly certified scoped contract remains actionable", () => {
  const review = parityReviewForSurfaceIds(["page.history.table-dom"]);
  assert.equal(review.status, "PARITY_CERTIFIED");
  assert.equal(review.may_treat_differences_as_port_requirements, true);

  const result = applyRuntimeSurfaceParityGate([
    {severity: "error", kind: "surface_fixture_missing", surface: "page.history.table-dom", selector: "tr#revision-row-1"},
  ]);
  assert.equal(result.issues[0].parity_review.quarantined, false);
});

test("synthetic Theme Lab states stay identified as synthetic and never certify a runtime surface", () => {
  const row = registryById.get("nav.mobile-top.forced-submenu-state");
  assert.equal(row.status, "THEME_LAB_ONLY_SYNTHETIC_SURFACE");
  const review = parityReviewForSurfaceIds(["nav.mobile-top.forced-submenu-state"]);
  assert.equal(review.may_treat_differences_as_port_requirements, false);
  assert.equal(review.quarantined, true);
});
