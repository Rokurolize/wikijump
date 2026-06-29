#!/usr/bin/env node

import {createRequire} from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";
import {
  buildEvidenceRecord,
  readJson,
  inventoryRows,
  rowLocalUrl,
  rowSourceUrl,
  safePathSegment,
  selectInventoryRows,
  writeEvidenceArtifacts,
} from "../src/browser-render-evidence.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;

function nextArg(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    fixtureIds: [],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    localUrlField: "local_https_url",
    screenshot: true,
    ignoreHttpsErrors: false,
    waitUntil: "domcontentloaded",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--inventory") {
      args.inventory = path.resolve(nextArg(argv, index, arg));
      index += 1;
    } else if (arg === "--shard-manifest") {
      args.shardManifest = path.resolve(nextArg(argv, index, arg));
      index += 1;
    } else if (arg === "--shard-id") {
      args.shardId = nextArg(argv, index, arg);
      index += 1;
    } else if (arg === "--fixture-id") {
      args.fixtureIds.push(nextArg(argv, index, arg));
      index += 1;
    } else if (arg === "--limit") {
      const raw = nextArg(argv, index, arg);
      if (!/^\d+$/u.test(raw) || Number.parseInt(raw, 10) <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      args.limit = Number.parseInt(raw, 10);
      index += 1;
    } else if (arg === "--output-dir") {
      args.outputDir = path.resolve(nextArg(argv, index, arg));
      index += 1;
    } else if (arg === "--local-url-field") {
      args.localUrlField = nextArg(argv, index, arg);
      index += 1;
    } else if (arg === "--browser-root") {
      args.browserRoot = path.resolve(nextArg(argv, index, arg));
      index += 1;
    } else if (arg === "--browser-executable") {
      args.browserExecutable = path.resolve(nextArg(argv, index, arg));
      index += 1;
    } else if (arg === "--cdp-endpoint") {
      args.cdpEndpoint = nextArg(argv, index, arg);
      index += 1;
    } else if (arg === "--timeout-ms") {
      const raw = nextArg(argv, index, arg);
      if (!/^\d+$/u.test(raw) || Number.parseInt(raw, 10) <= 0) {
        throw new Error("--timeout-ms must be a positive integer");
      }
      args.timeoutMs = Number.parseInt(raw, 10);
      index += 1;
    } else if (arg === "--wait-until") {
      args.waitUntil = nextArg(argv, index, arg);
      index += 1;
    } else if (arg === "--ignore-https-errors") {
      args.ignoreHttpsErrors = true;
    } else if (arg === "--no-screenshot") {
      args.screenshot = false;
    } else if (arg === "--json") {
      args.jsonOnly = true;
    } else if (arg === "--help") {
      printHelpAndExit();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.inventory) throw new Error("--inventory is required");
  if (!args.outputDir) throw new Error("--output-dir is required");
  return args;
}

function printHelpAndExit() {
  console.log(`Usage: capture-browser-rendering.mjs --inventory FILE --output-dir DIR [--shard-manifest FILE --shard-id ID] [--fixture-id ID ...] [--limit N] [--browser-root framerail] [--browser-executable /usr/bin/google-chrome | --cdp-endpoint http://127.0.0.1:9222] [--local-url-field local_https_url] [--ignore-https-errors] [--no-screenshot] [--json]

Writes validator-compatible browser rendering evidence JSON plus DOM/screenshot artifacts for selected corpus inventory rows. The output directory should live under one of the render validator evidence roots, for example:

  $OUT/validation/browser-rendering/en-0001
`);
  process.exit(0);
}

function requirePlaywright(browserRoot) {
  const root = browserRoot ?? path.resolve(process.cwd(), "framerail");
  const requireFromRoot = createRequire(path.join(root, "package.json"));
  try {
    return requireFromRoot("playwright");
  } catch (error) {
    try {
      return requireFromRoot("@playwright/test");
    } catch (fallbackError) {
      throw new Error(`could not load playwright or @playwright/test from ${root}; pass --browser-root pointing at a package with Playwright installed (${error.message}; ${fallbackError.message})`);
    }
  }
}

export async function openBrowser({chromium, cdpEndpoint, browserExecutable, ignoreHttpsErrors}) {
  if (cdpEndpoint) {
    const browser = await chromium.connectOverCDP(cdpEndpoint);
    const context = await browser.newContext({ignoreHTTPSErrors: ignoreHttpsErrors});
    return {
      browser,
      context,
      async close() {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      },
    };
  }

  const browser = await chromium.launch({
    executablePath: browserExecutable,
  });
  const context = await browser.newContext({ignoreHTTPSErrors: ignoreHttpsErrors});
  return {
    browser,
    context,
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

async function capturePage(page, url, {timeoutMs, waitUntil, screenshotPath}) {
  const consoleErrors = [];
  const failedRequests = [];
  const badResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url(),
      failure: request.failure()?.errorText ?? "unknown",
    });
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    const request = response.request();
    if (request.isNavigationRequest()) return;
    badResponses.push({
      url: response.url(),
      status,
      resourceType: request.resourceType(),
    });
  });

  let response = null;
  let navigationError = null;
  let visibleText = "";
  let html = "";
  let writtenScreenshotPath = null;
  try {
    response = await page.goto(url, {timeout: timeoutMs, waitUntil});
  } catch (error) {
    navigationError = error;
  }

  try {
    await page.waitForLoadState("domcontentloaded", {timeout: timeoutMs}).catch(() => {});
    visibleText = await page.evaluate(() => document.body?.innerText ?? "");
    html = await page.content();
  } catch (error) {
    if (!navigationError) navigationError = error;
  }

  if (screenshotPath && html) {
    try {
      await page.screenshot({path: screenshotPath, fullPage: true});
      writtenScreenshotPath = screenshotPath;
    } catch (error) {
      if (!navigationError) navigationError = error;
    }
  }

  if (!navigationError) {
    return {
      status: response?.status() ?? null,
      finalUrl: page.url(),
      visibleText,
      html,
      consoleErrors,
      failedRequests: [...failedRequests, ...badResponses],
      screenshotPath: writtenScreenshotPath,
    };
  }

  return {
    status: response?.status() ?? null,
    finalUrl: page.url(),
    visibleText,
    html,
    consoleErrors,
    failedRequests: [...failedRequests, ...badResponses],
    screenshotPath: writtenScreenshotPath,
    error: navigationError.message,
  };
}

async function run() {
  const args = parseArgs(process.argv);
  const inventory = await readJson(args.inventory);
  const rows = inventoryRows(inventory);
  const shardManifest = args.shardManifest ? await readJson(args.shardManifest) : null;
  const selectedRows = selectInventoryRows({
    rows,
    fixtureIds: args.fixtureIds,
    shardManifest,
    shardId: args.shardId,
    limit: args.limit ?? null,
  });
  if (selectedRows.length === 0) {
    throw new Error("no inventory rows selected; check --fixture-id, --shard-id, and --limit inputs");
  }

  await fs.mkdir(args.outputDir, {recursive: true});
  const {chromium} = requirePlaywright(args.browserRoot);
  const browserSession = await openBrowser({
    chromium,
    cdpEndpoint: args.cdpEndpoint,
    browserExecutable: args.browserExecutable,
    ignoreHttpsErrors: args.ignoreHttpsErrors,
  });
  const {context} = browserSession;
  const records = [];

  try {
    for (const row of selectedRows) {
      const sourceUrl = rowSourceUrl(row);
      const localUrl = rowLocalUrl(row, args.localUrlField);
      if (!sourceUrl || !localUrl) {
        records.push(buildEvidenceRecord({
          row,
          source: {error: sourceUrl ? null : "missing source URL"},
          local: {error: localUrl ? null : "missing local URL"},
          sourceArtifact: "",
          localArtifact: "",
          localUrlField: args.localUrlField,
        }));
        continue;
      }

      const rowDir = path.join(args.outputDir, safePathSegment(row.fixture_id));
      await fs.mkdir(rowDir, {recursive: true});
      const artifacts = await writeEvidenceArtifacts({
        outputDir: args.outputDir,
        row,
        source: {},
        local: {},
        screenshot: args.screenshot,
      });
      const sourcePage = await context.newPage();
      const localPage = await context.newPage();
      const source = await capturePage(sourcePage, sourceUrl, {
        timeoutMs: args.timeoutMs,
        waitUntil: args.waitUntil,
        screenshotPath: artifacts.sourceScreenshot,
      });
      const local = await capturePage(localPage, localUrl, {
        timeoutMs: args.timeoutMs,
        waitUntil: args.waitUntil,
        screenshotPath: artifacts.localScreenshot,
      });
      await sourcePage.close();
      await localPage.close();

      await fs.writeFile(artifacts.sourceArtifact, source.html ?? "", "utf8");
      await fs.writeFile(artifacts.localArtifact, local.html ?? "", "utf8");
      records.push(buildEvidenceRecord({
        row,
        source,
        local,
        sourceArtifact: artifacts.sourceArtifact,
        localArtifact: artifacts.localArtifact,
        sourceScreenshot: source.screenshotPath,
        localScreenshot: local.screenshotPath,
        localUrlField: args.localUrlField,
      }));
    }
  } finally {
    await browserSession.close();
  }

  const result = {
    schema: "wikijump_full_parity.browser_rendering_evidence.v1",
    inventory: args.inventory,
    shard_manifest: args.shardManifest ?? null,
    shard_id: args.shardId ?? null,
    selected_count: selectedRows.length,
    evidence: records,
    capture: {
      timeout_ms: args.timeoutMs,
      wait_until: args.waitUntil,
      ignore_https_errors: args.ignoreHttpsErrors,
      screenshot: args.screenshot,
      browser_executable: args.browserExecutable ?? null,
      cdp_endpoint: args.cdpEndpoint ?? null,
    },
  };
  const resultPath = path.join(args.outputDir, "records.json");
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (!args.jsonOnly) {
    console.log(`wrote ${records.length} browser rendering records to ${resultPath}`);
  } else {
    console.log(JSON.stringify({result_path: resultPath, selected_count: selectedRows.length}));
  }

  const captureErrors = records.flatMap((record) => record.capture_errors ?? []);
  return captureErrors.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
