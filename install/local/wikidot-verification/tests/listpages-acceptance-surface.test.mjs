import assert from "node:assert/strict";
import test from "node:test";

import {
  LISTPAGES_ACCEPTANCE_RENDER_SOURCE_PATHS,
  attestUntouchedListPagesAcceptanceSurface,
} from "../src/listpages-acceptance-surface.mjs";

function surface() {
  return {
    render_source_paths: [...LISTPAGES_ACCEPTANCE_RENDER_SOURCE_PATHS],
    ftml_revision: "a".repeat(40),
    dependency_lock_sha256: "b".repeat(64),
    fixture_plane: {
      runtime_identity_sha256: "c".repeat(64),
      runtime_proof_sha256: "d".repeat(64),
      runtime_observation_stable_sha256: "e".repeat(64),
      service_image_sha256: {
        cache: "f".repeat(64),
        database: "1".repeat(64),
        files: "2".repeat(64),
      },
      service_host_port: { cache: 16379, database: 16432, files: 19002 },
    },
  };
}

test("attests a prior receipt when only verifier tooling changed", () => {
  const dependencySurface = surface();
  const attestation = attestUntouchedListPagesAcceptanceSurface({
    baseRevision: "3".repeat(40),
    headRevision: "4".repeat(40),
    changedPaths: [
      "install/local/wikidot-verification/src/listpages-corpus-replay-reconciliation.mjs",
      "install/local/wikidot-verification/tests/listpages-acceptance-surface.test.mjs",
    ],
    previousSurface: dependencySurface,
    currentSurface: structuredClone(dependencySurface),
    priorReceiptSha256: "5".repeat(64),
  });

  assert.equal(attestation.mode, "untouched-render-surface");
  assert.deepEqual(attestation.render_paths_touched, []);
  assert.deepEqual(attestation.changed_paths, [
    "install/local/wikidot-verification/src/listpages-corpus-replay-reconciliation.mjs",
    "install/local/wikidot-verification/tests/listpages-acceptance-surface.test.mjs",
  ]);
  assert.equal(attestation.prior_receipt_sha256, "5".repeat(64));
  assert.deepEqual(attestation.dependency_surface, dependencySurface);
});

test("requires a fresh authoritative replay when a render source changes", () => {
  const dependencySurface = surface();
  assert.throws(
    () => attestUntouchedListPagesAcceptanceSurface({
      baseRevision: "3".repeat(40),
      headRevision: "4".repeat(40),
      changedPaths: [
        "deepwell/src/services/render/list_pages/rendering.rs",
      ],
      previousSurface: dependencySurface,
      currentSurface: structuredClone(dependencySurface),
      priorReceiptSha256: "5".repeat(64),
    }),
    /requires a fresh authoritative ListPages replay/u,
  );
});

test("requires a fresh authoritative replay when the fixture plane moves", () => {
  const previousSurface = surface();
  const currentSurface = structuredClone(previousSurface);
  currentSurface.fixture_plane.runtime_proof_sha256 = "6".repeat(64);
  assert.throws(
    () => attestUntouchedListPagesAcceptanceSurface({
      baseRevision: "3".repeat(40),
      headRevision: "4".repeat(40),
      changedPaths: ["install/local/wikidot-verification/src/receipt.mjs"],
      previousSurface,
      currentSurface,
      priorReceiptSha256: "5".repeat(64),
    }),
    /dependency surface changed/u,
  );
});
