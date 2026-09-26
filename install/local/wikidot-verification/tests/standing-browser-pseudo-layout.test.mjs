import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCssBoxFallback,
  capturePseudoLayouts,
  evaluatePseudoLayout,
} from "../src/standing-browser-pseudo-layout.mjs";

function strings() {
  return [
    "",
    "before",
    "after",
    "hidden",
    "NFSI",
    "National Fog Safety Initiative",
  ];
}

function styles() {
  const values = [];
  values[6] = 3;
  return values;
}

function snapshot() {
  return {
    strings: strings(),
    documents: [
      {
        nodes: {
          parentIndex: [-1, 0, 1, 2, 2, 3, 3],
          backendNodeId: [1, 2, 3, 4, 5, 6, 7],
          pseudoType: { index: [4, 5, 6], value: [1, 1, 2] },
        },
        layout: {
          nodeIndex: [1, 2, 3, 4, 5, 6],
          bounds: [
            [0, 0, 200, 60],
            [10, 0, 100, 32],
            [40, 0, 100, 40],
            [10, 0, 20, 30],
            [40, 0, 50, 20],
            [40, 20, 100, 20],
          ],
          styles: [[], styles(), [], [], [], []],
          text: [0, 0, 0, 0, 4, 5],
        },
      },
    ],
  };
}

function ambiguousSnapshot() {
  return {
    strings: strings(),
    documents: [
      {
        nodes: {
          parentIndex: [-1, 0, 1, 2, 2, 2],
          backendNodeId: [1, 2, 3, 4, 5, 6],
          pseudoType: { index: [3, 4], value: [1, 1] },
        },
        layout: {
          nodeIndex: [1, 2, 3, 4, 5],
          bounds: [
            [0, 0, 200, 60],
            [10, 0, 100, 32],
            [40, 0, 100, 40],
            [10, 0, 20, 30],
            [40, 20, 100, 20],
          ],
          styles: [[], [], [], [], []],
          text: [0, 0, 0, 0, 0],
        },
      },
    ],
  };
}

function createHarness({
  backendIdsBySelector = {},
  snapshotValue = snapshot(),
  failCapture = false,
} = {}) {
  const calls = [];
  const client = {
    async send(method, options) {
      calls.push({ method, options });
      if (method === "DOM.getDocument") {
        return { root: { nodeId: 1 } };
      }
      if (method === "DOM.querySelectorAll") {
        return { nodeIds: backendIdsBySelector[options.selector] ?? [] };
      }
      if (method === "DOM.describeNode") {
        return { node: { backendNodeId: options.nodeId } };
      }
      if (method === "DOMSnapshot.captureSnapshot") {
        if (failCapture) throw new Error("snapshot unavailable");
        return snapshotValue;
      }
      throw new Error(`unexpected CDP method ${method}`);
    },
    async detach() {
      calls.push({ method: "detach" });
    },
  };
  const page = { context: () => ({ newCDPSession: async () => client }) };
  return { page, calls };
}

const viewport = { width: 200, height: 100 };

test("pseudo-layout capture resolves selectors and retains generated text and clipping evidence", async () => {
  const { page, calls } = createHarness({
    backendIdsBySelector: { "#container": [2], "#logo": [3], "#title": [4] },
  });
  const result = await capturePseudoLayouts(
    page,
    [
      {
        id: "header_logo",
        pseudo: "::before",
        selector: "#logo",
        visibility_container_selector: "#container",
      },
      {
        id: "header_title",
        pseudo: "::before",
        selector: "#title",
        visibility_container_selector: "#container",
      },
      {
        id: "header_subtitle",
        pseudo: "::after",
        selector: "#title",
        visibility_container_selector: "#container",
      },
    ],
    viewport,
  );

  assert.equal(result.header_logo.status, "captured");
  assert.equal(result.header_title.descendant_text, "NFSI");
  assert.equal(
    result.header_subtitle.descendant_text,
    "National Fog Safety Initiative",
  );
  assert.equal(result.header_subtitle.visible_area_ratio, 0.42);

  const queriedSelectors = calls
    .filter((call) => call.method === "DOM.querySelectorAll")
    .map((call) => call.options.selector);
  assert.deepEqual([...new Set(queriedSelectors)].sort(), [
    "#container",
    "#logo",
    "#title",
  ]);
  assert.equal(
    calls.some((call) => call.method === "DOMSnapshot.captureSnapshot"),
    true,
  );
  assert.equal(calls.at(-1).method, "detach");
});

test("pseudo-layout capture fails closed on absent, missing, and ambiguous nodes", async () => {
  const absent = createHarness({
    backendIdsBySelector: { "#known": [5] },
  });
  const absentResult = await capturePseudoLayouts(
    absent.page,
    [
      { id: "no_source", pseudo: "::before", selector: "#unknown" },
      { id: "no_pseudo", pseudo: "::after", selector: "#known" },
    ],
    viewport,
  );
  assert.equal(absentResult.no_source.status, "source_not_found");
  assert.equal(absentResult.no_pseudo.status, "pseudo_not_found");

  const ambiguous = createHarness({
    backendIdsBySelector: { "#title": [3] },
    snapshotValue: ambiguousSnapshot(),
  });
  const ambiguousResult = await capturePseudoLayouts(
    ambiguous.page,
    [
      {
        id: "two_before",
        pseudo: "::before",
        selector: "#title",
        visibility_container_selector: "#container",
      },
    ],
    viewport,
  );
  assert.equal(ambiguousResult.two_before.status, "pseudo_ambiguous");
});

test("pseudo-layout capture reports unavailable probes and still detaches on CDP failure", async () => {
  const failure = createHarness({
    backendIdsBySelector: { "#title": [4] },
    failCapture: true,
  });
  const result = await capturePseudoLayouts(
    failure.page,
    [
      { id: "pseudo_probe", pseudo: "::before", selector: "#title" },
      { id: "plain_probe", selector: "#title" },
    ],
    viewport,
  );
  assert.equal(result.pseudo_probe.status, "capture_error");
  assert.equal("plain_probe" in result, false);
  assert.equal(
    failure.calls.some(
      (call) =>
        call.method === "DOMSnapshot.captureSnapshot" &&
        call.options.includeDOMRects === true,
    ),
    true,
  );
  assert.equal(failure.calls.at(-1).method, "detach");
});

test("pseudo-layout capture ignores probes that declare no pseudo element", async () => {
  let opened = 0;
  const page = {
    context: () => ({
      newCDPSession: async () => {
        opened += 1;
        throw new Error("session must not open");
      },
    }),
  };
  const result = await capturePseudoLayouts(
    page,
    [{ id: "plain", selector: "#page-content" }],
    viewport,
  );
  assert.deepEqual(result, {});
  assert.equal(opened, 0);
});

test("the pseudo-layout verdict rejects a clipped subtitle even when the node exists", () => {
  const result = evaluatePseudoLayout(
    {
      style: { content: '"National Fog Safety Initiative"' },
      pseudo_layout: {
        status: "captured",
        node_present: true,
        layout_present: true,
        painted_bounds: { x: 0, y: 20, width: 100, height: 20 },
        visible_area_ratio: 0.6,
        descendant_text: "National Fog Safety Initiative",
      },
    },
    {
      pseudo_layout: {
        require_generated_content: true,
        require_descendant_text: true,
        minimum_visible_area_ratio: 0.95,
      },
    },
  );
  assert.equal(result.status, "fail");
});

test("the CSS-box fallback retains clipping evidence for a background logo", () => {
  const layout = applyCssBoxFallback(
    {
      status: "captured",
      node_present: true,
      layout_present: false,
      painted_bounds: null,
      visible_bounds: null,
      visible_area_ratio: 0,
      clipping_ancestors: [{ bounds: { x: 0, y: 0, width: 100, height: 32 } }],
    },
    { x: 0, y: 0, width: 100, height: 32 },
    { width: "52px", height: "48px" },
  );
  assert.equal(layout.layout_kind, "css_box_fallback");
  assert.equal(layout.visible_area_ratio, 0.67);
});
