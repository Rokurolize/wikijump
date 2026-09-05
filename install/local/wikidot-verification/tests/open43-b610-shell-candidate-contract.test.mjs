import assert from "node:assert/strict";
import test from "node:test";

import { verifyOpen43B610ShellCase } from "../src/open43-b610-shell-candidate-contract.mjs";
import { DEFAULT_SETTLE_MS } from "../src/standing-browser-canaries.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const hash = (character) => character.repeat(64);
const PAGE_URL = "https://scp-wiki.wikijump.localhost:18443/scp-9506";

const plan = {
  fixture_id: "B610_CURRENT_LIVE_CHROME",
  fixture_sha256: hash("a"),
  page_url: PAGE_URL,
  browser: { settle_ms: DEFAULT_SETTLE_MS },
  expected: {
    header_direct_child_ids: ["search-top-box", "top-bar", "login-status", "header-extra-div-1", "header-extra-div-2", "header-extra-div-3"],
    header_extension_ids: ["header-extra-div-1", "header-extra-div-2", "header-extra-div-3"],
    container_extension_ids: ["extrac-div-1", "extrac-div-2", "extrac-div-3"],
    sidebar_close_href_double_hash_count: 1,
    favicon_route_prefix: "/local--favicon/",
    favicon_route_status: 302,
  },
};

function artifact(name, character) {
  return { path: `/tmp/${name}.png`, sha256: hash(character) };
}

function observations() {
  const environment = { engine: "chromium", version: "test", executable_sha256: hash("b") };
  return {
    fixture_id: plan.fixture_id,
    fixture_sha256: plan.fixture_sha256,
    page_url: PAGE_URL,
    browser_environment: environment,
    browser_environment_sha256: sha256Value(environment),
    capture: {
      schema: "wikijump_local_lab.standing_browser_parity_capture.v2",
      input_url: PAGE_URL,
      final_url: PAGE_URL,
      navigation_status: 200,
      failures: [],
      request_gate_aborts: [],
      first_paint: {
        document: { phase: "domcontentloaded_immediate_observation" },
        screenshot: artifact("initial", "c"),
      },
      document: {
        phase: "settled",
        resource_completion: { status: "complete" },
      },
      settled_interval: {
        policy: "standing-browser-canary",
        settle_ms: DEFAULT_SETTLE_MS,
        resource_completion_status: "complete",
        initial_phase: "domcontentloaded_immediate_observation",
        settled_phase: "settled",
      },
      settled_viewport_screenshot: artifact("settled-viewport", "d"),
      screenshot: artifact("settled-full-page", "e"),
    },
    shell: {
      header_direct_child_ids: plan.expected.header_direct_child_ids,
      header_extension_ids: plan.expected.header_extension_ids,
      container_extension_ids: plan.expected.container_extension_ids,
      sidebar_close_href_count: 1,
      sidebar_close_hrefs: ["##"],
      search_top_box_count: 1,
      search_form_count: 1,
      search_form_class: "input-append",
      search_query_input_count: 1,
      search_query_input_class: "text empty search-query",
      search_submit_count: 1,
      search_submit_class: "button btn",
      favicon: {
        declaration_count: 1,
        declared_href: "/local--favicon/site.svg",
        href_path: "/local--favicon/site.svg",
        href_search: "",
        href_hash: "",
        route_request_path: "/local--favicon/site.svg",
        route_status: 302,
        route_location: "https://scp-wiki.wikidot.com/local--favicon/site.svg",
      },
    },
  };
}

function verify(value) {
  return verifyOpen43B610ShellCase("B610_SHELL_PUBLIC_CONTRACT", value, plan);
}

test("B610 rejects a zero or unproved settled interval", () => {
  assert.equal(verify(observations()).verified, true);

  const zero = observations();
  zero.capture.settled_interval.settle_ms = 0;
  assert.throws(() => verify(zero), /settled interval is missing or unproved/);

  const missing = observations();
  delete missing.capture.settled_interval;
  assert.throws(() => verify(missing), /settled interval/);
});

test("B610 rejects failed resources and HTTP responses", () => {
  const knownOrb = observations();
  knownOrb.capture.failures = [
    { kind: "request_failed", url: "https://scp-wiki.wdfiles.com/local--files/scp-9506/AFTER_FOG.png", resource_type: "image", error: "net::ERR_BLOCKED_BY_ORB" },
    { kind: "request_failed", url: "https://scp-wiki.wdfiles.com/local--files/scp-9506/earth.jpg", resource_type: "image", error: "net::ERR_BLOCKED_BY_ORB" },
    { kind: "request_failed", url: "https://scp-wiki.wdfiles.com/local--files/scp-9506/REC_ALERT.png", resource_type: "image", error: "net::ERR_BLOCKED_BY_ORB" },
  ];
  assert.equal(verify(knownOrb).verified, true);

  for (const failure of [
    { kind: "request_failed", url: PAGE_URL, resource_type: "image", error: "net::ERR_FAILED" },
    { kind: "request_failed", url: "https://scp-wiki.wdfiles.com/local--files/scp-9507/unsealed.png", resource_type: "image", error: "net::ERR_BLOCKED_BY_ORB" },
    { kind: "http_error", url: PAGE_URL, resource_type: "stylesheet", status: 503 },
  ]) {
    const failed = observations();
    failed.capture.failures = [failure];
    assert.throws(() => verify(failed), /browser capture has public failures/);
  }
});

test("B610 successful-navigation failure names the exact capture fields", () => {
  const drifted = observations();
  drifted.capture.navigation_status = 503;
  drifted.capture.final_url = `${PAGE_URL}/`;
  assert.throws(
    () => verify(drifted),
    (error) => {
      assert.match(error.message, /did not bind one successful navigation/u);
      assert.match(error.message, /status=503/u);
      assert.ok(error.message.includes(`final=${JSON.stringify(`${PAGE_URL}/`)}`));
      assert.ok(error.message.includes(`expected=${JSON.stringify(PAGE_URL)}`));
      assert.match(error.message, /capture_error=null/u);
      assert.match(error.message, /failures=0 gate_aborts=0/u);
      return true;
    },
  );

  const errored = observations();
  errored.capture.capture_error = { name: "TimeoutError", message: "settled wait exceeded" };
  assert.throws(
    () => verify(errored),
    (error) => {
      assert.match(error.message, /did not bind one successful navigation/u);
      assert.match(error.message, /capture_error=\{"name":"TimeoutError","message":"settled wait exceeded"\}/u);
      return true;
    },
  );
});
