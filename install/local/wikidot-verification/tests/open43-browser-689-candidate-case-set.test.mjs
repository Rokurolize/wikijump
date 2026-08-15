import assert from "node:assert/strict";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import {
  createOpen43B689TabviewCandidateCaseSet,
  OPEN43_B689_TABVIEW_FIXTURE,
  OPEN43_B689_TABVIEW_INITIAL_CASE_ID,
  verifyOpen43B689TabviewInitial,
} from "../src/open43-browser-689-candidate-case-set.mjs";
import { sha256File, sha256Value } from "../src/standing-browser-parity-util.mjs";

const candidateIdentity = {
  candidate: {
    endpoint: {
      scheme: "https",
      host: "candidate.wikijump.localhost",
      port: 18443,
    },
  },
};

function page(slug, plan) {
  return {
    slug,
    final_url: new URL(`/${encodeURI(slug)}`, plan.page_origin).href,
    navigation_status: 200,
    console_error_count: 0,
    request_failure_count: 0,
    http_error_count: 0,
    observation: {
      tabview_count: 1,
      tabviews: [{
        styles: { visibility: "visible" },
        rectangle: { x: 0, y: 0, width: 100, height: 100 },
        tab_count: 2,
        selected_count: 1,
        visible_panel_count: 1,
        panel_count: 2,
        nav_styles: {},
        content_styles: {},
        first_panel_styles: {},
        first_panel_rectangle: { x: 0, y: 20, width: 100, height: 40 },
      }],
      resource_state: {
        document_ready_state: "interactive",
        stylesheet_count: 1,
        image_count: 0,
        incomplete_image_count: 0,
        font_status: "loaded",
        resource_entry_count: 1,
      },
    },
  };
}

test("B689 is an executable candidate case bound to the existing canary fixture", async () => {
  const caseSet = createOpen43B689TabviewCandidateCaseSet();
  assert.equal(caseSet.id, "open43-689-tabview");
  assert.deepEqual(caseSet.caseIds, [OPEN43_B689_TABVIEW_INITIAL_CASE_ID]);
  assert.equal((await candidateCaseSet("open43-689-tabview")).id, caseSet.id);
  assert.equal(
    await sha256File(OPEN43_B689_TABVIEW_FIXTURE.source_path),
    OPEN43_B689_TABVIEW_FIXTURE.source_sha256,
  );

  const prepared = caseSet.prepareRun({
    candidateIdentity,
    privateInput: { fixture: OPEN43_B689_TABVIEW_FIXTURE },
    candidateBrowserContexts: {},
  });
  assert.equal(prepared.plan.fixture_identity_sha256, sha256Value(OPEN43_B689_TABVIEW_FIXTURE));
  assert.deepEqual(prepared.plan.fixture.canary_slugs, ["theme:basalt", "scp-8980"]);
  assert.equal(prepared.sourceFiles.includes(OPEN43_B689_TABVIEW_FIXTURE.source_path), true);
  assert.equal(prepared.sourceFiles.includes("framerail/src/lib/wikidot/wikidot-tabviews.ts"), true);
  assert.equal(prepared.sourceFiles.includes("install/local/wikidot-verification/src/candidate-case-runner.mjs"), true);
});

test("B689 initial verification fails on a tabview mismatch", () => {
  const plan = {
    page_origin: "https://candidate.wikijump.localhost:18443",
    fixture_identity_sha256: sha256Value(OPEN43_B689_TABVIEW_FIXTURE),
  };
  const observations = {
    fixture_identity_sha256: plan.fixture_identity_sha256,
    phase: "domcontentloaded_immediate_observation",
    sequence: 1,
    browser_environment: { executable_sha256: "a".repeat(64) },
    pages: [page("theme:basalt", plan), page("scp-8980", plan)],
  };
  assert.equal(verifyOpen43B689TabviewInitial(observations, plan).verified, true);
  assert.throws(
    () => verifyOpen43B689TabviewInitial({
      ...observations,
      pages: observations.pages.map((value, index) => index === 0
        ? { ...value, observation: { ...value.observation, tabviews: [{ ...value.observation.tabviews[0], selected_count: 0 }] } }
        : value),
    }, plan),
    /tabview structure mismatched/u,
  );
});
