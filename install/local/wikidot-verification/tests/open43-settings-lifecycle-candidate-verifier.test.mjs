import assert from "node:assert/strict";
import test from "node:test";

import {
  OPEN43_SETTINGS_LIFECYCLE_CASE_MANIFEST,
  verifyOpen43SettingsLifecycleCase,
  verifyOpen43SettingsLifecycleCleanup,
} from "../src/open43-settings-lifecycle-candidate-contract.mjs";

const hash = (character) => character.repeat(64);

function capture(url, suffix, title, content) {
  return {
    navigation_status: 200,
    editor_navigation_status: 404,
    input_url: url,
    final_url: url,
    failures: [],
    request_gate_aborts: [],
    first_paint: {
      phase: "domcontentloaded_immediate_observation",
      screenshot: { path: `/evidence/${suffix}-initial.png`, sha256: hash("a") },
      title: "",
      content: "",
    },
    settled: { phase: "settled", resource_completion: "complete", content },
  };
}

function action(character) {
  return { http_status: 200, action_type: "success", response_body_sha256: hash(character) };
}

function allocator(enabled, next, character) {
  return { enabled, next, sha256: hash(character) };
}

test("S758 verifier binds sequential creates, disable behavior, temporal evidence, and cleanup", () => {
  assert.equal(Object.isFrozen(OPEN43_SETTINGS_LIFECYCLE_CASE_MANIFEST), true);
  const origin = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
  const firstUrl = `${origin}/issue:1`;
  const secondUrl = `${origin}/issue:2`;
  const plan = {
    category_id: 73,
    category_slug: "issue",
    page_origin: origin,
    first_title: "First title",
    second_title: "Second title",
    disabled_title: "Disabled title",
    first_body: "First body",
    second_body: "Second body",
    disabled_body: "Disabled body",
    disabled_requested_slug: "issue:disabled",
  };
  const first = {
    assigned_slug: "issue:1",
    redirect_url: firstUrl,
    title: plan.first_title,
    category_slug: "issue",
    action: action("b"),
    capture: capture(firstUrl, "first", plan.first_title, plan.first_body),
    page: { page_id: 101, revision_id: 201, slug: "issue:1", title: plan.first_title },
  };
  const second = {
    assigned_slug: "issue:2",
    redirect_url: secondUrl,
    title: plan.second_title,
    category_slug: "issue",
    action: action("c"),
    capture: capture(secondUrl, "second", plan.second_title, plan.second_body),
    page: { page_id: 102, revision_id: 202, slug: "issue:2", title: plan.second_title },
  };
  const disabled = {
    assigned_slug: plan.disabled_requested_slug,
    redirect_url: `${origin}/issue:disabled`,
    title: plan.disabled_title,
    category_slug: "issue",
    action: action("d"),
    capture: capture(`${origin}/issue:disabled`, "disabled", plan.disabled_title, plan.disabled_body),
    page: { page_id: 103, revision_id: 203, slug: plan.disabled_requested_slug, title: plan.disabled_title },
  };
  const observations = {
    first_create: first,
    allocator_before: allocator(true, 1, "d"),
    allocator_after: allocator(true, 2, "e"),
    allocator_after_first: allocator(true, 2, "e"),
    allocator_after_second: allocator(true, 3, "f"),
    allocator_after_disabled: allocator(false, 3, "0"),
    history: { url: `${firstUrl}#_history`, status: 200, row_count: 1 },
    reload: { url: firstUrl, status: 200 },
    next_create: second,
    disable: { action: action("f"), enabled: false, requested_slug: plan.disabled_requested_slug, create: disabled },
    cache_identity: Object.fromEntries(["first", "reload", "second"].map((name) => [name, { article_page_cache_key: null, public_content_cache_fence: null, anonymous_permission_cache_fence: null }])),
  };

  assert.equal(verifyOpen43SettingsLifecycleCase("S758_CREATE_INITIAL", observations, plan).verified, true);
  assert.equal(verifyOpen43SettingsLifecycleCase("S758_CREATE_SETTLED", observations, plan).verified, true);
  assert.throws(
    () => verifyOpen43SettingsLifecycleCase("S758_CREATE_SETTLED", { ...observations, allocator_after_second: allocator(true, 2, "f") }, plan),
    /second allocator advance/u,
  );
  assert.throws(
    () => verifyOpen43SettingsLifecycleCase("S758_CREATE_INITIAL", { ...observations, first_create: { ...first, capture: { ...first.capture, failures: [{ url: "https://failed.example/asset" }] } } }, plan),
    /successful navigation/u,
  );
  assert.equal(verifyOpen43SettingsLifecycleCleanup({ public_absence_verified: true, run_owned_state_absent: true, disposable_candidate_discarded: true, run_owned_page_ids: [] }, [{ released: true }]).verified, true);
});
