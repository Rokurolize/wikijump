#!/usr/bin/env node

// Measures edit -> verdict latency for the theme-lab loop.
//
// Unlike `theme-lab serve`, this runs the whole loop in one process so it can
// be run non-interactively and produce machine-readable timings. It still uses
// the identical browser primitives.

import fs from "node:fs/promises";

import {
  applyPreview,
  applyStylesheet,
  clearStylesheet,
  closePage,
  collectElements,
  collectSelectorMatches,
  collectStyleSheetRules,
  launchBrowser,
  loadChromium,
  openPage,
  screenshot,
  setViewport,
} from "../src/browser-lab.mjs";
import {createDeepwellPreviewClient} from "../src/deepwell-preview.mjs";
import {
  collectSelectorTexts,
  diffComputedStyles,
  rankSelectorDiffs,
} from "../src/css-probe.mjs";
import {DEFAULT_PROPERTIES} from "../src/session-server.mjs";

const SAMPLE_SELECTORS = [
  "#page-content",
  "#page-title",
  ".page-rate-widget-box",
  "#header",
  "#side-bar",
  "blockquote",
  ".scp-image-block",
  "table.wiki-content-table",
];

const WIKITEXT_VARIANTS = [
  "+ Preview Heading\n\nA **bold** line.",
  "+ Preview Heading\n\nA **bold** line with a [[span]].",
  "||~ Head ||~ Value ||\n|| preview || 1 ||",
  "+ Preview Heading\n\n[[div class=\"preview-marker\"]]\nbody\n[[/div]]",
];

const CSS_VARIANTS = [
  "#page-content{font-size:12.8px}",
  "#page-content{font-size:13.44px}",
  "#page-content{font-size:12.8px} #page-title{color:rgb(187,1,17)}",
  "#page-content{line-height:1.2}",
  "blockquote{border-left:4px solid red}",
];

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

async function timeAsync(fn, samples = 1) {
  const timings = [];
  let last;
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    last = await fn(index);
    timings.push(performance.now() - started);
  }
  return {medianMs: median(timings), samples: timings.map((value) => Number(value.toFixed(1))), last};
}

async function main() {
  const referenceUrl = process.argv[2] ?? "https://scp-wiki.wikijump.localhost/scp-9506";
  const candidateUrl = process.argv[3] ?? referenceUrl;
  const outputDir = process.argv[4] ?? "/tmp/opencode/theme-lab-bench";
  await fs.mkdir(outputDir, {recursive: true});

  const chromium = loadChromium();
  const browser = await launchBrowser({chromium, headless: true});
  const report = {reference_url: referenceUrl, candidate_url: candidateUrl, metrics: {}};
  try {
    const page = await openPage(browser, {url: candidateUrl, viewport: {width: 1440, height: 1000}});
    try {
      // Warm the page and the style engine.
      await applyStylesheet(page, CSS_VARIANTS[0]);
      await collectSelectorMatches(page, SAMPLE_SELECTORS);
      await collectElements(page, {selector: "#page-content", properties: DEFAULT_PROPERTIES, max: 1});

      const editToProbe = await timeAsync(async (index) => {
        await applyStylesheet(page, CSS_VARIANTS[index % CSS_VARIANTS.length]);
        const counts = await collectSelectorMatches(page, SAMPLE_SELECTORS);
        const element = await collectElements(page, {selector: "#page-content", properties: DEFAULT_PROPERTIES, max: 1});
        return {counts: counts.counts, font: element.elements?.[0]?.style?.["font-size"] ?? null};
      }, 10);
      report.metrics.css_edit_to_selector_and_style_probe = {
        median_ms: Number(editToProbe.medianMs.toFixed(1)),
        samples: editToProbe.samples,
      };

      await applyStylesheet(page, "#page-content{font-size:13.44px;width:900px} blockquote{border-left:0}");
      const candidateDiagnostics = await collectElements(page, {
        selector: "#page-content",
        properties: DEFAULT_PROPERTIES,
        max: 1,
      });
      await clearStylesheet(page);
      const referenceDiagnostics = await collectElements(page, {
        selector: "#page-content",
        properties: DEFAULT_PROPERTIES,
        max: 1,
      });
      const styleDiff = diffComputedStyles({
        reference: {"#page-content": referenceDiagnostics.elements[0]},
        candidate: {"#page-content": candidateDiagnostics.elements[0]},
        properties: DEFAULT_PROPERTIES,
      });
      report.metrics.computed_style_diff = {
        rows: styleDiff.length,
        example: styleDiff.slice(0, 6),
      };

      const siteId = Number.parseInt(process.env.THEME_LAB_SITE_ID ?? "", 10);
      if (process.env.DEEPWELL_RPC_TOKEN && Number.isSafeInteger(siteId)) {
        const client = createDeepwellPreviewClient({});
        const previewTiming = await timeAsync(async (index) => {
          const rendered = await client.preview({
            siteId,
            title: "Preview",
            wikitext: WIKITEXT_VARIANTS[index % WIKITEXT_VARIANTS.length],
            syntaxOnly: true,
          });
          await applyPreview(page, {body: rendered.body, styles: rendered.styles});
          return rendered.body.length;
        }, 8);
        report.metrics.wikitext_edit_to_preview_dom = {
          median_ms: Number(previewTiming.medianMs.toFixed(1)),
          samples: previewTiming.samples,
        };
      }

      const selectorDiff = await timeAsync(async () => {
        const rules = await collectStyleSheetRules(page);
        const selectors = collectSelectorTexts(rules).slice(0, 300);
        const referenceCounts = (await collectSelectorMatches(page, selectors)).counts;
        const candidateCounts = (await collectSelectorMatches(page, selectors)).counts;
        return rankSelectorDiffs({referenceRules: rules, referenceCounts, candidateCounts}).length;
      }, 3);
      report.metrics.selector_diagnostic = {
        median_ms: Number(selectorDiff.medianMs.toFixed(1)),
        selectors: selectorDiff.last,
      };

      const viewports = [
        {id: "desktop", width: 1920, height: 1080},
        {id: "laptop", width: 1366, height: 900},
        {id: "tablet", width: 768, height: 1024},
        {id: "mobile", width: 390, height: 844},
      ];
      const multiViewport = await timeAsync(async () => {
        for (const viewport of viewports) {
          await setViewport(page, viewport);
          await collectElements(page, {selector: "#page-content", properties: DEFAULT_PROPERTIES, max: 1});
        }
        return viewports.length;
      }, 3);
      report.metrics.multi_viewport_layout = {
        viewports: viewports.length,
        median_ms: Number(multiViewport.medianMs.toFixed(1)),
      };

      const screenshotTiming = await timeAsync(async () => {
        await setViewport(page, {width: 1440, height: 1000});
        await screenshot(page, {path: `${outputDir}/desktop.png`, fullPage: false});
        return `${outputDir}/desktop.png`;
      }, 5);
      report.metrics.desktop_screenshot = {
        median_ms: Number(screenshotTiming.medianMs.toFixed(1)),
        samples: screenshotTiming.samples,
      };

      await screenshot(page, {path: `${outputDir}/full-page.png`, fullPage: true});
    } finally {
      await closePage(page);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  await fs.writeFile(`${outputDir}/bench.json`, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
