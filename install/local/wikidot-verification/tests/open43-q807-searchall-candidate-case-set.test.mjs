import assert from "node:assert/strict";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";

test("Q807 candidate case reaches prepare through the public command path with JSON input", async () => {
  const caseSet = await candidateCaseSet("open43-searchall");
  const prepared = await caseSet.prepareRun({
    runId: "candidate-case-0123456789ab",
    candidateIdentity: {
      candidate: {
        endpoint: {
          scheme: "https",
          host: "scpaiueouiuiuiui.wikijump.localhost",
          port: 18443,
        },
        port_443_published: false,
      },
    },
    candidateIdentitySha256: "a".repeat(64),
    privateInput: JSON.parse('{"fixture":"saved-search"}'),
    privateInputSha256: "b".repeat(64),
    signal: null,
    resources: { register() {}, release() {} },
    candidateBrowserContexts: {
      setActiveFixture() { throw new Error("browser must not start during prepare"); },
      newCandidateContext() { throw new Error("browser must not start during prepare"); },
    },
  });

  assert.deepEqual(caseSet.caseIds, ["Q807_EXACT_CANDIDATE_FORM_ROUTE_BROWSER"]);
  assert.equal(prepared.plan.issue, 807);
  assert.equal(prepared.plan.saved_page_slug, "search:all");
  assert.equal(prepared.browserCredentialPolicy, "none");
  assert.equal(typeof prepared.execute, "function");
});
