import assert from "node:assert/strict";
import test from "node:test";

import {cleanupPageIfRunOwned} from "../scripts/capture-open43-q1035-listdrafts-nonempty.mjs";

test("cleanup never deletes a page that this run did not create", async () => {
  let removeCalls = 0;
  const owner = {removePage: async () => { removeCalls += 1; }};

  assert.deepEqual(await cleanupPageIfRunOwned(owner, "existing", "source", false), {slug: "existing", status: "not-run-owned"});
  assert.equal(removeCalls, 0);
});

test("cleanup delegates deletion only for a run-owned page", async () => {
  const owner = {removePage: async (slug, expectedSource) => ({slug, status: "deleted", expectedSource})};

  assert.deepEqual(await cleanupPageIfRunOwned(owner, "created", "source", true), {slug: "created", status: "deleted", expectedSource: "source"});
});
