import assert from "node:assert/strict";
import test from "node:test";

import {buildStandingCompatibilityMatrix} from "../src/compatibility-standing-matrix.mjs";

const promotionRef = {path: "/tmp/promotion.json", sha256: "a".repeat(64)};
const refreshRef = {path: "/tmp/refresh.json", sha256: "b".repeat(64)};
const ledger = {schema: "wikijump.compatibility_ledger.v1", inputs: {wikijump: {commit: "4".repeat(40), tree: "2".repeat(40)}, ftml: {commit: "3".repeat(40), tree: "5".repeat(40)}}};
const denominator = {schema: "wikijump.compatibility_final_zero_denominator.v1", status: "sealed", rows: [{surface_id: "surface:00000001", source_local_id: "catalog-feature:example", kind: "catalog_feature"}]};
const images = {deepwell: `sha256:${"d".repeat(64)}`, framerail: `sha256:${"e".repeat(64)}`, wws: `sha256:${"f".repeat(64)}`};
const promotion = {schema: "wikijump.standing_promotion_precondition.v1", status: "pass", run_id: "candidate-run-0123456789ab", candidate: {wikijump_commit: "1".repeat(40), wikijump_tree: "2".repeat(40), ftml_sha: "3".repeat(40), artifact_key: "c".repeat(64)}, build: {images}};
const refresh = {schema_version: 1, kind: "standing-promotion", status: "pass", run_id: promotion.run_id, wikijump_sha: "4".repeat(40), wikijump_tree: "2".repeat(40), ftml_sha: "3".repeat(40), promotion_precondition: promotionRef, images: Object.fromEntries(Object.entries(images).map(([key, id]) => [key, {id}]))};

test("standing matrix is derived from the fresh merge refresh rather than candidate row status", () => {
  const value = buildStandingCompatibilityMatrix({ledger, denominator, promotion, promotionReference: promotionRef, refresh, refreshReference: refreshRef});
  assert.equal(value.merge_commit, "4".repeat(40));
  assert.equal(value.candidate_commit, "1".repeat(40));
  assert.deepEqual(value.rows[0].artifacts, [refreshRef]);
});

test("standing matrix rejects a standing source that is still the candidate commit", () => {
  assert.throws(() => buildStandingCompatibilityMatrix({ledger: {...ledger, inputs: {...ledger.inputs, wikijump: {commit: "1".repeat(40), tree: "2".repeat(40)}}}, denominator, promotion, promotionReference: promotionRef, refresh: {...refresh, wikijump_sha: "1".repeat(40)}, refreshReference: refreshRef}), /still the candidate PR head/u);
});

