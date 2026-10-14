import assert from "node:assert/strict";
import test from "node:test";

import {main, seedPlan} from "../scripts/seed-promotion-candidate.mjs";

function identity(overrides = {}) {
  return {
    candidate: {
      compose_project: "wjcand-promotion-20261015-325a56cc",
      owner: "compatibility-candidate",
      port_443_published: false,
      ...overrides,
    },
  };
}

test("seed plan names only the candidate's own containers and shared buckets", () => {
  const plan = seedPlan({
    identity: identity(),
    standingBuckets: [".minio.sys", "deepwell-files", "deepwell-text-blocks", "dw-test-992bffdc-files"],
    candidateBuckets: [".minio.sys", "deepwell-text-blocks", "deepwell-files"],
  });
  assert.deepEqual(plan.buckets, ["deepwell-files", "deepwell-text-blocks"]);
  assert.equal(plan.candidate.database, "wjcand-promotion-20261015-325a56cc-database-1");
  assert.equal(plan.standing.database, "wikijump-standing-database-1");
  assert.ok(Object.values(plan.candidate).every((name) => name.startsWith("wjcand-")));
});

test("seed plan refuses standing, 443-publishing, or foreign projects", () => {
  const buckets = {standingBuckets: ["deepwell-files"], candidateBuckets: ["deepwell-files"]};
  assert.throws(() => seedPlan({identity: identity({compose_project: "wikijump-standing"}), ...buckets}), /not an isolated candidate/u);
  assert.throws(() => seedPlan({identity: identity({compose_project: "wikijump-dev"}), ...buckets}), /not an isolated candidate/u);
  assert.throws(() => seedPlan({identity: identity({port_443_published: true}), ...buckets}), /port 443/u);
  assert.throws(() => seedPlan({identity: identity({owner: "someone"}), ...buckets}), /candidate-owned/u);
});

test("seed plan refuses a candidate object store with no standing bucket", () => {
  assert.throws(
    () => seedPlan({identity: identity(), standingBuckets: ["deepwell-files"], candidateBuckets: [".minio.sys", "other"]}),
    /shares no bucket/u,
  );
});

test("seed CLI requires the candidate root and output", async () => {
  await assert.rejects(main(["--candidate-root", "/x"]), /usage/u);
});
