import assert from "node:assert/strict";
import test from "node:test";

import {
  captureDocumentObservation,
  isExpectedExternalAssetFailure,
  observationArtifactName,
  prewarmBrowserParityLazyImages,
} from "../src/standing-browser-parity-observation.mjs";

test("lazy-image prewarming restores scroll synchronously on smooth pages", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const calls = [];
  globalThis.window = {
    scrollY: 646,
    scrollTo: (options) => calls.push(options),
  };
  globalThis.document = { images: [] };
  try {
    await prewarmBrowserParityLazyImages({ evaluate: async (callback) => callback() });
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
  assert.deepEqual(calls, [{ left: 0, top: 646, behavior: "instant" }]);
});

test("external wdfiles stylesheet ORB failures remain separately attributable", () => {
  assert.equal(isExpectedExternalAssetFailure({ url: "https://scp-wiki.wdfiles.com/theme.css", resource_type: "stylesheet", error: "net::ERR_BLOCKED_BY_ORB" }), true);
  assert.equal(isExpectedExternalAssetFailure({ url: "https://scp-wiki.wdfiles.com/theme.css", resource_type: "stylesheet", error: "net::ERR_TIMED_OUT" }), true);
  assert.equal(isExpectedExternalAssetFailure({ url: "https://scp-wiki.wikidot.com/local--favicon/favicon.gif", resource_type: "other", error: "net::ERR_BLOCKED_BY_ORB" }), true);
  assert.equal(isExpectedExternalAssetFailure({ url: "https://example.test/app.js", resource_type: "script", error: "net::ERR_FAILED" }), false);
});

test("immediate and settled browser artifacts have deterministic, distinct safe names", () => {
  const input = {
    label: "local",
    index: 0,
    url: "https://scp-wiki.wikijump.localhost:18443/scp-9506",
  };
  const immediate = observationArtifactName({
    ...input,
    phase: "domcontentloaded-immediate",
  });
  const viewport = observationArtifactName({
    ...input,
    phase: "settled-viewport",
  });
  const fullPage = observationArtifactName({
    ...input,
    phase: "settled-full-page",
  });
  assert.match(
    immediate,
    /^standing-browser-local-00-[0-9a-f]{16}-domcontentloaded-immediate\.png$/u,
  );
  assert.notEqual(immediate, viewport);
  assert.notEqual(viewport, fullPage);
  assert.throws(
    () => observationArtifactName({ ...input, phase: "first-paint" }),
    /unsupported browser observation artifact phase/u,
  );
});

test("closed details descendants are excluded from rendered DOM and image counts", async () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };
  const node = (localName, id) => ({
    localName,
    id,
    classList: [],
    children: [],
    parentElement: null,
    getBoundingClientRect: () => box,
    contains(candidate) {
      return this.children.some(
        (child) => child === candidate || child.contains(candidate),
      );
    },
    closest(selector) {
      for (let candidate = this; candidate; candidate = candidate.parentElement) {
        if (
          selector === "details:not([open])" &&
          candidate.localName === "details" &&
          !candidate.open
        ) {
          return candidate;
        }
      }
      return null;
    },
  });
  const append = (parent, ...children) => {
    parent.children.push(...children);
    for (const child of children) child.parentElement = parent;
  };
  const details = node("details", "closed");
  const summary = node("summary", "first-summary");
  const summaryChild = node("span", "summary-child");
  const secondSummary = node("summary", "second-summary");
  const hiddenImage = Object.assign(node("img", "hidden"), {
    complete: true,
    naturalWidth: 20,
    naturalHeight: 20,
    currentSrc: "https://example.test/hidden.png",
    src: "https://example.test/hidden.png",
  });
  append(summary, summaryChild);
  append(details, summary, secondSummary, hiddenImage);

  const outerDetails = node("details", "outer");
  const outerSummary = node("summary", "outer-summary");
  const innerDetails = node("details", "inner");
  const innerSummary = node("summary", "inner-summary");
  append(innerDetails, innerSummary);
  append(outerDetails, outerSummary, innerDetails);

  const observedNodes = [
    details,
    summary,
    summaryChild,
    secondSummary,
    hiddenImage,
    outerDetails,
    outerSummary,
    innerDetails,
    innerSummary,
  ];
  const root = { querySelectorAll: () => observedNodes };
  const fakeDocument = {
    images: [hiddenImage],
    documentElement: details,
    querySelector: (selector) => (selector === "#page-content" ? root : null),
    querySelectorAll: () => [],
  };
  const fakePage = {
    evaluate: async (callback, argument) => {
      const previousDocument = globalThis.document;
      const previousGetComputedStyle = globalThis.getComputedStyle;
      globalThis.document = fakeDocument;
      globalThis.getComputedStyle = () => ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        getPropertyValue: () => "",
      });
      try {
        return callback(argument);
      } finally {
        globalThis.document = previousDocument;
        globalThis.getComputedStyle = previousGetComputedStyle;
      }
    },
  };
  const observation = await captureDocumentObservation(fakePage, {
    contract: {
      geometry_selectors: [],
      first_paint_geometry_selectors: [],
      presence_probes: [],
      first_paint_custom_properties: {},
    },
    phase: "settled",
    viewport: { width: 1366, height: 900 },
  });
  assert.deepEqual(observation.dom_signatures, [
    "details#closed",
    "details#outer",
    "span#summary-child",
    "summary#first-summary",
    "summary#outer-summary",
  ]);
  assert.equal(observation.rendered_images, 0);
});

test("ordered element trace text is fingerprinted outside the browser capture", async () => {
  const fakePage = {
    evaluate: async () => ({
      geometry: {},
      presence_probes: [],
      custom_properties: {},
      dom_signatures: [],
      page_content_html: "",
      attribute_signatures: [],
      rendered_images: 0,
      broken_images: [],
      page_content_rendered_images: 0,
      page_content_broken_images: [],
      page_chrome_skeleton: null,
      first_divergence_trace: {
        root_selector: "#page-content",
        root_count: 1,
        element_count: 1,
        captured_count: 1,
        truncated: false,
        incomplete_image_count: 0,
        elements: [
          {
            path: "p[1]",
            tag: "p",
            id: null,
            classes: [],
            child_element_count: 0,
            direct_text: "visible text",
            rect: { x: 0, y: 0, width: 100, height: 20 },
            style: { display: "block" },
          },
        ],
      },
    }),
  };
  const observation = await captureDocumentObservation(fakePage, {
    contract: {
      geometry_selectors: [],
      first_paint_geometry_selectors: [],
      presence_probes: [],
      first_paint_custom_properties: {},
      first_divergence_trace: {
        root_selector: "#page-content",
        max_elements: 100,
      },
    },
    phase: "settled",
    viewport: { width: 1366, height: 900 },
  });
  const [element] = observation.first_divergence_trace.elements;
  assert.equal(element.direct_text, undefined);
  assert.equal(
    element.direct_text_sha256,
    "fc92c6938ea55736c5ece997d6c91450406fe3fdfc1f928b8790afd14c882662",
  );
  assert.equal(
    element.normalized_direct_text_sha256,
    "fc92c6938ea55736c5ece997d6c91450406fe3fdfc1f928b8790afd14c882662",
  );
  assert.equal(element.direct_text_normalized, false);
});

test("ordered element traces preserve but normalize mutable page rating scores", async () => {
  const fakePage = {
    evaluate: async () => ({
      geometry: {},
      presence_probes: [],
      custom_properties: {},
      dom_signatures: [],
      page_content_html: "",
      attribute_signatures: [],
      rendered_images: 0,
      broken_images: [],
      page_content_rendered_images: 0,
      page_content_broken_images: [],
      page_chrome_skeleton: null,
      first_divergence_trace: {
        root_selector: "#page-content",
        root_count: 1,
        element_count: 1,
        captured_count: 1,
        truncated: false,
        incomplete_image_count: 0,
        elements: [
          {
            path: "div[1]/span[1]/span[1]",
            tag: "span",
            id: null,
            classes: ["number", "prw54353"],
            child_element_count: 0,
            direct_text: "+312",
            direct_text_kind: "page_rating_score",
            rect: { x: 0, y: 0, width: 40, height: 20 },
            style: { display: "inline" },
          },
        ],
      },
    }),
  };
  const observation = await captureDocumentObservation(fakePage, {
    contract: {
      geometry_selectors: [],
      first_paint_geometry_selectors: [],
      presence_probes: [],
      first_paint_custom_properties: {},
      first_divergence_trace: {
        root_selector: "#page-content",
        max_elements: 100,
      },
    },
    phase: "settled",
    viewport: { width: 1366, height: 900 },
  });
  const [element] = observation.first_divergence_trace.elements;
  assert.equal(element.direct_text_normalization, "page_rating_score");
  assert.equal(element.direct_text_observed, "+312");
  assert.equal(element.direct_text_normalized, true);
  assert.notEqual(element.direct_text_sha256, element.normalized_direct_text_sha256);
});
