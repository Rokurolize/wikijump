import assert from "node:assert/strict";
import test from "node:test";

import {cleanupPageIfRunOwned, pageIdentityFields} from "../scripts/capture-open43-q1035-listdrafts-nonempty.mjs";

test("draft lifecycle keeps the known existing-page identity when PageEditModule omits it", () => {
  assert.deepEqual(pageIdentityFields({page_id: 17}, 23), {page_id: "17"});
  assert.deepEqual(pageIdentityFields({}, 23), {page_id: "23"});
  assert.deepEqual(pageIdentityFields({}, null), {});
});

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
