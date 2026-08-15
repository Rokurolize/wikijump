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
    natural_width: 4,
    natural_height: 2,
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
  for (const text of ["domcontentloaded_immediate_observation", "settled", "csp_violations", "required_request_url_sha256", "forbidden_request_url_sha256", "negative_boundary_verified"]) assert.match(adapter, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(adapter, /runCandidateCaseSet|candidate-case-runner/u);
  assert.match(adapter, /verified: true/u);
  assert.match(runner, /sealJsonNoReplace/u);
});

test("M806 enforces centered width and whitespace ownership at both viewports", () => {
  const sourceUrlSha256 = sha256("https://files.example/centered.png");
  const positiveInitial = documentObservation("domcontentloaded_immediate_observation");
  const positiveSettled = documentObservation("settled");
  const negativeInitial = documentObservation("domcontentloaded_immediate_observation");
  const negativeSettled = documentObservation("settled");
  const badSnapshot = centeredImageSnapshot(12, sourceUrlSha256);
  const negativeSnapshot = (viewport) => ({ viewport, images: [], events: [] });
  const responsiveViewport = { width: 479, height: 900 };
  const observations = {
    positive: intervalObservation("https://candidate.example/positive", positiveInitial, positiveSettled, sourceUrlSha256, {
      initial: badSnapshot,
      settled: badSnapshot,
      responsive: centeredImageSnapshot(12, sourceUrlSha256, responsiveViewport),
    }),
    negative: intervalObservation("https://candidate.example/negative", negativeInitial, negativeSettled, sha256("https://candidate.example/negative"), {
      initial: negativeSnapshot({ width: 1280, height: 900 }),
      settled: negativeSnapshot({ width: 1280, height: 900 }),
      responsive: negativeSnapshot(responsiveViewport),
    }),
  };
  const expected = {
    positive: intervalExpectation(positiveInitial, positiveSettled, sourceUrlSha256),
    negative: intervalExpectation(negativeInitial, negativeSettled, sha256("https://candidate.example/negative"), [sourceUrlSha256]),
  };
  const centeredImage = {
    responsive_viewport: responsiveViewport,
    width_attribute: "100px",
    computed_width: "100px",
    rendered_width: 100,
    natural_width: 4,
    natural_height: 2,
    source_url_sha256: sourceUrlSha256,
    click_target_url_sha256: null,
    expected_snapshot_sha256: {
      positive: Object.fromEntries(Object.entries(observations.positive.centered_images).map(([phase, value]) => [phase, sha256Value(value)])),
      negative: Object.fromEntries(Object.entries(observations.negative.centered_images).map(([phase, value]) => [phase, sha256Value(value)])),
    },
  };

  const passingObservations = structuredClone(observations);
  passingObservations.positive.centered_images = {
    initial: centeredImageSnapshot(0, sourceUrlSha256),
    settled: centeredImageSnapshot(0, sourceUrlSha256),
    responsive: centeredImageSnapshot(0, sourceUrlSha256, responsiveViewport),
  };
  const passingContract = structuredClone(centeredImage);
  passingContract.expected_snapshot_sha256.positive = Object.fromEntries(Object.entries(passingObservations.positive.centered_images).map(([phase, value]) => [phase, sha256Value(value)]));
  assert.equal(verifyOpen43MediaBrowserCase("M806_BROWSER_GEOMETRY_AND_NETWORK", passingObservations, { expected, centered_image: passingContract }).verified, true);

  assert.throws(
    () => verifyOpen43MediaBrowserCase("M806_BROWSER_GEOMETRY_AND_NETWORK", observations, { expected, centered_image: centeredImage }),
    /centered image is not centered/u,
  );

  const wrongWidth = structuredClone(passingObservations);
  for (const snapshot of Object.values(wrongWidth.positive.centered_images)) for (const image of snapshot.images) image.rendered_width = 99;
  const wrongWidthContract = structuredClone(passingContract);
  wrongWidthContract.expected_snapshot_sha256.positive = Object.fromEntries(Object.entries(wrongWidth.positive.centered_images).map(([phase, value]) => [phase, sha256Value(value)]));
  assert.throws(
    () => verifyOpen43MediaBrowserCase("M806_BROWSER_GEOMETRY_AND_NETWORK", wrongWidth, { expected, centered_image: wrongWidthContract }),
    /centered image width is wrong/u,
  );

  const stolenNegative = structuredClone(passingObservations);
  for (const [phase, snapshot] of Object.entries(stolenNegative.negative.centered_images)) snapshot.images = centeredImageSnapshot(0, sourceUrlSha256, phase === "responsive" ? responsiveViewport : undefined).images;
  const stolenNegativeContract = structuredClone(passingContract);
  stolenNegativeContract.expected_snapshot_sha256.negative = Object.fromEntries(Object.entries(stolenNegative.negative.centered_images).map(([phase, value]) => [phase, sha256Value(value)]));
  assert.throws(
    () => verifyOpen43MediaBrowserCase("M806_BROWSER_GEOMETRY_AND_NETWORK", stolenNegative, { expected, centered_image: stolenNegativeContract }),
    /negative whitespace control acquired image ownership/u,
  );
});
