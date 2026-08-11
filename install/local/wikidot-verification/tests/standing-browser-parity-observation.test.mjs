import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createBrowserRequestGate,
  installBrowserRequestGate,
  isWikidotCapturePublicOrigin,
} from "../src/browser-request-gate.mjs";
import {
  captureBrowserParityObservation,
  captureDocumentObservation,
  observationArtifactName,
} from "../src/standing-browser-parity-observation.mjs";

const requireFromFramerail = createRequire(
  path.resolve(import.meta.dirname, "../../../../framerail/package.json"),
);

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

test("an intentional request-gate abort is sealed separately from organic page failures", async (context) => {
  const { chromium } = requireFromFramerail("playwright");
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "standing-gate-attribution-"),
  );
  const browser = await chromium.launch({ headless: true });
  const browserContext = await browser.newContext({ serviceWorkers: "block" });
  context.after(async () => {
    await browserContext.close();
    await browser.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const gate = createBrowserRequestGate({ intervalMs: 4_000 });
  const attribution = await installBrowserRequestGate(browserContext, {
    gate,
    publicOriginPredicate: isWikidotCapturePublicOrigin,
  });
  const page = await browserContext.newPage();
  const observation = await captureBrowserParityObservation({
    context: browserContext,
    page,
    url: "https://scp-wiki.wikidot.com/gate-attribution-fixture",
    label: "live",
    index: 0,
    outputDir: directory,
    contract: null,
    viewport: { width: 800, height: 600 },
    timeoutMs: 10_000,
    settleMs: 0,
    requestGateAttribution: attribution,
    navigate: async ({ page: target }) => {
      await target.setContent(
        '<main id="page-content">fixture</main><script src="https://cdn.onesignal.com/sdks/OneSignalSDK.js"></script>',
        { waitUntil: "load" },
      );
      return { status: 200 };
    },
  });

  assert.deepEqual(observation.failures, []);
  assert.deepEqual(observation.request_gate_aborts, [
    {
      kind: "request_gate_abort",
      url: "https://cdn.onesignal.com/sdks/OneSignalSDK.js",
      resource_type: "script",
      error: "net::ERR_BLOCKED_BY_CLIENT.Inspector",
      decision: "unsupported_public_origin_resource_type",
      abort_reason: "blockedbyclient",
    },
  ]);
  assert.equal(gate.snapshot().public_requests, 0);
  assert.equal(gate.snapshot().unsupported_requests_blocked, 1);
  assert.deepEqual(gate.snapshot().grants, []);
});
