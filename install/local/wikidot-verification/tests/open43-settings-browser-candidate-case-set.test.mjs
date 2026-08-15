import assert from "node:assert/strict";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import {
  OPEN43_SETTINGS_BROWSER_CASE_IDS,
  verifyOpen43SettingsBrowserCleanup,
  verifyOpen43SettingsBrowserCase,
} from "../src/open43-settings-browser-candidate-contract.mjs";

const hash = (character) => character.repeat(64);

function temporal(phase, sequence) {
  return {
    phase,
    sequence,
    artifact: {
      path: `settings-${sequence}.png`,
      sha256: hash(String(sequence)),
    },
    counterpart_artifact_path: `settings-${sequence === 1 ? 2 : 1}.png`,
    counterpart_artifact_sha256: hash(String(sequence)),
    navigation_status: 200,
    input_url: "https://scpaiueouiuiuiui.wikijump.localhost:18443/home",
    final_url: "https://scpaiueouiuiuiui.wikijump.localhost:18443/home",
  };
}

test("settings browser contract fixes the exact denominator and initial observation order", () => {
  assert.deepEqual(OPEN43_SETTINGS_BROWSER_CASE_IDS, [
    "S754_ANALYTICS_INITIAL",
    "S754_ANALYTICS_SETTLED",
    "S755_THEME_INITIAL",
    "S755_THEME_SETTLED",
    "S757_TOOLBAR_INITIAL",
    "S757_TOOLBAR_SETTLED",
    "S1046_ADMIN_INITIAL",
    "S1046_ADMIN_SETTLED",
    "S1046_PUBLIC_PERMISSION_CSRF_REVISION_MATRIX",
  ]);
  assert.equal(OPEN43_SETTINGS_BROWSER_CASE_IDS.length, 9);
  assert.equal(new Set(OPEN43_SETTINGS_BROWSER_CASE_IDS).size, 9);

  const plan = { analytics_profile: "UA-754-1" };
  const enabled = {
    enabled: true,
    meta_present: true,
    script_count: 1,
    profile: "UA-754-1",
    queue: [["_setAccount", "UA-754-1"], ["_trackPageview"]],
    remote_request_count: 0,
    initial_navigation_csp_header_sha256: hash("c"),
    csp_nonce_sha256: hash("a"),
    csp_nonce_matches_initial_navigation_header: true,
  };
  const observations = {
    disabled_temporal: { ...temporal("domcontentloaded_immediate_observation", 1), artifact: { path: "analytics-disabled.png", sha256: hash("1") } },
    enabled_temporal: temporal("domcontentloaded_immediate_observation", 1),
    disabled: { enabled: false, meta_present: false, script_count: 1, profile: null, queue: [], remote_request_count: 0, initial_navigation_csp_header_sha256: hash("d") },
    enabled,
  };
  const verification = verifyOpen43SettingsBrowserCase(
      "S754_ANALYTICS_INITIAL",
      observations,
      plan,
    );
  assert.equal(verification.verified, true);
  assert.notEqual(verification.queue_sha256, verification.csp_nonce_sha256);
  assert.throws(
    () =>
      verifyOpen43SettingsBrowserCase(
        "S754_ANALYTICS_INITIAL",
        {
          ...observations,
          enabled_temporal: temporal("settled", 2),
        },
        plan,
      ),
    /initial observation phase or order/u,
  );
  assert.throws(
    () =>
      verifyOpen43SettingsBrowserCase(
        "S754_ANALYTICS_INITIAL",
        {
          ...observations,
          enabled_temporal: {
            ...observations.enabled_temporal,
            counterpart_artifact_path: observations.enabled_temporal.artifact.path,
          },
        },
        plan,
      ),
    /reused one artifact/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S754_ANALYTICS_INITIAL", { ...observations, enabled: { ...enabled, initial_navigation_csp_header_sha256: null, csp_nonce_matches_initial_navigation_header: false } }, plan),
    /initial navigation CSP/u,
  );
});

test("the candidate command reaches only the authoritative nine-case settings denominator", async () => {
  const selected = await candidateCaseSet("open43-settings-browser");
  assert.deepEqual(selected.caseIds, OPEN43_SETTINGS_BROWSER_CASE_IDS);
  assert.equal(selected.caseIds.length, 9);
  assert.equal(new Set(selected.caseIds).size, 9);
});

test("analytics settled observation rejects duplicate order and stale queues", () => {
  const plan = {
    analytics_profile: "UA-754-1",
    default_page_url: "https://scpaiueouiuiuiui.wikijump.localhost:18443/boundary-check",
    revision_conflict_code: 4000,
    revision_conflict_message_sha256: hash("f"),
  };
  const observations = {
    temporal: {
      ...temporal("settled", 2),
      resource_completion: "complete",
    },
    analytics: {
      profile: "UA-754-1",
      queue: [["_setAccount", "UA-754-1"], ["_trackPageview"]],
      reload_queue: [["_setAccount", "UA-754-1"], ["_trackPageview"]],
      client_navigation_queue: [["_setAccount", "UA-754-1"], ["_trackPageview"]],
      client_navigation_preserved_document: true,
      client_resource_completion: "complete",
      remote_request_count: 0,
      initial_navigation_csp_header_sha256: hash("c"),
      csp_nonce_matches_initial_navigation_header: true,
      console_errors: [],
      reload_url: plan.default_page_url,
    },
    admin_lifecycle: { stale_status: 500, error_visible: true, error_code: 4000, error_message_sha256: hash("f"), success_status: 200, saved_profile: "UA-754-1" },
  };
  assert.equal(
    verifyOpen43SettingsBrowserCase(
      "S754_ANALYTICS_SETTLED",
      observations,
      plan,
    ).verified,
    true,
  );
  assert.throws(
    () =>
      verifyOpen43SettingsBrowserCase(
        "S754_ANALYTICS_SETTLED",
        {
          ...observations,
          temporal: {
            ...observations.temporal,
            sequence: 1,
          },
        },
        plan,
      ),
    /settled observation phase or order/u,
  );
  assert.throws(
    () =>
      verifyOpen43SettingsBrowserCase(
        "S754_ANALYTICS_SETTLED",
        {
          ...observations,
          analytics: {
            ...observations.analytics,
            client_navigation_queue: [["_setAccount", "UA-OLD-1"]],
          },
        },
        plan,
      ),
    /analytics settled state is stale or widened/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S754_ANALYTICS_SETTLED", { ...observations, admin_lifecycle: { ...observations.admin_lifecycle, error_visible: false } }, plan),
    /analytics settled state is stale or widened/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S754_ANALYTICS_SETTLED", { ...observations, admin_lifecycle: { ...observations.admin_lifecycle, error_code: 3106 } }, plan),
    /analytics settled state is stale or widened/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S754_ANALYTICS_SETTLED", { ...observations, analytics: { ...observations.analytics, reload_url: "https://scpaiueouiuiuiui.wikijump.localhost:18443/wrong" } }, plan),
    /reload URL/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S754_ANALYTICS_SETTLED", { ...observations, analytics: { ...observations.analytics, client_navigation_preserved_document: false } }, plan),
    /analytics settled state is stale or widened/u,
  );
});

test("theme observations reject stale category transitions and computed styles", () => {
  const plan = {
    theme_marker: "candidate-case-theme",
    transition_theme_marker: "candidate-case-corpus-theme",
    default_category_slug: "_default",
    transition_category_slug: "corpus",
    theme_body_font_family: "Arial, sans-serif",
    theme_body_background_color: "rgb(17, 34, 51)",
    theme_body_color: "rgb(238, 238, 238)",
    transition_body_background_color: "rgb(68, 85, 102)",
    default_page_url: "https://scpaiueouiuiuiui.wikijump.localhost:18443/boundary-check",
    transition_page_url: "https://scpaiueouiuiuiui.wikijump.localhost:18443/corpus%3Ascp-9506-draft",
  };
  const initial = {
    default_temporal: {
      ...temporal("domcontentloaded_immediate_observation", 1),
      input_url: plan.default_page_url,
      final_url: plan.default_page_url,
    },
    transition_temporal: {
      ...temporal("domcontentloaded_immediate_observation", 1),
      input_url: plan.transition_page_url,
      final_url: plan.transition_page_url,
      artifact: { path: "theme-transition-initial.png", sha256: hash("8") },
    },
    category_transition_temporal: {
      ...temporal("client_navigation_immediate_observation", 1),
      input_url: plan.transition_page_url,
      final_url: plan.transition_page_url,
      artifact: { path: "theme-category-client-initial.png", sha256: hash("a") },
    },
    default_theme: {
      expected_marker: "candidate-case-theme",
      computed_marker: "candidate-case-theme",
      stylesheet_order: ["base", "site"],
      stale_theme_present: false,
      body_font_family: "Arial, sans-serif",
      body_background_color: "rgb(17, 34, 51)",
      body_color: "rgb(238, 238, 238)",
      initial_navigation_csp_header_sha256: hash("e"),
      capture_failures: [],
    },
    transition_theme: {
      expected_marker: "candidate-case-corpus-theme",
      computed_marker: "candidate-case-corpus-theme",
      stylesheet_order: ["base", "site"],
      stale_previous_theme_present: false,
      navigation_source_marker: "candidate-case-theme",
      navigation_from_url: plan.default_page_url,
      body_font_family: "Arial, sans-serif",
      body_background_color: "rgb(68, 85, 102)",
      body_color: "rgb(238, 238, 238)",
      initial_navigation_csp_header_sha256: hash("f"),
      capture_failures: [],
    },
  };
  initial.category_transition_theme = {
    ...initial.transition_theme,
    capture_failures: [],
  };
  const settled = {
    default_temporal: { ...temporal("settled", 2), input_url: plan.default_page_url, final_url: plan.default_page_url, resource_completion: "complete" },
    transition_temporal: {
      ...temporal("settled", 2),
      input_url: plan.transition_page_url,
      final_url: plan.transition_page_url,
      resource_completion: "complete",
      artifact: { path: "theme-transition-settled.png", sha256: hash("9") },
    },
    category_transition_temporal: {
      ...temporal("client_navigation_settled", 2),
      input_url: plan.transition_page_url,
      final_url: plan.transition_page_url,
      resource_completion: "complete",
      artifact: { path: "theme-category-client-settled.png", sha256: hash("b") },
    },
    default_theme: {
      ...initial.default_theme,
      body_font_family: "Arial, sans-serif",
      body_background_color: "rgb(17, 34, 51)",
      body_color: "rgb(238, 238, 238)",
      reload_url: plan.default_page_url,
      initial_navigation_csp_header_sha256: hash("e"),
      capture_failures: [],
    },
    transition_theme: {
      ...initial.transition_theme,
      body_font_family: "Arial, sans-serif",
      body_background_color: "rgb(68, 85, 102)",
      body_color: "rgb(238, 238, 238)",
      reload_url: plan.transition_page_url,
      initial_navigation_csp_header_sha256: hash("f"),
      capture_failures: [],
    },
    category_transition_theme: {
      ...initial.category_transition_theme,
      reload_url: plan.transition_page_url,
      capture_failures: [],
    },
    setting_changes: {
      default: { before_sha256: hash("a"), after_sha256: hash("b") },
      transition: { before_sha256: hash("c"), after_sha256: hash("d") },
    },
  };
  assert.equal(
    verifyOpen43SettingsBrowserCase("S755_THEME_INITIAL", initial, plan).verified,
    true,
  );
  assert.equal(
    verifyOpen43SettingsBrowserCase("S755_THEME_SETTLED", settled, plan).verified,
    true,
  );
  assert.throws(
    () =>
      verifyOpen43SettingsBrowserCase(
        "S755_THEME_INITIAL",
        {
          ...initial,
          transition_theme: { ...initial.transition_theme, computed_marker: "previous-theme" },
        },
        plan,
      ),
    /theme observation is stale/u,
  );
  assert.throws(
    () =>
      verifyOpen43SettingsBrowserCase(
        "S755_THEME_SETTLED",
        {
          ...settled,
          transition_theme: { ...settled.transition_theme, stale_previous_theme_present: true },
        },
        plan,
      ),
    /theme observation is stale/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S755_THEME_INITIAL", { ...initial, category_transition_theme: { ...initial.category_transition_theme, navigation_source_marker: "previous-theme" } }, plan),
    /client transition theme/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S755_THEME_INITIAL", { ...initial, category_transition_temporal: { ...initial.category_transition_temporal, phase: "domcontentloaded_immediate_observation" } }, plan),
    /client transition initial has the wrong initial observation phase or order/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S755_THEME_INITIAL", { ...initial, transition_theme: { ...initial.transition_theme, body_background_color: "rgb(17, 34, 51)" } }, plan),
    /computed style/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S755_THEME_SETTLED", { ...settled, transition_theme: { ...settled.transition_theme, body_background_color: "rgb(0, 0, 0)" } }, plan),
    /computed style/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S755_THEME_SETTLED", { ...settled, transition_theme: { ...settled.transition_theme, reload_url: plan.default_page_url } }, plan),
    /reload URL/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S755_THEME_SETTLED", { ...settled, default_theme: { ...settled.default_theme, reload_url: plan.transition_page_url } }, plan),
    /reload URL/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S755_THEME_INITIAL", { ...initial, category_transition_theme: { ...initial.category_transition_theme, computed_marker: "previous-theme" } }, plan),
    /client transition theme/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S755_THEME_INITIAL", { ...initial, transition_theme: { ...initial.transition_theme, capture_failures: [{ kind: "http_error" }] } }, plan),
    /direct target theme capture/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S755_THEME_SETTLED", { ...settled, category_transition_theme: { ...settled.category_transition_theme, capture_failures: [{ kind: "request_failed" }] } }, plan),
    /client transition theme capture/u,
  );
});

test("toolbar observations bind all fixed viewports to the stored setting", () => {
  const plan = {
    toolbar_top: true,
    default_page_url: "https://scpaiueouiuiuiui.wikijump.localhost:18443/boundary-check",
    transition_page_url: "https://scpaiueouiuiuiui.wikijump.localhost:18443/corpus%3Ascp-9506-draft",
  };
  const captures = [
    [1280, 1],
    [767, 2],
    [479, 3],
  ].map(([width, digit]) => ({
    viewport: { width, height: 900 },
    temporal: {
      ...temporal("domcontentloaded_immediate_observation", 1),
      artifact: { path: `toolbar-${width}-initial.png`, sha256: hash(String(digit)) },
    },
    top_toolbar_count: 1,
    stale_previous_setting_present: false,
    reload_url: plan.default_page_url,
  }));
  const disabledCaptures = captures.map((capture, index) => ({ ...capture, top_toolbar_count: 0, temporal: { ...capture.temporal, artifact: { path: `toolbar-${capture.viewport.width}-disabled.png`, sha256: hash(String(index + 7)) } } }));
  const initial = { captures, disabled_captures: disabledCaptures };
  const settingTransition = {
    before_top_toolbar_count: 0,
    client_immediate_top_toolbar_count: 1,
    client_settled_top_toolbar_count: 1,
    client_immediate_stale_previous_setting_present: false,
    client_settled_stale_previous_setting_present: false,
    navigation_from_url: plan.transition_page_url,
    navigation_to_url: plan.default_page_url,
    client_navigation_preserved_document: true,
    client_resource_completion: "complete",
    initial_temporal: {
      ...temporal("client_navigation_immediate_observation", 1),
      input_url: plan.default_page_url,
      final_url: plan.default_page_url,
      artifact: { path: "toolbar-transition-initial.png", sha256: hash("a") },
    },
    settled_temporal: {
      ...temporal("client_navigation_settled", 2),
      input_url: plan.default_page_url,
      final_url: plan.default_page_url,
      resource_completion: "complete",
      artifact: { path: "toolbar-transition-settled.png", sha256: hash("b") },
    },
  };
  const settled = {
    disabled_captures: disabledCaptures.map((capture, index) => ({ ...capture, temporal: { ...capture.temporal, phase: "settled", sequence: 2, resource_completion: "complete", artifact: { path: `toolbar-${capture.viewport.width}-disabled-settled.png`, sha256: hash(String(index + 1)) } } })),
    captures: captures.map((capture, index) => ({
      ...capture,
      geometry: { width: capture.viewport.width > 767 ? capture.viewport.width : 0, height: capture.viewport.width > 767 ? 42 : 0 },
      hit_target: { width: capture.viewport.width > 767 ? 64 : 0, height: capture.viewport.width > 767 ? 32 : 0 },
      temporal: {
        ...capture.temporal,
        phase: "settled",
        sequence: 2,
        resource_completion: "complete",
        artifact: {
          path: `toolbar-${capture.viewport.width}-settled.png`,
          sha256: hash(String(index + 4)),
        },
      },
    })),
    setting_transition: settingTransition,
    interactions: {
      visible_after_scroll: true,
      focusable_link: true,
      client_navigation_preserved: true,
      client_navigation_preserved_document: true,
      client_resource_completion: "complete",
    },
    setting_change: { before_sha256: hash("a"), after_sha256: hash("b") },
  };
  assert.equal(
    verifyOpen43SettingsBrowserCase("S757_TOOLBAR_INITIAL", initial, plan).verified,
    true,
  );
  assert.equal(
    verifyOpen43SettingsBrowserCase("S757_TOOLBAR_SETTLED", settled, plan).verified,
    true,
  );
  assert.throws(
    () =>
      verifyOpen43SettingsBrowserCase(
        "S757_TOOLBAR_INITIAL",
        {
          disabled_captures: disabledCaptures,
          captures: captures.map((capture, index) =>
            index === 1 ? { ...capture, top_toolbar_count: 0 } : capture,
          ),
        },
        plan,
      ),
    /toolbar observation is stale/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S757_TOOLBAR_INITIAL", { ...initial, captures: captures.map((capture, index) => index === 0 ? { ...capture, stale_previous_setting_present: true } : capture) }, plan),
    /toolbar observation is stale/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S757_TOOLBAR_SETTLED", { ...settled, setting_transition: { ...settingTransition, client_immediate_top_toolbar_count: 0, client_immediate_stale_previous_setting_present: true } }, plan),
    /toolbar observation is stale/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S757_TOOLBAR_SETTLED", { ...settled, captures: settled.captures.map((capture, index) => index === 0 ? { ...capture, hit_target: null } : capture) }, plan),
    /geometry or hit target/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S757_TOOLBAR_SETTLED", { ...settled, setting_change: { before_sha256: hash("a"), after_sha256: hash("a") } }, plan),
    /setting change/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S757_TOOLBAR_SETTLED", { ...settled, captures: settled.captures.map((capture, index) => index === 0 ? { ...capture, reload_url: "https://scpaiueouiuiuiui.wikijump.localhost:18443/wrong" } : capture) }, plan),
    /reload URL/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S757_TOOLBAR_SETTLED", { ...settled, interactions: { ...settled.interactions, client_resource_completion: "bounded_domcontentloaded" } }, plan),
    /interactions are incomplete/u,
  );
});

test("legacy admin observations bind seven controls without claiming cancel", () => {
  const plan = {
    admin_initial_values_sha256: hash("c"),
    admin_settled_values_sha256: hash("d"),
    admin_url: "https://scpaiueouiuiuiui.wikijump.localhost:18443/_admin",
    general_description_sha256: hash("e"),
    admin_initial_revision: 10,
    admin_settled_revision: 13,
    revision_conflict_code: 4000,
    revision_conflict_message_sha256: hash("f"),
  };
  const controls = [
    "unixName",
    "name",
    "subtitle",
    "language",
    "description",
    "default_page",
    "welcome_page",
  ];
  const initial = {
    temporal: {
      ...temporal("domcontentloaded_immediate_observation", 1),
      input_url: "https://scpaiueouiuiuiui.wikijump.localhost:18443/_admin",
      final_url: "https://scpaiueouiuiuiui.wikijump.localhost:18443/_admin",
    },
    admin: {
      route: "/_admin",
      status: 200,
      controls,
      values_sha256: plan.admin_initial_values_sha256,
    },
    denied: [
      { actor: "anonymous", status: 401, settings_disclosed: false },
      { actor: "non_admin", status: 401, settings_disclosed: false },
    ],
  };
  const settled = {
    temporal: {
      ...initial.temporal,
      phase: "settled",
      sequence: 2,
      resource_completion: "complete",
      artifact: { path: "admin-settled.png", sha256: hash("d") },
    },
    lifecycle: {
      form_action: "?/site",
      success_status: 200,
      invalidation_status: 200,
      invalidation_resource_completion: "complete",
      fresh_revision_confirmation_status: 200,
      confirmation_invalidation_status: 200,
      confirmation_resource_completion: "complete",
      stale_submitted_revision: 10,
      stale_public_revision: 11,
      success_submitted_revision: 11,
      confirmation_submitted_revision: 12,
      success_public_revision: 13,
      stale_status: 500,
      stale_error_visible: true,
      stale_error_code: 4000,
      stale_error_message_sha256: hash("f"),
      stale_mutated: false,
      success_error_visible: false,
      edited_description_sha256: plan.general_description_sha256,
      success_public_values_sha256: plan.admin_settled_values_sha256,
      success_dom_values_sha256: plan.admin_settled_values_sha256,
      settled_values_sha256: plan.admin_settled_values_sha256,
      reload_values_sha256: plan.admin_settled_values_sha256,
      client_navigation_values_sha256: plan.admin_settled_values_sha256,
      client_navigation_preserved_document: true,
      client_resource_completion: "complete",
      reload_url: plan.admin_url,
      console_errors: [],
    },
  };
  assert.equal(
    verifyOpen43SettingsBrowserCase("S1046_ADMIN_INITIAL", initial, plan).verified,
    true,
  );
  assert.equal(
    verifyOpen43SettingsBrowserCase("S1046_ADMIN_SETTLED", settled, plan).verified,
    true,
  );
  assert.throws(
    () =>
      verifyOpen43SettingsBrowserCase(
        "S1046_ADMIN_SETTLED",
        {
          ...settled,
          lifecycle: { ...settled.lifecycle, cancel: "passed" },
        },
        plan,
      ),
    /unevidenced cancel/u,
  );
  assert.throws(
    () =>
      verifyOpen43SettingsBrowserCase(
        "S1046_ADMIN_SETTLED",
        {
          ...settled,
          lifecycle: {
            ...settled.lifecycle,
            reload_values_sha256: hash("e"),
          },
        },
        plan,
      ),
    /admin settled settings are stale/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S1046_ADMIN_SETTLED", { ...settled, lifecycle: { ...settled.lifecycle, form_action: null } }, plan),
    /general form lifecycle/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S1046_ADMIN_SETTLED", { ...settled, lifecycle: { ...settled.lifecycle, stale_error_message_sha256: hash("0") } }, plan),
    /general form lifecycle/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S1046_ADMIN_SETTLED", { ...settled, lifecycle: { ...settled.lifecycle, reload_url: "https://scpaiueouiuiuiui.wikijump.localhost:18443/boundary-check" } }, plan),
    /reload URL/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S1046_ADMIN_SETTLED", { ...settled, lifecycle: { ...settled.lifecycle, invalidation_status: 204 } }, plan),
    /general form lifecycle/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S1046_ADMIN_SETTLED", { ...settled, lifecycle: { ...settled.lifecycle, fresh_revision_confirmation_status: 500 } }, plan),
    /general form lifecycle/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S1046_ADMIN_SETTLED", { ...settled, lifecycle: { ...settled.lifecycle, success_submitted_revision: 10 } }, plan),
    /general form lifecycle/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S1046_ADMIN_SETTLED", { ...settled, lifecycle: { ...settled.lifecycle, success_public_values_sha256: plan.admin_initial_values_sha256 } }, plan),
    /admin settled settings are stale/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase("S1046_ADMIN_SETTLED", { ...settled, lifecycle: { ...settled.lifecycle, client_navigation_preserved_document: false } }, plan),
    /admin settled settings are stale/u,
  );
});

test("permission matrix rejects actor mutation, expired-session 500, and CSRF widening", () => {
  const plan = {
    matrix_before_sha256: hash("1"),
    matrix_admin_after_sha256: hash("2"),
    matrix_site_id: 17,
    matrix_before_revision: 30,
    matrix_admin_after_revision: 31,
    administrator_user_id: 41,
    non_admin_user_id: 42,
  };
  const actorSessions = { administrator_user_id: 41, non_admin_user_id: 42, expired_session: null };
  const outcomes = [
    ["anonymous", 401, false, hash("1")],
    ["non_admin", 403, false, hash("1")],
    ["cross_site", 403, false, hash("1")],
    ["stale_revision", 500, false, hash("1")],
    ["wrong_origin", 403, false, hash("1")],
    ["expired_session", 401, false, hash("1")],
    ["administrator", 200, true, hash("2")],
  ].map(([caseName, httpStatus, mutated, nextReadSha256]) => ({
    case: caseName,
    http_status: httpStatus,
    mutated,
    next_read_sha256: nextReadSha256,
    site_id: 17,
    settings_revision: caseName === "administrator" ? 31 : 30,
  }));
  assert.equal(
    verifyOpen43SettingsBrowserCase(
      "S1046_PUBLIC_PERMISSION_CSRF_REVISION_MATRIX",
      { actor_sessions: actorSessions, outcomes },
      plan,
    ).verified,
    true,
  );
  for (const [caseName, patch, pattern] of [
    ["non_admin", { http_status: 200, mutated: true }, /denied actor mutated/u],
    ["expired_session", { http_status: 500 }, /expired session returned 500/u],
    ["wrong_origin", { http_status: 200 }, /wrong-origin request widened/u],
  ]) {
    assert.throws(
      () =>
        verifyOpen43SettingsBrowserCase(
          "S1046_PUBLIC_PERMISSION_CSRF_REVISION_MATRIX",
          {
            actor_sessions: actorSessions,
            outcomes: outcomes.map((outcome) =>
              outcome.case === caseName ? { ...outcome, ...patch } : outcome,
            ),
          },
          plan,
        ),
      pattern,
    );
  }
  assert.throws(
    () => verifyOpen43SettingsBrowserCase(
      "S1046_PUBLIC_PERMISSION_CSRF_REVISION_MATRIX",
      { actor_sessions: actorSessions, outcomes: outcomes.map((outcome) => outcome.case === "non_admin" ? { ...outcome, settings_revision: 31 } : outcome) },
      plan,
    ),
    /permission outcome or next public read changed/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase(
      "S1046_PUBLIC_PERMISSION_CSRF_REVISION_MATRIX",
      { actor_sessions: { ...actorSessions, administrator_user_id: 99 }, outcomes },
      plan,
    ),
    /actor session identity/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCase(
      "S1046_PUBLIC_PERMISSION_CSRF_REVISION_MATRIX",
      { actor_sessions: { ...actorSessions, expired_session: { user_id: 43 }, expired_user_id: 43 }, outcomes },
      plan,
    ),
    /actor session identity/u,
  );
});

test("settings cleanup requires exact public restoration without page cleanup authority", () => {
  const settings = {
    site: {
      name: "Before",
      tagline: "Before tagline",
      google_analytics_enabled: false,
      google_analytics_profile: null,
      show_top_toolbar: true,
      show_bottom_toolbar: false,
    },
    category: {
      theme_kind: "built_in",
      theme_builtin_id: 1,
      theme_external_url: null,
      theme_custom_css: null,
    },
  };
  const proof = {
    before: settings,
    after: structuredClone(settings),
  };
  const resources = [{ kind: "settings", released: true }];
  assert.equal(
    verifyOpen43SettingsBrowserCleanup(proof, resources).public_restoration_verified,
    true,
  );
  assert.throws(
    () =>
      verifyOpen43SettingsBrowserCleanup(
        {
          ...proof,
          after: {
            ...proof.after,
            site: { ...proof.after.site, show_top_toolbar: false },
          },
        },
        resources,
      ),
    /settings were not restored/u,
  );
  assert.throws(
    () => verifyOpen43SettingsBrowserCleanup({ ...proof, pages: [] }, resources),
    /page cleanup proof/u,
  );
});
