import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import { candidateCaseSet, candidateCaseUsage } from "../src/candidate-case-command.mjs";
import {
  OPEN43_MEDIA_BROWSER_CASE_IDS,
  restoreMediaBrowserSiteIcons,
  verifyOpen43MediaBrowserCase,
} from "../src/open43-media-browser-candidate.mjs";
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
  const pageRoute = read("framerail/src/routes/[slug]/[...extra]/page.svelte");
  const runner = read("install/local/wikidot-verification/src/candidate-case-runner.mjs");

  assert.match(spec, /candidate-case-command/u);
  assert.match(spec, /test\.skip/u);
  assert.doesNotMatch(spec, /writeFile|captureCandidateObservation|status:\s*["']pass["']|verdict\s*:/u);
  for (const text of ["securitypolicyviolation", "local--favicon", "gallery-box", "#file-upload", "negative_boundary_verified"]) assert.match(adapter, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(adapter, /fetch\(location\.href, \{ cache: "default" \}\)/u);
  assert.doesNotMatch(adapter, /response\.body\(\)/u);
  assert.match(adapter, /CandidateHttpSession/u);
  assert.match(adapter, /verified: true/u);
  assert.match(pageRoute, /id="files-button"[\s\S]*?event\.preventDefault\(\)[\s\S]*?activatePagePane\(PagePane\.File\)/u);
  assert.match(runner, /sealJsonNoReplace/u);
});

test("media browser natural geometry is pinned to the WWS medium resize contract", () => {
  const wws = read("wws/src/handler/resized_image.rs");
  assert.match(wws, /Self::Medium => 500/u);
});

test("M776 producer keeps the retained G06 f=image spelling and plain container boundary", () => {
  const adapter = read("install/local/wikidot-verification/src/open43-media-browser-candidate.mjs");
  assert.match(adapter, /const M776_POSITIVE_SOURCE = '\[\[f=image float\.png width="100px" alt="G06_IMAGE_ALT"\]\]'/u);
  assert.match(adapter, /const M776_NEGATIVE_SOURCE = "\[\[f=image\\u00a0float\.png/u);
  assert.match(adapter, /expectedClass = centered \? "aligncenter" : "image-container"/u);
  assert.match(adapter, /classes\.includes\("floatleft"\) \|\| classes\.includes\("floatright"\)/u);
  assert.match(adapter, /method === "GET" && resource_type === "image" && pathname === requiredPath/u);
  assert.doesNotMatch(adapter, /M776_POSITIVE_SOURCE[\s\S]*f<image/u);
});

test("media browser cleanup can exactly restore a producer-seeded legacy favicon snapshot", () => {
  const calls = [];
  const before = {
    favicon_source: "https://scp-wiki.wdfiles.com/local--files/site/favicon.gif",
    ios_icon_source: null,
    windows_tile_source: "/local--files/site/tile.png",
    settings_revision: 17,
  };
  restoreMediaBrowserSiteIcons({
    project: "candidate-project",
    siteId: 6000003,
    before,
    databaseQueryImpl(project, sql) {
      calls.push({ project, sql });
      return "UPDATE 1";
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].project, "candidate-project");
  assert.match(calls[0].sql, /favicon_source = 'https:\/\/scp-wiki\.wdfiles\.com\/local--files\/site\/favicon\.gif'/u);
  assert.match(calls[0].sql, /ios_icon_source = NULL/u);
  assert.match(calls[0].sql, /windows_tile_source = '\/local--files\/site\/tile\.png'/u);
  assert.match(calls[0].sql, /settings_revision = 17/u);
  assert.match(calls[0].sql, /WHERE site_id = 6000003/u);
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
  const clean = { candidate_requests: [{ method: "GET", resource_type: "image", pathname: `/local--resized-images/${slug}/${filename}/medium.jpg` }], candidate_failures: [], console_errors: [], page_errors: [], csp_violations: [] };
  const observations = {
    positive: {
      url: `https://candidate.wikijump.localhost/${slug}`,
      initial: { viewport: { width: 1280, height: 900 }, images: [image(), image()] },
      settled: { viewport: { width: 1280, height: 900 }, images: [image(), image()] },
      responsive: { viewport: { width: 479, height: 900 }, images: [image(), image()] },
      diagnostics: clean,
    },
    negative: {
      url: "https://candidate.wikijump.localhost/m806-negative",
      initial: { viewport: { width: 1280, height: 900 }, images: [] },
      settled: { viewport: { width: 1280, height: 900 }, images: [] },
      responsive: { viewport: { width: 479, height: 900 }, images: [] },
      diagnostics: { candidate_requests: [], candidate_failures: [], console_errors: [], page_errors: [], csp_violations: [] },
    },
    expected_file: { filename, width: 500, height: 250, source_width: 4, source_height: 2, byte_sha256: sha256(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAACAQMAAABFZu8gAAAAA1BMVEX/AAAZ4gk3AAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC", "base64")) },
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

test("M776 verifies initial, settled, responsive, and exact image request state", () => {
  const slug = "m776-positive";
  const filename = "float.png";
  const image = (phase) => ({
    container_class: "image-container",
    complete: true,
    natural_width: 500,
    natural_height: 250,
    width_attribute: "100px",
    computed_width: "100px",
    rendered_width: 100,
    rendered_height: 50,
    center_delta: 7.59,
    source_url: `https://candidate.wjfiles.localhost/local--resized-images/${slug}/${filename}/medium.jpg`,
    click_target_url: `https://candidate.wjfiles.localhost/local--files/${slug}/${filename}`,
    phase,
  });
  const clean = {
    candidate_requests: [{ method: "GET", resource_type: "image", pathname: `/local--resized-images/${slug}/${filename}/medium.jpg` }],
    candidate_failures: [],
    console_errors: [],
    page_errors: [],
    csp_violations: [],
  };
  const phaseSnapshot = (viewport) => ({ viewport, images: [image(viewport.width)], });
  const observations = {
    source: { positive_sha256: sha256('[[f=image float.png width="100px" alt="G06_IMAGE_ALT"]]'), negative_sha256: sha256("[[f=image\u00a0float.png width=\"100px\" alt=\"G06_IMAGE_ALT\"]]") },
    positive: {
      url: `https://candidate.wikijump.localhost/${slug}`,
      initial: phaseSnapshot({ width: 1280, height: 900 }),
      settled: phaseSnapshot({ width: 1280, height: 900 }),
      responsive: phaseSnapshot({ width: 479, height: 900 }),
      diagnostics: clean,
    },
    negative: {
      url: "https://candidate.wikijump.localhost/m776-negative",
      initial: { viewport: { width: 1280, height: 900 }, images: [] },
      settled: { viewport: { width: 1280, height: 900 }, images: [] },
      responsive: { viewport: { width: 479, height: 900 }, images: [] },
      diagnostics: { candidate_requests: [], candidate_failures: [], console_errors: [], page_errors: [], csp_violations: [] },
    },
    expected_file: { filename, width: 500, height: 250, source_width: 4, source_height: 2, byte_sha256: sha256(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAACAQMAAABFZu8gAAAAA1BMVEX/AAAZ4gk3AAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC", "base64")) },
  };
  assert.equal(verifyOpen43MediaBrowserCase("M776_BROWSER_GEOMETRY_AND_NETWORK", observations).verified, true);

  const missingInitial = structuredClone(observations);
  missingInitial.positive.initial.images = [];
  assert.throws(() => verifyOpen43MediaBrowserCase("M776_BROWSER_GEOMETRY_AND_NETWORK", missingInitial), /positive image denominator is wrong/u);

  const wrongSource = structuredClone(observations);
  wrongSource.source.positive_sha256 = sha256("[[f<image float.png width=\"100px\"]]");
  assert.throws(() => verifyOpen43MediaBrowserCase("M776_BROWSER_GEOMETRY_AND_NETWORK", wrongSource), /source fixture drifted/u);

  const wrongRequestKind = structuredClone(observations);
  wrongRequestKind.positive.diagnostics.candidate_requests[0].resource_type = "document";
  assert.throws(() => verifyOpen43MediaBrowserCase("M776_BROWSER_GEOMETRY_AND_NETWORK", wrongRequestKind), /omitted the exact image request/u);
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

test("M1043 verifies thumbnail identity and viewer failure boundaries without a browser run", () => {
  const one = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAACAQMAAABFZu8gAAAAA1BMVEX/AAAZ4gk3AAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC", "base64");
  const two = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAAEAQMAAACeIXx6AAAAA1BMVEUAAP+KeNJXAAAAC0lEQVQI12NggAAAAAgAAS8g3TEAAAAASUVORK5CYII=", "base64");
  const slug = "m1043-gallery";
  const file = (filename, bytes, width, height) => ({ filename, sha256: sha256(bytes), width, height });
  const expectedFiles = [
    file("gallery-one.png", one, 100, 50),
    file("gallery-two.png", two, 50, 100),
    file("gallery-disabled.png", one, 100, 50),
    file("gallery-broken.png", one, 100, 50),
  ];
  const anchor = (expected) => ({
    href: `https://m1043.wjfiles.localhost/local--files/${slug}/${expected.filename}`,
    image_src: `https://m1043.wjfiles.localhost/local--resized-images/${slug}/${expected.filename}/thumbnail.jpg`,
  });
  const image = (expected) => ({
    complete: true,
    natural_width: expected.width,
    natural_height: expected.height,
    source_url: anchor(expected).image_src,
  });
  const thumbnails = {
    galleries: [
      { id: "gallery-box-1", images: [image(expectedFiles[0]), image(expectedFiles[1])] },
      { id: "gallery-box-2", images: [image(expectedFiles[2])] },
      { id: "gallery-box-3", images: [image(expectedFiles[3])] },
    ],
  };
  const token = "document-token";
  const viewer = (overrides = {}) => ({
    overlay_count: 1,
    lightbox_count: 1,
    loading_visible: false,
    image_visible: true,
    previous_visible: false,
    next_visible: true,
    current_number: "image 1 of 2",
    image_url: anchor(expectedFiles[0]).href,
    active_element: "gallery-viewer-one",
    document_token: token,
    ...overrides,
  });
  const clean = {
    candidate_requests: expectedFiles.map((expected) => ({ pathname: `/local--resized-images/${slug}/${expected.filename}/thumbnail.jpg` })),
    candidate_failures: [],
    console_errors: [],
    page_errors: [],
    csp_violations: [],
  };
  const observations = {
    url: `https://m1043.wikijump.localhost/${slug}`,
    expected_files: expectedFiles,
    static: [anchor(expectedFiles[0]), anchor(expectedFiles[1])],
    disabled_static: [anchor(expectedFiles[2])],
    broken_static: [anchor(expectedFiles[3])],
    thumbnails: { initial: thumbnails, settled: thumbnails },
    loading: viewer({ loading_visible: true, image_visible: false }),
    first: viewer(),
    next: viewer({ current_number: "image 2 of 2", previous_visible: true, next_visible: false, image_url: anchor(expectedFiles[1]).href }),
    previous: viewer(),
    overlay_closed: viewer({ overlay_count: 0, lightbox_count: 0 }),
    disabled_navigation: { pathname: `/local--files/${slug}/gallery-disabled.png`, lightbox_count: 0 },
    failure: viewer({ loading_visible: true, image_visible: false }),
    closed: viewer({ overlay_count: 0, lightbox_count: 0 }),
    diagnostics: clean,
  };

  const result = verifyOpen43MediaBrowserCase("M1043_BROWSER_RENDER_AND_VIEWER", observations);
  assert.equal(result.verified, true);
  assert.equal(result.thumbnail_identity_verified, true);
  assert.equal(result.focus_verified, true);

  const wrongThumbnail = structuredClone(observations);
  wrongThumbnail.thumbnails.settled.galleries[0].images[0].source_url = "https://m1043.wjfiles.localhost/local--files/m1043-gallery/gallery-one.png";
  assert.throws(() => verifyOpen43MediaBrowserCase("M1043_BROWSER_RENDER_AND_VIEWER", wrongThumbnail), /thumbnail request identity/u);

  const missingErrorBoundary = structuredClone(observations);
  missingErrorBoundary.failure.loading_visible = false;
  assert.throws(() => verifyOpen43MediaBrowserCase("M1043_BROWSER_RENDER_AND_VIEWER", missingErrorBoundary), /failed-image loading interval/u);

  const replacedDocument = structuredClone(observations);
  replacedDocument.next.document_token = "new-document";
  assert.throws(() => verifyOpen43MediaBrowserCase("M1043_BROWSER_RENDER_AND_VIEWER", replacedDocument), /replaced the document/u);

  const abortedViewerImage = structuredClone(observations);
  abortedViewerImage.diagnostics.candidate_failures = [{
    pathname: `/local--files/${slug}/gallery-one.png`,
    method: "GET",
    resource_type: "image",
    error: "net::ERR_ABORTED",
    phase: null,
  }];
  assert.throws(() => verifyOpen43MediaBrowserCase("M1043_BROWSER_RENDER_AND_VIEWER", abortedViewerImage), /candidate-owned request failure/u);
});

test("M1043 waits for enabled full-image requests to settle before each viewer transition", () => {
  const adapter = read("install/local/wikidot-verification/src/open43-media-browser-candidate.mjs");
  const start = adapter.indexOf("async #galleryCase()");
  const end = adapter.indexOf("async #uploadBrowserCase()", start);
  assert.ok(start >= 0 && end > start);
  const gallery = adapter.slice(start, end);
  assert.match(gallery, /const viewerImageRequests = trackRequestQuiescence/u);
  assert.match(gallery, /gallery-one\.png/u);
  assert.match(gallery, /gallery-two\.png/u);
  assert.match(gallery, /route\.fulfill\(\{ status: 200, contentType: "image\/png", body: "not-a-png" \}\)/u);
  assert.equal([...gallery.matchAll(/viewerImageRequests\.waitForQuiet\(\)/gu)].length, 3);
  assert.match(gallery, /viewerImageRequests\.close\(\)/u);
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

  const toleratedCancellation = structuredClone(observations);
  toleratedCancellation.url = "https://candidate.wikijump.localhost/open43-media-browser-run-upload";
  const lifecycleCancellation = {
    pathname: "/open43-media-browser-run-upload/__data.json",
    method: "GET",
    resource_type: "fetch",
    error: "net::ERR_ABORTED",
    phase: "double-submit",
  };
  for (const phase of ["success-submit", "double-submit"]) {
    const phaseCancellation = structuredClone(toleratedCancellation);
    phaseCancellation.diagnostics.candidate_failures = [{ ...lifecycleCancellation, phase }];
    assert.equal(verifyOpen43MediaBrowserCase("M1062_BROWSER_UPLOAD_FLOW", phaseCancellation).verified, true);
  }
  toleratedCancellation.diagnostics.candidate_failures = [lifecycleCancellation];

  for (const [field, value] of [
    ["phase", "reload"],
    ["method", "POST"],
    ["resource_type", "document"],
    ["pathname", "/other/__data.json"],
    ["error", "net::ERR_FAILED"],
  ]) {
    const wrongCancellation = structuredClone(toleratedCancellation);
    wrongCancellation.diagnostics.candidate_failures[0][field] = value;
    assert.throws(() => verifyOpen43MediaBrowserCase("M1062_BROWSER_UPLOAD_FLOW", wrongCancellation), /recorded a candidate-owned request failure/u);
  }

  const duplicateCancellation = structuredClone(toleratedCancellation);
  duplicateCancellation.diagnostics.candidate_failures.push({ ...lifecycleCancellation, phase: "success-submit" });
  assert.throws(() => verifyOpen43MediaBrowserCase("M1062_BROWSER_UPLOAD_FLOW", duplicateCancellation), /too many tolerated candidate-owned lifecycle cancellations/u);
});
