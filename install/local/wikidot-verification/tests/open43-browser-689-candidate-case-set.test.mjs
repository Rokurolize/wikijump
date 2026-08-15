import assert from "node:assert/strict";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import {
  createOpen43B689TabviewCandidateCaseSet,
  OPEN43_B689_TABVIEW_FIXTURE,
  OPEN43_B689_TABVIEW_INITIAL_CASE_ID,
  OPEN43_B689_TABVIEW_LIVE_ORACLE,
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
  const oracle = OPEN43_B689_TABVIEW_LIVE_ORACLE.pages[slug];
  return {
    slug,
    input_url: new URL(`/${encodeURI(slug)}`, plan.page_origin).href,
    final_url: new URL(`/${encodeURI(slug)}`, plan.page_origin).href,
    navigation_status: 200,
    console_error_count: 0,
    request_failure_count: 0,
    http_error_count: 0,
    observation: {
      tabview_count: 1,
      tabviews: [{
        ...oracle.tabview,
        styles: oracle.tabview.styles,
        rectangle: oracle.tabview.rectangle,
        tab_count: 2,
        selected_count: 1,
        visible_panel_count: 1,
        panel_count: 2,
        nav_styles: oracle.nav_styles,
        content_styles: oracle.content_styles,
        first_panel_styles: oracle.panel_styles,
        first_panel_rectangle: oracle.tabview.first_panel_rectangle,
      }],
      resource_state: {
        document_ready_state: "interactive",
        stylesheet_count: 1,
        image_count: 0,
        incomplete_image_count: 0,
        rendered_image_count: oracle.resource_state.rendered_image_count,
        broken_image_count: oracle.resource_state.broken_image_count,
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
  assert.equal(prepared.plan.viewport.width, OPEN43_B689_TABVIEW_LIVE_ORACLE.viewport.width);
  assert.equal(prepared.plan.viewport.height, OPEN43_B689_TABVIEW_LIVE_ORACLE.viewport.height);
  assert.equal(OPEN43_B689_TABVIEW_LIVE_ORACLE.thresholds_px.position, 8);
  assert.equal(OPEN43_B689_TABVIEW_LIVE_ORACLE.thresholds_px.size, 12);
  assert.throws(
    () => caseSet.prepareRun({
      candidateIdentity,
      privateInput: { fixture: { ...OPEN43_B689_TABVIEW_FIXTURE, canary_slugs: ["theme:basalt"] } },
      candidateBrowserContexts: {},
    }),
    /sealed B689 canary fixture/u,
  );
});

test("B689 initial verification rejects geometry drift, duplicate rows, and tabview mismatch", () => {
  const plan = {
    page_origin: "https://candidate.wikijump.localhost:18443",
    fixture_identity_sha256: sha256Value(OPEN43_B689_TABVIEW_FIXTURE),
    live_oracle_identity_sha256: sha256Value(OPEN43_B689_TABVIEW_LIVE_ORACLE),
  };
  const observations = {
    fixture_identity_sha256: plan.fixture_identity_sha256,
    live_oracle_identity_sha256: plan.live_oracle_identity_sha256,
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
        ? { ...value, observation: { ...value.observation, tabviews: [{ ...value.observation.tabviews[0], rectangle: { ...value.observation.tabviews[0].rectangle, height: value.observation.tabviews[0].rectangle.height - 70.56 } }] } }
        : value),
    }, plan),
    /geometry drift.*height/u,
  );
  assert.throws(
    () => verifyOpen43B689TabviewInitial({
      ...observations,
      pages: [observations.pages[0], { ...observations.pages[0] }],
    }, plan),
    /duplicate page rows/u,
  );
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
