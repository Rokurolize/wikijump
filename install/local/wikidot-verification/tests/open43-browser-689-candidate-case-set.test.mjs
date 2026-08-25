import assert from "node:assert/strict";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import {
  OPEN43_B689_CASE_IDS,
  OPEN43_B689_SCP8980_NAVIGATION_CASE_ID,
  OPEN43_B689_TABVIEW_SETTLED_CASE_ID,
  b689NavigationRequestIsLocal,
  createOpen43B689TabviewCandidateCaseSet,
  OPEN43_B689_TABVIEW_FIXTURE,
  OPEN43_B689_TABVIEW_INITIAL_CASE_ID,
  OPEN43_B689_TABVIEW_LIVE_ORACLE,
  verifyOpen43B689Scp8980Navigation,
  verifyOpen43B689TabviewInitial,
  verifyOpen43B689TabviewSettled,
} from "../src/open43-browser-689-candidate-case-set.mjs";
import { sha256File, sha256Value } from "../src/standing-browser-parity-util.mjs";

const repositoryRoot = new URL("../../../../", import.meta.url);
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
  const styles = oracle.tabview.styles ?? { visibility: "visible" };
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
        styles,
        rectangle: oracle.tabview.rectangle,
        tab_count: 2,
        selected_count: 1,
        visible_panel_count: 1,
        panel_count: 2,
        nav_styles: oracle.nav_styles ?? styles,
        content_styles: oracle.content_styles ?? styles,
        first_panel_styles: oracle.panel_styles ?? styles,
        first_panel_rectangle: oracle.tabview.first_panel_rectangle ?? oracle.tabview.rectangle,
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
  assert.deepEqual(caseSet.caseIds, OPEN43_B689_CASE_IDS);
  assert.deepEqual(OPEN43_B689_CASE_IDS, [
    OPEN43_B689_TABVIEW_INITIAL_CASE_ID,
    OPEN43_B689_TABVIEW_SETTLED_CASE_ID,
    OPEN43_B689_SCP8980_NAVIGATION_CASE_ID,
  ]);
  assert.equal((await candidateCaseSet("open43-689-tabview")).id, caseSet.id);
  assert.equal(
    await sha256File(new URL(OPEN43_B689_TABVIEW_FIXTURE.source_path, repositoryRoot)),
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
  assert.equal(OPEN43_B689_TABVIEW_LIVE_ORACLE.pages["theme:basalt"].tabview.styles, undefined);
  assert.equal(OPEN43_B689_TABVIEW_LIVE_ORACLE.pages["theme:basalt"].tabview.first_panel_rectangle, undefined);
  assert.equal(OPEN43_B689_TABVIEW_LIVE_ORACLE.pages["scp-8980"].tabview.styles.display, "grid");
  assert.throws(
    () => caseSet.prepareRun({
      candidateIdentity,
      privateInput: { fixture: { ...OPEN43_B689_TABVIEW_FIXTURE, canary_slugs: ["theme:basalt"] } },
      candidateBrowserContexts: {},
    }),
    /sealed B689 canary fixture/u,
  );
});

test("B689 navigation lifecycle only permits candidate-owned local requests", () => {
  const origin = "https://candidate.wikijump.localhost:18443";
  assert.equal(b689NavigationRequestIsLocal(`${origin}/scp-8980`, origin), true);
  assert.equal(b689NavigationRequestIsLocal("https://candidate.wjfiles.localhost:18443/local--files/a.png", origin), true);
  assert.equal(b689NavigationRequestIsLocal("https://scp-wiki.wikidot.com/scp-8980", origin), false);
  assert.equal(b689NavigationRequestIsLocal("https://scp-wiki.wdfiles.com/local--files/a.png", origin), false);
  assert.equal(b689NavigationRequestIsLocal("https://candidate.wikijump.localhost:443/scp-8980", origin), false);
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

function settledPlan() {
  return {
    page_origin: "https://candidate.wikijump.localhost:18443",
    fixture_identity_sha256: sha256Value(OPEN43_B689_TABVIEW_FIXTURE),
    live_oracle_identity_sha256: sha256Value(OPEN43_B689_TABVIEW_LIVE_ORACLE),
  };
}

function interactionState(selectedIndex) {
  return {
    tabview_count: 1,
    tab_count: 2,
    selected_index: selectedIndex,
    selected_title: "active",
    visible_panel_index: selectedIndex,
  };
}

function settledTabview(slug) {
  const oracle = OPEN43_B689_TABVIEW_LIVE_ORACLE.pages[slug];
  const styles = oracle.tabview.styles ?? { visibility: "visible" };
  return {
    ...oracle.tabview,
    class_name: oracle.settled.class_name ?? oracle.tabview.class_name,
    selected_title: oracle.settled.selected_title ?? oracle.tabview.selected_title,
    styles,
    rectangle: slug === "theme:basalt"
      ? oracle.settled.tabview_rectangle
      : { x: 203, y: oracle.settled.tabview_y, width: 960, height: oracle.settled.tabview_height },
    tab_count: 2,
    selected_count: 1,
    visible_panel_count: 1,
    panel_count: 2,
    nav_styles: oracle.nav_styles ?? styles,
    content_styles: oracle.content_styles ?? styles,
    first_panel_styles: oracle.panel_styles ?? styles,
    first_panel_id: slug === "scp-8980" ? oracle.settled.first_panel_id : "wiki-tab-0-0",
    first_panel_rectangle: oracle.tabview.first_panel_rectangle ?? oracle.settled.tabview_rectangle,
  };
}

function settledPage(slug, plan) {
  const row = {
    slug,
    input_url: new URL(`/${encodeURI(slug)}`, plan.page_origin).href,
    final_url: new URL(`/${encodeURI(slug)}`, plan.page_origin).href,
    navigation_status: 200,
    console_error_count: 0,
    request_failure_count: 0,
    http_error_count: 0,
    resource_completion: {
      status: "complete",
      load_ready_state: "complete",
      font_status: "loaded",
      incomplete_image_count: 0,
    },
    artifacts: {
      settled_viewport: { path: `/evidence/${slug}-settled-viewport.png`, sha256: "b".repeat(64) },
      full_page: { path: `/evidence/${slug}-settled-full.png`, sha256: "c".repeat(64) },
    },
    observation: {
      tabview_count: 1,
      tabviews: [settledTabview(slug)],
    },
  };
  if (slug === "scp-8980") {
    row.interactions = {
      initial: interactionState(0),
      after_click: { ...interactionState(1), focused_clicked_anchor: true },
      after_enter: interactionState(0),
      after_arrow_right: interactionState(0),
      after_space: interactionState(0),
    };
  }
  return row;
}

test("B689 settled verification binds the frozen settled geometry and interaction contract", () => {
  const plan = settledPlan();
  const observations = {
    fixture_identity_sha256: plan.fixture_identity_sha256,
    live_oracle_identity_sha256: plan.live_oracle_identity_sha256,
    phase: "settled",
    sequence: 2,
    browser_environment: { executable_sha256: "a".repeat(64) },
    pages: [settledPage("theme:basalt", plan), settledPage("scp-8980", plan)],
  };
  const verdict = verifyOpen43B689TabviewSettled(observations, plan);
  assert.equal(verdict.verified, true);
  assert.equal(verdict.settled_pages, 2);

  const basaltDrift = structuredClone(observations);
  basaltDrift.pages[0].observation.tabviews[0].rectangle.height = OPEN43_B689_TABVIEW_LIVE_ORACLE.pages["theme:basalt"].settled.tabview_rectangle.height - 70.56;
  assert.throws(() => verifyOpen43B689TabviewSettled(basaltDrift, plan), /settled tabview #0.*height/u);

  const scp8980Drift = structuredClone(observations);
  scp8980Drift.pages[1].observation.tabviews[0].rectangle.y = OPEN43_B689_TABVIEW_LIVE_ORACLE.pages["scp-8980"].settled.tabview_y - 20;
  assert.throws(() => verifyOpen43B689TabviewSettled(scp8980Drift, plan), /settled tabview y drift/u);

  const incomplete = structuredClone(observations);
  incomplete.pages[0].resource_completion.status = "loading";
  assert.throws(() => verifyOpen43B689TabviewSettled(incomplete, plan), /did not settle/u);

  const wrongPanel = structuredClone(observations);
  wrongPanel.pages[1].observation.tabviews[0].first_panel_id = "wiki-tab-0-1";
  assert.throws(() => verifyOpen43B689TabviewSettled(wrongPanel, plan), /first panel id mismatched/u);

  const focusLost = structuredClone(observations);
  focusLost.pages[1].interactions.after_click.focused_clicked_anchor = false;
  assert.throws(() => verifyOpen43B689TabviewSettled(focusLost, plan), /preserve focus/u);

  const inertViolated = structuredClone(observations);
  inertViolated.pages[1].interactions.after_arrow_right = interactionState(1);
  assert.throws(() => verifyOpen43B689TabviewSettled(inertViolated, plan), /ArrowRight/u);

  const reusedArtifact = structuredClone(observations);
  reusedArtifact.pages[0].artifacts.full_page.path = reusedArtifact.pages[0].artifacts.settled_viewport.path;
  assert.throws(() => verifyOpen43B689TabviewSettled(reusedArtifact, plan), /reused one screenshot artifact/u);
});

test("B689 SCP-8980 navigation verification binds the return-to-first-tab lifecycle", () => {
  const plan = settledPlan();
  const scp8980Url = new URL("/scp-8980", plan.page_origin).href;
  const basaltUrl = new URL("/theme%3Abasalt", plan.page_origin).href;
  const oracle = OPEN43_B689_TABVIEW_LIVE_ORACLE.pages["scp-8980"];
  const observations = {
    fixture_identity_sha256: plan.fixture_identity_sha256,
    live_oracle_identity_sha256: plan.live_oracle_identity_sha256,
    phase: "navigation_lifecycle",
    sequence: 3,
    browser_environment: { executable_sha256: "a".repeat(64) },
    page: {
      slug: "scp-8980",
      input_url: scp8980Url,
      final_url: scp8980Url,
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
          first_panel_id: oracle.settled.first_panel_id,
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
    },
    navigation: {
      selected_after_click: interactionState(1),
      away_navigation_status: 200,
      away_url: basaltUrl,
      back_url: scp8980Url,
      after_back: interactionState(0),
      forward_url: basaltUrl,
      after_second_back: interactionState(0),
    },
  };
  const verdict = verifyOpen43B689Scp8980Navigation(observations, plan);
  assert.equal(verdict.verified, true);
  assert.equal(verdict.return_to_first_tab_proven, true);

  const liveBrowserNoise = structuredClone(observations);
  liveBrowserNoise.page.console_error_count = 2;
  liveBrowserNoise.page.request_failure_count = 1;
  assert.equal(verifyOpen43B689Scp8980Navigation(liveBrowserNoise, plan).verified, true);

  const staleSelection = structuredClone(observations);
  staleSelection.navigation.after_back = interactionState(1);
  assert.throws(() => verifyOpen43B689Scp8980Navigation(staleSelection, plan), /after back navigation tab state/u);

  const wrongBack = structuredClone(observations);
  wrongBack.navigation.back_url = basaltUrl;
  assert.throws(() => verifyOpen43B689Scp8980Navigation(wrongBack, plan), /did not return to SCP-8980/u);

  const httpError = structuredClone(observations);
  httpError.page.http_error_count = 1;
  assert.throws(() => verifyOpen43B689Scp8980Navigation(httpError, plan), /mismatched: scp-8980/u);
});
