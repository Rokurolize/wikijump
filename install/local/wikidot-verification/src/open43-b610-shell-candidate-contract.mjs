import {
  requirePlainObject,
  requireSha256,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_B610_SHELL_CASE_IDS = Object.freeze([
  "B610_SHELL_PUBLIC_CONTRACT",
]);

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireArtifact(value, label) {
  const artifact = requirePlainObject(value, label);
  if (typeof artifact.path !== "string" || artifact.path.length === 0) {
    throw new Error(`${label}.path is missing`);
  }
  requireSha256(artifact.sha256, `${label}.sha256`);
  return artifact;
}

function verifyCapture(capture, plan) {
  const value = requirePlainObject(capture, "B610 browser capture");
  if (
    value.schema !== "wikijump_local_lab.standing_browser_parity_capture.v2" ||
    value.input_url !== plan.page_url ||
    value.final_url !== plan.page_url ||
    value.navigation_status !== 200 ||
    Object.hasOwn(value, "capture_error")
  ) {
    throw new Error(
      `B610 browser capture did not bind one successful navigation:` +
        ` status=${JSON.stringify(value.navigation_status ?? null)}` +
        ` input=${JSON.stringify(value.input_url ?? null)}` +
        ` final=${JSON.stringify(value.final_url ?? null)}` +
        ` expected=${JSON.stringify(plan.page_url)}` +
        ` capture_error=${JSON.stringify(value.capture_error ?? null)}` +
        ` failures=${Array.isArray(value.failures) ? value.failures.length : null}` +
        ` gate_aborts=${Array.isArray(value.request_gate_aborts) ? value.request_gate_aborts.length : null}`,
    );
  }
  if (!Array.isArray(value.failures) || value.failures.length !== 0) {
    throw new Error("B610 browser capture has public failures");
  }
  if (!Array.isArray(value.request_gate_aborts) || value.request_gate_aborts.length !== 0) {
    throw new Error("B610 browser capture has request-gate aborts");
  }
  if (value.first_paint?.document?.phase !== "domcontentloaded_immediate_observation") {
    throw new Error("B610 initial capture phase is missing");
  }
  if (value.document?.phase !== "settled") {
    throw new Error("B610 settled capture phase is missing");
  }
  const settledInterval = requirePlainObject(value.settled_interval, "B610 settled interval");
  if (
    settledInterval.policy !== "standing-browser-canary" ||
    settledInterval.settle_ms !== plan.browser.settle_ms ||
    settledInterval.settle_ms <= 0 ||
    settledInterval.resource_completion_status !== "complete" ||
    settledInterval.initial_phase !== "domcontentloaded_immediate_observation" ||
    settledInterval.settled_phase !== "settled"
  ) {
    throw new Error("B610 settled interval is missing or unproved");
  }
  const artifacts = [
    requireArtifact(value.first_paint?.screenshot, "B610 initial screenshot"),
    requireArtifact(value.settled_viewport_screenshot, "B610 settled viewport screenshot"),
    requireArtifact(value.screenshot, "B610 settled full-page screenshot"),
  ];
  if (new Set(artifacts.map(({ path }) => path)).size !== artifacts.length) {
    throw new Error("B610 browser capture reused an artifact");
  }
  return artifacts;
}

function verifyShell(shell, plan) {
  const value = requirePlainObject(shell, "B610 shell observation");
  const expected = plan.expected;
  if (
    !same(value.header_direct_child_ids, expected.header_direct_child_ids) ||
    !same(value.header_extension_ids, expected.header_extension_ids) ||
    !same(value.container_extension_ids, expected.container_extension_ids) ||
    value.sidebar_close_href_count !== expected.sidebar_close_href_double_hash_count ||
    !same(value.sidebar_close_hrefs, ["##"]) ||
    value.search_top_box_count !== 1 ||
    value.search_form_count !== 1 ||
    value.search_form_class !== "input-append" ||
    value.search_query_input_count !== 1 ||
    value.search_query_input_class !== "text empty search-query" ||
    value.search_submit_count !== 1 ||
    value.search_submit_class !== "button btn"
  ) {
    throw new Error("B610 shell DOM does not match the fixed live contract");
  }
  const favicon = requirePlainObject(value.favicon, "B610 favicon observation");
  if (
    favicon.declaration_count < 1 ||
    typeof favicon.declared_href !== "string" ||
    !favicon.href_path.startsWith(expected.favicon_route_prefix) ||
    favicon.href_search !== "" ||
    favicon.href_hash !== "" ||
    favicon.route_request_path !== favicon.href_path ||
    favicon.route_status !== expected.favicon_route_status ||
    typeof favicon.route_location !== "string" ||
    favicon.route_location.length === 0
  ) {
    throw new Error("B610 favicon declaration or route does not match the contract");
  }
  return {
    header_direct_child_ids: value.header_direct_child_ids,
    header_extension_ids: value.header_extension_ids,
    container_extension_ids: value.container_extension_ids,
    sidebar_close_hrefs: value.sidebar_close_hrefs,
    search: {
      search_top_box_count: value.search_top_box_count,
      search_form_count: value.search_form_count,
      search_query_input_count: value.search_query_input_count,
      search_submit_count: value.search_submit_count,
    },
    favicon: {
      declared_href: favicon.declared_href,
      href_path: favicon.href_path,
      route_status: favicon.route_status,
      route_location: favicon.route_location,
    },
  };
}

export function verifyOpen43B610ShellCase(caseId, observations, plan) {
  if (!OPEN43_B610_SHELL_CASE_IDS.includes(caseId)) {
    throw new Error(`unknown B610 case: ${caseId}`);
  }
  const value = requirePlainObject(observations, `${caseId} observations`);
  if (
    value.fixture_id !== plan.fixture_id ||
    value.fixture_sha256 !== plan.fixture_sha256 ||
    value.page_url !== plan.page_url
  ) {
    throw new Error("B610 observation is not bound to the fixed fixture and page");
  }
  requireSha256(value.fixture_sha256, "B610 fixture SHA-256");
  const environment = requirePlainObject(value.browser_environment, "B610 browser environment");
  const environmentSha256 = sha256Value(environment);
  if (value.browser_environment_sha256 !== environmentSha256) {
    throw new Error("B610 observation browser environment hash is invalid");
  }
  const artifacts = verifyCapture(value.capture, plan);
  const shell = verifyShell(value.shell, plan);
  return {
    verified: true,
    fixture_id: value.fixture_id,
    fixture_sha256: value.fixture_sha256,
    browser_environment_sha256: environmentSha256,
    capture_artifact_sha256s: artifacts.map(({ sha256 }) => sha256),
    shell_sha256: sha256Value(shell),
  };
}

export function verifyOpen43B610ShellCleanup(proof, resources) {
  if (!Array.isArray(resources) || resources.some((resource) => resource.released !== true)) {
    throw new Error("B610 cleanup has unreleased resources");
  }
  const value = requirePlainObject(proof, "B610 cleanup proof");
  if (value.public_absence_verified !== true || value.run_owned_resource_count !== 0) {
    throw new Error("B610 cleanup did not prove public absence");
  }
  return {
    public_absence_verified: true,
    run_owned_resource_count: 0,
    resource_count: resources.length,
  };
}
