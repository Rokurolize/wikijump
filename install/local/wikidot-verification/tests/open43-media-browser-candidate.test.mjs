import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import { candidateCaseSet, candidateCaseUsage } from "../src/candidate-case-command.mjs";
import { OPEN43_MEDIA_BROWSER_CASE_IDS, verifyOpen43MediaBrowserCase } from "../src/open43-media-browser-candidate.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const root = new URL("../../../../", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function documentObservation(phase) {
  return {
    phase,
    dom_signatures: [],
    attribute_signatures: [],
    ...(phase === "settled" ? { resource_completion: { status: "complete" } } : {}),
  };
}

function intervalExpectation(initial, settled, requestHash, forbidden = []) {
  const phase = (document) => ({
    iframe_count: 0,
    focusable_iframe_count: 0,
    active_element: "body",
    dom_signature_sha256: sha256Value({ dom_signatures: document.dom_signatures, attribute_signatures: document.attribute_signatures }),
  });
  return {
    initial: phase(initial),
    settled: phase(settled),
    csp_header_sha256: sha256(""),
    required_request_url_sha256: [requestHash],
    forbidden_request_url_sha256: forbidden,
  };
}

function centeredImageSnapshot(centerDelta, sourceUrlSha256, viewport = { width: 1280, height: 900 }) {
  const image = {
    complete: true,
    natural_width: 500,
    natural_height: 250,
    width_attribute: "100px",
    computed_width: "100px",
    rendered_width: 100,
    rendered_height: 50,
    center_delta: centerDelta,
    source_url_sha256: sourceUrlSha256,
    click_target_url_sha256: null,
    click_target: null,
  };
  return { viewport, images: [image, { ...image }], events: [{ type: "load", source_url_sha256: sourceUrlSha256 }] };
}

function intervalObservation(url, initial, settled, requestHash, centeredImages) {
  return {
    url,
    capture: {
      navigation_status: 200,
      final_url: url,
      first_paint: { document: initial },
      document: settled,
      failures: [],
      request_gate_aborts: [],
    },
    immediate_focus: { iframe_count: 0, focusable_iframe_count: 0, active_element: "body" },
    settled_focus: { iframe_count: 0, focusable_iframe_count: 0, active_element: "body" },
    network: [{ event: "request", resource_type: "image", url: { url_sha256: requestHash } }],
    console: [],
    page_errors: [],
    csp_header: null,
    csp_violations: [],
    centered_images: centeredImages,
    cleanup: { page_closed: true },
  };
}

test("media browser rows are one executable CandidateCaseSet denominator", async () => {
  const audit = JSON.parse(read("docs/development/open43-m-closure-audit.json"));
  const expected = audit.issues
    .filter(({ issue }) => [756, 776, 806, 1039, 1043, 1062].includes(issue))
    .flatMap(({ subrows }) => subrows)
    .filter(({ classification, next_command_ids }) => classification === "candidate_required" && next_command_ids.includes("C_MEDIA_BROWSER_CANDIDATE"))
    .map(({ case_id }) => case_id);
  const caseSet = await candidateCaseSet("open43-media-browser");

  assert.deepEqual(caseSet.caseIds, expected);
  assert.deepEqual(OPEN43_MEDIA_BROWSER_CASE_IDS, expected);
  assert.ok(OPEN43_MEDIA_BROWSER_CASE_IDS.includes("M806_BROWSER_GEOMETRY_AND_NETWORK"));
  assert.equal(typeof caseSet.prepareRun, "function");
  assert.match(candidateCaseUsage(), /open43-media-browser/u);
});

test("M1042_BROWSER_LIFECYCLE has exactly one executable denominator owner", async () => {
  const media = await candidateCaseSet("open43-media-browser");
  const embedvideo = await candidateCaseSet("open43-embedvideo-browser");
  const claims = [...media.caseIds, ...embedvideo.caseIds];
  assert.equal(claims.filter((caseId) => caseId === "M1042_BROWSER_LIFECYCLE").length, 1);
  assert.equal(media.caseIds.includes("M1042_BROWSER_LIFECYCLE"), false);
  assert.deepEqual(embedvideo.caseIds, ["M1042_BROWSER_LIFECYCLE"]);
});

test("the Playwright file is collection-only and the case set owns candidate receipts", () => {
  const spec = read("framerail/tests/open43-media-files-candidate.spec.ts");
  const adapter = read("install/local/wikidot-verification/src/open43-media-browser-candidate.mjs");
  const runner = read("install/local/wikidot-verification/src/candidate-case-runner.mjs");

  assert.match(spec, /candidate-case-command/u);
  assert.match(spec, /test\.skip/u);
  assert.doesNotMatch(spec, /writeFile|captureCandidateObservation|status:\s*["']pass["']|verdict\s*:/u);
  for (const text of ["securitypolicyviolation", "local--favicon", "gallery-box", "#file-upload", "negative_boundary_verified"]) assert.match(adapter, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(adapter, /fetch\(location\.href, \{ cache: "default" \}\)/u);
  assert.doesNotMatch(adapter, /response\.body\(\)/u);
  assert.match(adapter, /CandidateHttpSession/u);
  assert.match(adapter, /verified: true/u);
  assert.match(runner, /sealJsonNoReplace/u);
});

test("media browser natural geometry is pinned to the WWS medium resize contract", () => {
  const wws = read("wws/src/handler/resized_image.rs");
  assert.match(wws, /Self::Medium => 500/u);
});

test("M806 enforces centered width, exact local routes, and whitespace ownership at both viewports", () => {
  const slug = "m806-positive";
  const filename = "center.png";
  const image = (delta = 0) => ({
    container_class: "image-container aligncenter",
    complete: true,
    natural_width: 500,
    natural_height: 250,
    width_attribute: "100px",
    computed_width: "100px",
    rendered_width: 100,
    rendered_height: 50,
    center_delta: delta,
    source_url: `https://candidate.wjfiles.localhost/local--resized-images/${slug}/${filename}/medium.jpg`,
    click_target_url: `https://candidate.wjfiles.localhost/local--files/${slug}/${filename}`,
  });
  const clean = { candidate_requests: [{ pathname: `/local--resized-images/${slug}/${filename}/medium.jpg` }], candidate_failures: [], console_errors: [], page_errors: [], csp_violations: [] };
  const observations = {
    positive: {
      url: `https://candidate.wikijump.localhost/${slug}`,
      settled: { viewport: { width: 1280, height: 900 }, images: [image(), image()] },
      responsive: { viewport: { width: 479, height: 900 }, images: [image(), image()] },
      diagnostics: clean,
    },
    negative: {
      url: "https://candidate.wikijump.localhost/m806-negative",
      settled: { viewport: { width: 1280, height: 900 }, images: [] },
      responsive: { viewport: { width: 479, height: 900 }, images: [] },
      diagnostics: { candidate_requests: [], candidate_failures: [], console_errors: [], page_errors: [], csp_violations: [] },
    },
    expected_file: { filename, width: 500, height: 250, source_width: 4, source_height: 2, byte_sha256: sha256("fixed") },
  };
  assert.equal(verifyOpen43MediaBrowserCase("M806_BROWSER_GEOMETRY_AND_NETWORK", observations).verified, true);

  const offCenter = structuredClone(observations);
  offCenter.positive.settled.images[0].center_delta = 12;
  assert.throws(() => verifyOpen43MediaBrowserCase("M806_BROWSER_GEOMETRY_AND_NETWORK", offCenter), /not centered/u);

  const wrongWidth = structuredClone(observations);
  wrongWidth.positive.responsive.images[0].rendered_width = 99;
  assert.throws(() => verifyOpen43MediaBrowserCase("M806_BROWSER_GEOMETRY_AND_NETWORK", wrongWidth), /image width is wrong/u);

  const stolenNegative = structuredClone(observations);
  stolenNegative.negative.settled.images = [image()];
  assert.throws(() => verifyOpen43MediaBrowserCase("M806_BROWSER_GEOMETRY_AND_NETWORK", stolenNegative), /negative whitespace control acquired image ownership/u);
});

test("M756 accepts Wikidot-style document navigation while rejecting stale icon state", () => {
  const first = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAACAQMAAABFZu8gAAAAA1BMVEX/AAAZ4gk3AAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC", "base64");
  const second = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAAEAQMAAACeIXx6AAAAA1BMVEUAAP+KeNJXAAAAC0lEQVQI12NggAAAAAgAAS8g3TEAAAAASUVORK5CYII=", "base64");
  const clean = { candidate_failures: [], console_errors: [], page_errors: [], csp_violations: [] };
  const observations = {
    first_source: "/local--files/fixture/icon-a.png",
    second_source: "/local--files/fixture/icon-b.png",
    first: { pathname: "/local--favicon/favicon.gif" },
    reload: { pathname: "/local--favicon/favicon.gif" },
    client: { pathname: "/local--favicon/favicon.gif", document_preserved: false },
    first_fetch: { status: 200, final_url: "https://fixture.wjfiles.localhost/local--files/fixture/icon-a.png", body_sha256: sha256(first) },
    reload_fetch: { status: 200, final_url: "https://fixture.wjfiles.localhost/local--files/fixture/icon-b.png", body_sha256: sha256(second) },
    client_fetch: { status: 200, final_url: "https://fixture.wjfiles.localhost/local--files/fixture/icon-b.png", body_sha256: sha256(second) },
    diagnostics: clean,
  };

  const result = verifyOpen43MediaBrowserCase("M756_BROWSER_CACHE_TRANSITIONS", observations);
  assert.equal(result.verified, true);
  assert.equal(result.client_navigation_observed, true);
  assert.equal(result.client_navigation_preserved_document, false);

  const stale = structuredClone(observations);
  stale.client_fetch.body_sha256 = sha256(first);
  assert.throws(() => verifyOpen43MediaBrowserCase("M756_BROWSER_CACHE_TRANSITIONS", stale), /stale favicon bytes/u);
});

test("M1062 requires the failed empty action interval before the successful upload", () => {
  const uploadBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAACAQMAAABFZu8gAAAAA1BMVEX/AAAZ4gk3AAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC", "base64");
  const clean = { candidate_requests: [], candidate_failures: [], console_errors: [], page_errors: [], csp_violations: [] };
  const observations = {
    empty_submission: {
      before: { form_visible: true, file_rows: 0 },
      after: { form_visible: true, file_rows: 0, action_request_count: 1, action_status: 200, error_dialog_visible: true },
    },
    pending: { request_seen: true, form_visible: true },
    success: { form_visible: false, row_count: 1, action_request_count: 1, file_list_quiescent: true, file_list_quiet_ms: 500 },
    reload: { row_count: 1, download_href: "/-/file/upload/browser-upload.png" },
    download: { status: 200, body_size: uploadBytes.length, body_sha256: sha256(uploadBytes) },
    double_submit: { action_request_count: 1, row_count: 1 },
    diagnostics: clean,
  };
  assert.equal(verifyOpen43MediaBrowserCase("M1062_BROWSER_UPLOAD_FLOW", observations).verified, true);

  const noFailedRequest = structuredClone(observations);
  noFailedRequest.empty_submission.after.action_request_count = 0;
  assert.throws(() => verifyOpen43MediaBrowserCase("M1062_BROWSER_UPLOAD_FLOW", noFailedRequest), /exact failed action interval/u);

  const missingDialog = structuredClone(observations);
  missingDialog.empty_submission.after.error_dialog_visible = false;
  assert.throws(() => verifyOpen43MediaBrowserCase("M1062_BROWSER_UPLOAD_FLOW", missingDialog), /exact failed action interval/u);

  const unsettledRefresh = structuredClone(observations);
  unsettledRefresh.success.file_list_quiescent = false;
  assert.throws(() => verifyOpen43MediaBrowserCase("M1062_BROWSER_UPLOAD_FLOW", unsettledRefresh), /settled file-list refresh/u);

  const failedRequest = structuredClone(observations);
  failedRequest.diagnostics.candidate_failures = [{ pathname: "/probe", resource_type: "fetch", error: "net::ERR_ABORTED" }];
  assert.throws(() => verifyOpen43MediaBrowserCase("M1062_BROWSER_UPLOAD_FLOW", failedRequest), /fetch \/probe net::ERR_ABORTED/u);
});
