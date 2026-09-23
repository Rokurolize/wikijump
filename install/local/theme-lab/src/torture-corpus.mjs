// Standardized theme-regression corpus for fast agent CSS iteration.
//
// A run renders the same Wikidot fixture once, captures the native SCP-JP
// presentation with the injected theme CSS temporarily disabled, then restores
// the injected CSS and captures the candidate. The verdict is therefore about
// what the current edit changed, not unrelated page-content differences.

import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {applyStylesheet, clearStylesheet, setViewport} from "./browser-lab.mjs";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_TORTURE_FIXTURE = path.resolve(
  MODULE_DIR,
  "../fixtures/theme-torture.wikidot.txt",
);

export const TORTURE_VIEWPORTS = [
  {id: "desktop", width: 1440, height: 1000},
  {id: "laptop", width: 1024, height: 900},
  {id: "tablet", width: 768, height: 1024},
  {id: "mobile", width: 390, height: 844},
];

export const TORTURE_COMPONENTS = [
  {id: "heading", selector: ".tl-heading", expected: ".tl-heading h1, .tl-heading h2"},
  {id: "list", selector: ".tl-list", expected: ".tl-list ul, .tl-list ol"},
  {id: "blockquote", selector: ".tl-quote", expected: ".tl-quote blockquote"},
  {id: "table", selector: ".tl-table", expected: ".tl-table table.wiki-content-table"},
  {id: "code", selector: ".tl-code", expected: ".tl-code .code"},
  {id: "collapsible", selector: ".tl-collapsible", expected: ".tl-collapsible .collapsible-block"},
  {id: "tabview", selector: ".tl-tabview", expected: ".tl-tabview .yui-navset"},
  {id: "footnote", selector: ".tl-footnote", expected: ".tl-footnote .footnoteref"},
  {id: "math", selector: ".tl-math", expected: ".tl-math .math-equation"},
  {id: "toc", selector: ".tl-toc", expected: ".tl-toc #toc"},
  {id: "rating", selector: ".tl-rate", expected: ".tl-rate .page-rate-widget-box"},
];

const STYLE_PROPERTIES = [
  "display",
  "visibility",
  "position",
  "width",
  "height",
  "max-width",
  "margin-left",
  "margin-right",
  "padding-left",
  "padding-right",
  "font-size",
  "line-height",
  "overflow-x",
  "white-space",
];

export async function loadTortureFixture(fixturePath = DEFAULT_TORTURE_FIXTURE) {
  return fs.readFile(fixturePath, "utf8");
}

export async function readInjectedCss(page, styleId = "theme-lab-live-css") {
  return page.evaluate((id) => document.getElementById(id)?.textContent ?? null, styleId);
}

export async function captureTortureState(
  page,
  {viewports = TORTURE_VIEWPORTS, components = TORTURE_COMPONENTS} = {},
) {
  const result = {};
  for (const viewport of viewports) {
    await setViewport(page, viewport);
    result[viewport.id] = await page.evaluate(
      ({components: componentList, styleProperties, viewport: viewportSpec}) => {
        const stabilityStyle = document.createElement("style");
        stabilityStyle.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }";
        document.head.appendChild(stabilityStyle);
        void getComputedStyle(document.body).width;
        const px = (value) => {
          const parsed = Number.parseFloat(value);
          return Number.isFinite(parsed) ? parsed : null;
        };
        const collect = (entry) => {
          const wrapper = document.querySelector(entry.selector);
          const expected = document.querySelector(entry.expected);
          const element = expected ?? wrapper;
          if (!element) {
            return {
              id: entry.id,
              wrapper_present: Boolean(wrapper),
              expected_present: false,
              expected_selector: entry.expected,
              visible: false,
              rect: null,
              style: null,
              viewport_overflow_px: null,
              own_overflow_px: null,
            };
          }
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const values = Object.fromEntries(
            styleProperties.map((property) => [property, style.getPropertyValue(property)]),
          );
          const visible =
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.visibility !== "collapse";
          const leftOverflow = Math.max(0, -rect.left);
          const rightOverflow = Math.max(0, rect.right - viewportSpec.width);
          return {
            id: entry.id,
            wrapper_present: Boolean(wrapper),
            expected_present: Boolean(expected),
            expected_selector: entry.expected,
            visible,
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              left: rect.left,
              right: rect.right,
            },
            style: values,
            viewport_overflow_px: Math.max(leftOverflow, rightOverflow),
            own_overflow_px: Math.max(0, element.scrollWidth - element.clientWidth),
            own_overflow_scrollable: ["auto", "scroll"].includes(style.overflowX),
            font_size_px: px(values["font-size"]),
            line_height_px: px(values["line-height"]),
          };
        };
        const root = document.documentElement;
        const content = document.querySelector("#page-content");
        const overflowSources = [...document.body.querySelectorAll("*")]
          .map((element) => {
            const rect = element.getBoundingClientRect();
            if (rect.right <= viewportSpec.width + 2) return null;
            let ancestor = element.parentElement;
            while (ancestor && ancestor !== document.body) {
              const ancestorStyle = getComputedStyle(ancestor);
              const ancestorRect = ancestor.getBoundingClientRect();
              if (
                ["auto", "scroll", "hidden", "clip"].includes(ancestorStyle.overflowX) &&
                ancestorRect.right <= viewportSpec.width + 2 &&
                rect.right > ancestorRect.right + 2
              ) return null;
              ancestor = ancestor.parentElement;
            }
            return {
              selector: element.id ? `#${CSS.escape(element.id)}` :
                `${element.tagName.toLowerCase()}${[...element.classList].slice(0, 3).map((part) => `.${CSS.escape(part)}`).join("")}`,
              right: Math.round(rect.right * 10) / 10,
              overflow_px: Math.round((rect.right - viewportSpec.width) * 10) / 10,
            };
          })
          .filter(Boolean)
          .sort((a, b) => b.overflow_px - a.overflow_px)
          .slice(0, 5);
        const measurement = {
          viewport: viewportSpec,
          page: {
            document_overflow_px: Math.max(0, root.scrollWidth - root.clientWidth),
            content_overflow_px: content
              ? Math.max(0, content.scrollWidth - content.clientWidth)
              : null,
            overflow_sources: overflowSources,
          },
          components: Object.fromEntries(componentList.map((entry) => [entry.id, collect(entry)])),
        };
        stabilityStyle.remove();
        return measurement;
      },
      {components, styleProperties: STYLE_PROPERTIES, viewport},
    );
  }
  return result;
}

function numericChange(reference, candidate) {
  if (!Number.isFinite(reference) || !Number.isFinite(candidate)) return null;
  const delta = candidate - reference;
  const relative = Math.abs(reference) > 0.001 ? delta / reference : null;
  return {delta, relative};
}

export function diffTortureStates(
  baseline,
  candidate,
  {overflowTolerancePx = 2, componentOverflowTolerancePx = 5, geometryChangeThreshold = 0.15} = {},
) {
  const issues = [];
  const changes = [];

  for (const [viewportId, candidateViewport] of Object.entries(candidate)) {
    const baselineViewport = baseline[viewportId];
    if (!baselineViewport) continue;

    const beforeDocumentOverflow = baselineViewport.page.document_overflow_px ?? 0;
    const afterDocumentOverflow = candidateViewport.page.document_overflow_px ?? 0;
    if (
      afterDocumentOverflow > overflowTolerancePx &&
      afterDocumentOverflow > beforeDocumentOverflow + overflowTolerancePx
    ) {
      issues.push({
        severity: "error",
        viewport: viewportId,
        component: "page",
        kind: "new_horizontal_overflow",
        before_px: beforeDocumentOverflow,
        after_px: afterDocumentOverflow,
        overflow_sources: candidateViewport.page.overflow_sources ?? [],
      });
    }

    for (const [componentId, after] of Object.entries(candidateViewport.components)) {
      const before = baselineViewport.components[componentId];
      if (!before) continue;

      if (!before.expected_present) {
        issues.push({
          severity: "error",
          viewport: viewportId,
          component: componentId,
          kind: "baseline_structure_missing",
          selector: before.expected_selector,
        });
        continue;
      }
      if (before.expected_present && !after.expected_present) {
        issues.push({
          severity: "error",
          viewport: viewportId,
          component: componentId,
          kind: "expected_structure_missing",
          selector: after.expected_selector,
        });
      }
      if (before.visible && !after.visible) {
        issues.push({
          severity: "error",
          viewport: viewportId,
          component: componentId,
          kind: "became_invisible",
        });
      }
      if (
        (after.viewport_overflow_px ?? 0) > overflowTolerancePx &&
        (after.viewport_overflow_px ?? 0) >
          (before.viewport_overflow_px ?? 0) + overflowTolerancePx
      ) {
        issues.push({
          severity: "error",
          viewport: viewportId,
          component: componentId,
          kind: "new_viewport_overflow",
          before_px: before.viewport_overflow_px ?? 0,
          after_px: after.viewport_overflow_px ?? 0,
          element_rect: after.rect,
          computed: after.style,
        });
      }
      if (
        !after.own_overflow_scrollable &&
        (after.own_overflow_px ?? 0) > componentOverflowTolerancePx &&
        (after.own_overflow_px ?? 0) > (before.own_overflow_px ?? 0) + componentOverflowTolerancePx
      ) {
        issues.push({
          severity: "error",
          viewport: viewportId,
          component: componentId,
          kind: "new_component_overflow",
          before_px: before.own_overflow_px ?? 0,
          after_px: after.own_overflow_px ?? 0,
        });
      }

      for (const key of ["width", "height"]) {
        const change = numericChange(before.rect?.[key], after.rect?.[key]);
        if (!change || change.relative === null) continue;
        if (Math.abs(change.relative) >= geometryChangeThreshold) {
          changes.push({
            viewport: viewportId,
            component: componentId,
            property: `rect.${key}`,
            before: before.rect[key],
            after: after.rect[key],
            delta: change.delta,
            relative: change.relative,
          });
        }
      }

      for (const property of ["font-size", "line-height"]) {
        const beforeValue =
          property === "font-size" ? before.font_size_px : before.line_height_px;
        const afterValue =
          property === "font-size" ? after.font_size_px : after.line_height_px;
        const change = numericChange(beforeValue, afterValue);
        if (!change || change.relative === null) continue;
        if (Math.abs(change.relative) >= geometryChangeThreshold) {
          changes.push({
            viewport: viewportId,
            component: componentId,
            property,
            before: beforeValue,
            after: afterValue,
            delta: change.delta,
            relative: change.relative,
          });
        }
      }
    }
  }

  changes.sort((left, right) => Math.abs(right.relative ?? 0) - Math.abs(left.relative ?? 0));
  return {
    verdict: issues.length === 0 ? "pass" : "fail",
    issue_count: issues.length,
    changed_component_count: new Set(changes.map((row) => row.component)).size,
    issues,
    changes,
  };
}

export async function runTortureCorpus({
  page,
  previewClient,
  siteId,
  title = "Theme Lab Torture",
  fixturePath = DEFAULT_TORTURE_FIXTURE,
  styleId = "theme-lab-live-css",
  syntaxOnly = false,
  viewports = TORTURE_VIEWPORTS,
} = {}) {
  if (!page) throw new Error("candidate page is required");
  if (!previewClient) throw new Error("Deepwell preview client is required");
  if (!Number.isInteger(siteId)) throw new Error("siteId must be an integer");

  const started = performance.now();
  const wikitext = await loadTortureFixture(fixturePath);
  const rendered = await previewClient.preview({siteId, title, wikitext, syntaxOnly});
  const rpcDone = performance.now();

  await page.evaluate(
    ({body, styles}) => {
      const container = document.querySelector("#page-content");
      if (!container) throw new Error("preview container not found: #page-content");
      container.innerHTML = body;
      let previewStyle = document.getElementById("theme-lab-preview-styles");
      if (!previewStyle) {
        previewStyle = document.createElement("style");
        previewStyle.id = "theme-lab-preview-styles";
        document.head.appendChild(previewStyle);
      }
      previewStyle.textContent = styles.join("\n");
    },
    {body: rendered.body, styles: rendered.styles},
  );

  const injectedCss = await readInjectedCss(page, styleId);
  await clearStylesheet(page, styleId);
  const baseline = await captureTortureState(page, {viewports});
  const baselineDone = performance.now();

  if (injectedCss !== null) await applyStylesheet(page, injectedCss, styleId);
  const candidate = await captureTortureState(page, {viewports});
  const candidateDone = performance.now();

  return {
    timing_ms: {
      preview_rpc: Number((rpcDone - started).toFixed(1)),
      baseline_capture: Number((baselineDone - rpcDone).toFixed(1)),
      candidate_capture: Number((candidateDone - baselineDone).toFixed(1)),
      total: Number((candidateDone - started).toFixed(1)),
    },
    fixture: {
      path: fixturePath,
      bytes: Buffer.byteLength(wikitext, "utf8"),
      syntax_only: syntaxOnly,
      rendered_body_bytes: Buffer.byteLength(rendered.body, "utf8"),
    },
    viewports: viewports.map((viewport) => viewport.id),
    components: TORTURE_COMPONENTS.map((component) => component.id),
    ...diffTortureStates(baseline, candidate),
  };
}
