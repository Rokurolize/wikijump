// Long-lived theme-lab session.
//
// Keeps Chromium and the target pages alive so an agent can iterate on CSS
// without paying process/browser/navigation startup per edit. Communicates over
// a Unix socket with newline-delimited JSON.

import fs from "node:fs/promises";
import net from "node:net";

import {
  assertSocketPath,
  prepareSocketForStart,
  removePidFile,
  writePidFile,
} from "./daemon.mjs";
import {errorPayload, fail} from "./errors.mjs";
import {
  applyPreview,
  applyStylesheet,
  capturePristineContent,
  clearStylesheet,
  closePage,
  collectElements,
  collectElementsBatch,
  collectSelectorMatches,
  collectSnapshot,
  collectStyleSheetRules,
  collectViewportOverflow,
  launchBrowser,
  navigate,
  openPage,
  restorePristineContent,
  screenshot,
  setViewport,
} from "./browser-lab.mjs";
import {
  collectSelectorTexts,
  diffComputedStyles,
  rankSelectorDiffs,
  selectorDiagnosis,
  summarizeComputedStyleDiffs,
} from "./css-probe.mjs";
import {startReferenceReplay} from "./reference-replay.mjs";
import {runTortureCorpus} from "./torture-corpus.mjs";
import {buildVerdict, expandVerdict} from "./verdict.mjs";

const DEFAULT_PROPERTIES = [
  "display",
  "visibility",
  "position",
  "width",
  "height",
  "margin-top",
  "margin-left",
  "padding-top",
  "padding-left",
  "color",
  "background-color",
  "font-family",
  "font-size",
  "line-height",
  "font-weight",
  "text-transform",
  "border-top-width",
  "z-index",
];

const DEFAULT_VIEWPORTS = [
  {id: "desktop", width: 1440, height: 1000},
  {id: "tablet", width: 768, height: 1024},
  {id: "mobile", width: 390, height: 844},
];

export function createSession({
  chromium,
  browser,
  previewClient = null,
  referenceAssets = null,
  pages = {candidate: null, reference: null},
}) {
  const session = {
    chromium,
    browser,
    previewClient,
    referenceAssets,
    replays: new Map(),
    pages,
    cssId: "theme-lab-live-css",
    pristine: null,
    referenceMeasurementCache: null,
    async open({target = "candidate", url, viewport = null}) {
      let page = pages[target];
      if (!page) {
        page = await openPage(browser, {url, viewport});
        pages[target] = page;
      } else if (url && page.url() !== url) {
        await navigate(page, url);
      }
      if (target === "candidate") {
        session.pristine = await capturePristineContent(page);
      }
      return {target, url: page.url()};
    },
    async restoreCandidate() {
      if (!pages.candidate || !session.pristine) return {restored: false};
      const restored = await restorePristineContent(pages.candidate, session.pristine);
      return {restored};
    },
    // Acquire (cache-first) a foreign reference and point the reference tab at
    // its loopback replay. `offline: true` forbids any network access.
    async loadReference({url, offline = false}) {
      if (!session.referenceAssets) fail("no_reference_cache", "reference cache is not configured");
      const acquire = await session.referenceAssets.acquire(url, {offline});
      let replay = session.replays.get(url);
      if (!replay) {
        replay = await startReferenceReplay({cache: session.referenceAssets, rootUrl: url});
        session.replays.set(url, replay);
      }
      const navigated = await session.open({target: "reference", url: replay.entryUrl});
      return {
        root_url: url,
        entry_url: replay.entryUrl,
        entry: acquire.entry,
        asset_count: acquire.asset_count,
        external_requests: acquire.external_requests,
        cache_hits: acquire.cache_hits,
        offline,
        url: navigated.url,
      };
    },
    async setCss({css, tortureSiteId = null, tortureSyntaxOnly = false}) {
      if (!pages.candidate) fail("no_candidate_page", "no candidate page is open; run open --url <candidate>");
      await applyStylesheet(pages.candidate, css, session.cssId);
      const result = {bytes: Buffer.byteLength(css, "utf8")};
      if (Number.isInteger(tortureSiteId)) {
        result.torture = await session.torture({
          siteId: tortureSiteId,
          syntaxOnly: tortureSyntaxOnly,
        });
      }
      return result;
    },
    async clearCss() {
      if (pages.candidate) await clearStylesheet(pages.candidate, session.cssId);
      return {cleared: true};
    },
    async preview({siteId, title, wikitext, syntaxOnly = false, containerSelector = "#page-content"}) {
      if (!session.previewClient) fail("no_preview_client", "no Deepwell preview client; start serve with DEEPWELL_RPC_TOKEN");
      if (!pages.candidate) fail("no_candidate_page", "no candidate page is open; run open --url <candidate>");
      const started = performance.now();
      const rendered = await session.previewClient.preview({siteId, title, wikitext, syntaxOnly});
      const rpcMs = performance.now() - started;
      const applied = await applyPreview(pages.candidate, {
        body: rendered.body,
        styles: rendered.styles,
        containerSelector,
      });
      return {
        rpc_ms: Number(rpcMs.toFixed(1)),
        total_ms: Number((performance.now() - started).toFixed(1)),
        body_bytes: applied.body_bytes,
        styles: applied.styles,
        legacy_actions: rendered.legacy_actions.length,
      };
    },
    async torture({siteId, title = "Theme Lab Torture", syntaxOnly = false}) {
      if (!session.previewClient) fail("no_preview_client", "no Deepwell preview client; start serve with DEEPWELL_RPC_TOKEN");
      if (!pages.candidate) fail("no_candidate_page", "no candidate page is open; run open --url <candidate>");
      return runTortureCorpus({
        page: pages.candidate,
        previewClient: session.previewClient,
        siteId,
        title,
        syntaxOnly,
      });
    },
    async setViewport({target = "candidate", width, height}) {
      const page = pages[target];
      if (!page) fail(`no_${target}_page`, `no ${target} page is open`);
      await setViewport(page, {width, height});
      return {target, width, height};
    },
    async snapshot({target = "candidate", selectors = null, properties = DEFAULT_PROPERTIES, max = 25}) {
      const page = pages[target];
      if (!page) fail(`no_${target}_page`, `no ${target} page is open`);
      const rules = await collectStyleSheetRules(page);
      const list = selectors?.length ? selectors : collectSelectorTexts(rules).slice(0, 400);
      const {counts, errors} = await collectSelectorMatches(page, list);
      const elements = {};
      for (const selector of list.slice(0, max)) {
        elements[selector] = await collectElements(page, {selector, properties, max: 5});
      }
      return {target, url: page.url(), rules, selectors: list, selector_counts: counts, selector_errors: errors, elements};
    },
    async diff({referenceUrl = null, selectors = null, properties = DEFAULT_PROPERTIES, max = 60}) {
      if (!pages.candidate) fail("no_candidate_page", "no candidate page is open; run open --url <candidate>");
      if (referenceUrl) {
        await session.open({target: "reference", url: referenceUrl});
      }
      if (!pages.reference) fail("no_reference_page", "no reference page is open; pass --reference-url or fetch a reference snapshot");
      // Compare at one viewport so geometry deltas are meaningful.
      const compareViewport = {width: 1440, height: 1000};
      await setViewport(pages.reference, compareViewport);
      await setViewport(pages.candidate, compareViewport);
      const currentReferenceUrl = pages.reference.url();
      const selectorsKey = selectors?.length ? JSON.stringify(selectors) : null;
      const propertiesKey = properties.join(",");
      const cache = session.referenceMeasurementCache;
      if (
        !cache ||
        cache.url !== currentReferenceUrl ||
        cache.selectorsKey !== selectorsKey ||
        cache.propertiesKey !== propertiesKey
      ) {
        const rules = await collectStyleSheetRules(pages.reference);
        const list = selectors?.length ? selectors : collectSelectorTexts(rules).slice(0, 400);
        const counts = (await collectSelectorMatches(pages.reference, list)).counts;
        session.referenceMeasurementCache = {
          url: currentReferenceUrl,
          selectorsKey,
          propertiesKey,
          rules,
          list,
          counts,
          elements: new Map(),
        };
      }
      const referenceCache = session.referenceMeasurementCache;
      const list = referenceCache.list;
      const referenceMatches = referenceCache.counts;
      const candidateMatches = (await collectSelectorMatches(pages.candidate, list)).counts;
      const selectorRows = rankSelectorDiffs({
        referenceRules: referenceCache.rules,
        referenceCounts: referenceMatches,
        candidateCounts: candidateMatches,
      });

      // Probe computed styles for selectors that are broken, collapsed, or that
      // match a single element on both sides. The last group is what catches
      // "this rule still matches, but the element is 32px wider" without the
      // agent having to ask for it.
      const probeSelectors = [
        ...selectorRows.filter((row) => row.status === "missing").map((row) => row.selector),
        ...selectorRows.filter((row) => row.status === "count_changed").map((row) => row.selector),
        ...selectorRows
          .filter((row) => row.status === "match" && row.reference === 1)
          .map((row) => row.selector),
      ].slice(0, max);
      const uncached = probeSelectors.filter((selector) => !referenceCache.elements.has(selector));
      if (uncached.length > 0) {
        const collected = await collectElementsBatch(pages.reference, {
          selectors: uncached,
          properties,
          max: 5,
        });
        for (const [selector, value] of Object.entries(collected)) {
          referenceCache.elements.set(selector, value);
        }
      }
      const referenceElements = Object.fromEntries(
        probeSelectors.map((selector) => [selector, referenceCache.elements.get(selector)]),
      );
      const candidateElements = await collectElementsBatch(pages.candidate, {
        selectors: probeSelectors,
        properties,
        max: 5,
      });
      const computedRows = diffComputedStyles({
        reference: Object.fromEntries(
          Object.entries(referenceElements).map(([key, value]) => [key, value.elements?.[0]]),
        ),
        candidate: Object.fromEntries(
          Object.entries(candidateElements).map(([key, value]) => [key, value.elements?.[0]]),
        ),
        properties,
      });
      return {
        reference_url: pages.reference.url(),
        candidate_url: pages.candidate.url(),
        reference_selector_count: selectorRows.length,
        selectors: selectorRows,
        diagnosis: selectorDiagnosis(selectorRows),
        computed_styles: summarizeComputedStyleDiffs(computedRows),
      };
    },
    async check({
      css = null,
      wikitext = null,
      title = "Preview",
      syntaxOnly = false,
      referenceUrl = null,
      referenceOffline = false,
      selectors = null,
      siteId = null,
      torture = false,
      viewports = true,
      properties = DEFAULT_PROPERTIES,
      max = 60,
      verbose = false,
    }) {
      const candidate = pages.candidate;
      if (!candidate) fail("no_candidate_page", "no candidate page is open");
      if ((wikitext !== null && wikitext !== undefined) || torture) {
        if (!Number.isSafeInteger(siteId)) fail("invalid_site_id", "siteId is required for preview/torture");
      }
      const timing = {};
      const started = performance.now();
      const full = {};

      // Undo any destructive operation (torture fixture, previous preview)
      // before measuring, so the reference comparison sees the real page.
      await session.restoreCandidate();

      if (wikitext !== null && wikitext !== undefined) {
        const step = performance.now();
        full.preview = await session.preview({siteId, title, wikitext, syntaxOnly});
        timing.preview_ms = Number((performance.now() - step).toFixed(1));
      }
      if (typeof css === "string") {
        const step = performance.now();
        await applyStylesheet(candidate, css, session.cssId);
        timing.css_ms = Number((performance.now() - step).toFixed(1));
      }

      let reference = null;
      if (referenceUrl) {
        const step = performance.now();
        const loaded = await session.loadReference({url: referenceUrl, offline: referenceOffline});
        reference = await session.diff({referenceUrl: loaded.entry_url, selectors, properties, max});
        timing.reference_ms = Number((performance.now() - step).toFixed(1));
        timing.reference_acquire_ms = Number((performance.now() - step).toFixed(1));
        full.reference_load = loaded;
        full.selector_rows = reference.selectors;
        full.computed_style_rows = reference.computed_styles?.top ?? [];
      }

      let viewportOverflow = null;
      if (viewports) {
        const step = performance.now();
        viewportOverflow = await collectViewportOverflow(candidate, DEFAULT_VIEWPORTS);
        timing.viewports_ms = Number((performance.now() - step).toFixed(1));
        full.viewports = viewportOverflow;
      }

      let tortureResult = null;
      if (torture) {
        const step = performance.now();
        tortureResult = await session.torture({siteId, syntaxOnly});
        timing.torture_ms = Number((performance.now() - step).toFixed(1));
        full.torture = tortureResult;
      }

      timing.total = Number((performance.now() - started).toFixed(1));
      const verdict = buildVerdict({reference, torture: tortureResult, viewports: viewportOverflow, timing});
      return verbose ? expandVerdict(verdict, full) : verdict;
    },
    async screenshot({target = "candidate", path: outputPath, fullPage = true, viewport = null}) {
      const page = pages[target];
      if (!page) fail(`no_${target}_page`, `no ${target} page is open`);
      return screenshot(page, {path: outputPath, fullPage, viewport});
    },
    async status() {
      return {
        pages: Object.fromEntries(
          Object.entries(pages)
            .filter(([, page]) => Boolean(page))
            .map(([name, page]) => [name, page.url()]),
        ),
      };
    },
    async close() {
      for (const replay of session.replays.values()) {
        await replay.close().catch(() => {});
      }
      session.replays.clear();
      for (const page of Object.values(pages)) {
        if (page) await closePage(page);
      }
      await browser.close().catch(() => {});
    },
  };
  return session;
}

const OPERATIONS = {
  ping: () => ({ok: true}),
  open: (session, request) => session.open(request),
  set_css: (session, request) => session.setCss(request),
  clear_css: (session) => session.clearCss(),
  preview: (session, request) => session.preview(request),
  torture: (session, request) => session.torture(request),
  check: (session, request) => session.check(request),
  reference_load: (session, request) => session.loadReference(request),
  viewport: (session, request) => session.setViewport(request),
  snapshot: (session, request) => session.snapshot(request),
  diff: (session, request) => session.diff(request),
  screenshot: (session, request) => session.screenshot(request),
  status: (session) => session.status(),
};

export async function startSessionServer({
  socketPath,
  chromium,
  cdpEndpoint = null,
  executablePath = null,
  headless = true,
  candidateUrl = null,
  previewClient = null,
  referenceAssets = null,
}) {
  assertSocketPath(socketPath);
  await prepareSocketForStart(socketPath);

  let browser = null;
  let session = null;
  let server = null;
  try {
    browser = await launchBrowser({chromium, cdpEndpoint, executablePath, headless});
    session = createSession({chromium, browser, previewClient, referenceAssets});
    if (candidateUrl) await session.open({target: "candidate", url: candidateUrl});
    server = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          handleLine(session, line)
            .then((response) => socket.write(`${JSON.stringify(response)}\n`))
            .catch((error) => socket.write(`${JSON.stringify(errorPayload(error))}\n`));
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
  } catch (error) {
    await session?.close().catch(() => {});
    if (!session) await browser?.close().catch(() => {});
    await fs.rm(socketPath, {force: true});
    throw error;
  }

  await writePidFile(socketPath);
  return {
    session,
    server,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await session.close();
      await fs.rm(socketPath, {force: true});
      await removePidFile(socketPath);
    },
  };
}

async function handleLine(session, line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    return {ok: false, error: {code: "invalid_json", message: `invalid JSON request: ${error.message}`}};
  }
  const operation = OPERATIONS[request.op];
  if (!operation) return {ok: false, error: {code: "unknown_operation", message: `unknown operation: ${String(request.op)}`}};
  const result = await operation(session, request);
  return {ok: true, result};
}

export {DEFAULT_PROPERTIES, DEFAULT_VIEWPORTS};
