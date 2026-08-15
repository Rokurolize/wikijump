import assert from "node:assert/strict";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import {
  OPEN43_BROWSER_CANDIDATE_CASE_IDS,
  OPEN43_PAGE_QUERY_CANDIDATE_CASE_IDS,
  OPEN43_SETTINGS_LIFECYCLE_CANDIDATE_CASE_IDS,
  candidateBehaviorContract,
  verifyOpen43PreparedCandidateCase,
} from "../src/open43-settings-browser-candidate-preparation.mjs";
import { OPEN43_SETTINGS_BROWSER_CASE_IDS } from "../src/open43-settings-browser-candidate-contract.mjs";

const expected = [
  ...OPEN43_SETTINGS_BROWSER_CASE_IDS,
  ...OPEN43_BROWSER_CANDIDATE_CASE_IDS,
  ...OPEN43_SETTINGS_LIFECYCLE_CANDIDATE_CASE_IDS,
  ...OPEN43_PAGE_QUERY_CANDIDATE_CASE_IDS,
];

test("Phase 3 candidate denominators are exact, reachable, and disjoint", async () => {
  const sets = await Promise.all([
    candidateCaseSet("open43-settings-browser"),
    candidateCaseSet("open43-browser-surfaces"),
    candidateCaseSet("open43-settings-lifecycle"),
    candidateCaseSet("open43-page-query-surfaces"),
  ]);
  const owners = new Map();
  for (const set of sets) for (const caseId of set.caseIds) {
    assert.equal(owners.has(caseId), false, `${caseId} has overlapping owners`);
    owners.set(caseId, set.id);
  }
  assert.deepEqual([...owners.keys()], expected);
  assert.equal(owners.size, 32);
  assert.equal(sets[0].caseIds.length, 9);
  assert.equal(sets.slice(1).every((set) => set.preparation_only === true), true);
  assert.equal(owners.get("S758_CREATE_INITIAL"), "open43-settings-lifecycle");
});

test("preparation rows cannot pass without exact observed behavior and identities", () => {
  const caseId = OPEN43_PAGE_QUERY_CANDIDATE_CASE_IDS[0];
  assert.throws(
    () => verifyOpen43PreparedCandidateCase(caseId, { behavior_contract: candidateBehaviorContract(caseId), candidate_configuration: { mode: "preparation_only" } }),
    /evidence/u,
  );
  assert.throws(
    () => verifyOpen43PreparedCandidateCase(caseId, { behavior_contract: { ...candidateBehaviorContract(caseId), surface: "wrong" }, evidence: { status: "observed" } }),
    /exact denominator contract/u,
  );
});
