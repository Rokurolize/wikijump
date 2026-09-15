import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { verifyOpen43Q807SearchAllCase } from "../src/open43-q807-searchall-candidate-case-set.mjs";

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
  assert.deepEqual(prepared.plan.negative_boundaries.map(({ case_id }) => case_id), [
    "searchall-route-unknown-area-query",
    "searchall-route-query-without-area",
  ]);
  assert.equal(prepared.browserCredentialPolicy, "none");
  assert.equal(typeof prepared.execute, "function");

  const changedEvidencePlan = structuredClone(prepared.plan);
  changedEvidencePlan.fixture_sha256 = "b".repeat(64);
  assert.throws(
    () => verifyOpen43Q807SearchAllCase({}, changedEvidencePlan),
    /Q807 fixture digest differs from sealed live evidence/,
  );
});

test("Q807 audit treats the observed unavailable state as the current result contract", () => {
  const audit = JSON.parse(readFileSync(new URL("../../../../docs/development/open43-q-search-users-closure-audit.json", import.meta.url), "utf8"));
  const issue = audit.issues.find(({ issue: number }) => number === 807);
  assert.ok(issue);
  assert.equal(issue.blocked_evidence.some(({ case_id }) => case_id === "Q807_SUCCESSFUL_SEARCH_RESULTS"), false);
  const unavailableRow = issue.source_ready.find(({ case_id }) => case_id === "Q807_SUCCESSFUL_SEARCH_RESULTS");
  assert.ok(unavailableRow);
  assert.match(unavailableRow.result, /unavailable state is the current positive compatibility contract/u);
  assert.deepEqual(issue.candidate_required.map(({ case_id }) => case_id), ["Q807_EXACT_CANDIDATE_FORM_ROUTE_BROWSER"]);
});
