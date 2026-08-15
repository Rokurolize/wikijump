import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { candidateCaseSet, candidateCaseUsage } from "../src/candidate-case-command.mjs";
import { OPEN43_MEDIA_BROWSER_CASE_IDS } from "../src/open43-media-browser-candidate.mjs";

const root = new URL("../../../../", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");

test("media browser rows are one executable CandidateCaseSet denominator", async () => {
  const audit = JSON.parse(read("docs/development/open43-m-closure-audit.json"));
  const expected = audit.issues
    .filter(({ issue }) => [756, 776, 806, 1039, 1042, 1043, 1062].includes(issue))
    .flatMap(({ subrows }) => subrows)
    .filter(({ classification, next_command_ids }) => classification === "candidate_required" && next_command_ids.includes("C_MEDIA_BROWSER_CANDIDATE"))
    .map(({ case_id }) => case_id);
  const caseSet = await candidateCaseSet("open43-media-browser");

  assert.deepEqual(caseSet.caseIds, expected);
  assert.deepEqual(OPEN43_MEDIA_BROWSER_CASE_IDS, expected);
  assert.equal(typeof caseSet.prepareRun, "function");
  assert.match(candidateCaseUsage(), /open43-media-browser/u);
});

test("the Playwright file is collection-only and the case set owns candidate receipts", () => {
  const spec = read("framerail/tests/open43-media-files-candidate.spec.ts");
  const adapter = read("install/local/wikidot-verification/src/open43-media-browser-candidate.mjs");
  const runner = read("install/local/wikidot-verification/src/candidate-case-runner.mjs");

  assert.match(spec, /candidate-case-command/u);
  assert.match(spec, /test\.skip/u);
  assert.doesNotMatch(spec, /writeFile|captureCandidateObservation|status:\s*["']pass["']|verdict\s*:/u);
  for (const text of ["domcontentloaded_immediate_observation", "settled", "csp_violations", "required_request_url_sha256", "forbidden_request_url_sha256", "negative_boundary_verified"]) assert.match(adapter, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(adapter, /runCandidateCaseSet|candidate-case-runner/u);
  assert.match(adapter, /verified: true/u);
  assert.match(runner, /sealJsonNoReplace/u);
});
