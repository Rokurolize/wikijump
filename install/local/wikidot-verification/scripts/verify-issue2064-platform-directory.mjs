#!/usr/bin/env node

import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

import {runCliIfMain} from "../src/cli-entry.mjs";
import {defaultBrowserRoot} from "../src/browser-session.mjs";

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--platform-origin", "--browser-root"].includes(flag)
      || !value || value.startsWith("--") || values.has(flag)) {
      throw new Error(`invalid or duplicate option: ${flag}`);
    }
    values.set(flag, value);
  }
  if (!values.has("--platform-origin")) throw new Error("--platform-origin is required");
  const platformOrigin = new URL(values.get("--platform-origin"));
  if (platformOrigin.protocol !== "https:"
    || platformOrigin.hostname !== "wikijump.localhost"
    || platformOrigin.pathname !== "/" || platformOrigin.search || platformOrigin.hash
    || platformOrigin.port === "" || platformOrigin.port === "443") {
    throw new Error("platform origin must be the configured HTTPS wikijump.localhost origin on a non-default port");
  }
  return {
    platformOrigin: platformOrigin.origin,
    browserRoot: path.resolve(values.get("--browser-root") ?? defaultBrowserRoot()),
  };
}

function requireCandidateOrigin(url, expectedPort, label) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:", `${label} protocol`);
  assert.ok(parsed.hostname.endsWith(".localhost"), `${label} must use a local canonical hostname`);
  assert.equal(parsed.port, expectedPort, `${label} must preserve the configured listener port`);
}

async function verify({platformOrigin, browserRoot}) {
  const requireFromBrowserRoot = createRequire(path.join(browserRoot, "package.json"));
  const {chromium} = requireFromBrowserRoot("playwright");
  const browser = await chromium.launch({headless: true});
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      serviceWorkers: "block",
      viewport: {width: 1365, height: 900},
    });
    const blockedExternalRequests = [];
    await context.route("**/*", async (route) => {
      const hostname = new URL(route.request().url()).hostname;
      if (hostname === "wikijump.localhost" || hostname.endsWith(".localhost")) {
        await route.continue();
      } else {
        blockedExternalRequests.push(route.request().url());
        await route.abort("blockedbyclient");
      }
    });

    const results = {};
    for (const pageName of ["activity", "sites"]) {
      const page = await context.newPage();
      const response = await page.goto(`${platformOrigin}/platform:${pageName}`, {
        waitUntil: "domcontentloaded",
      });
      assert.equal(response?.status(), 200, `${pageName} page response`);
      const body = await page.locator("body").innerText();
      assert.equal(body.includes("[[module"), false, `${pageName} must not expose raw module source`);

      if (pageName === "activity") {
        assert.match(body, /Recent edits on wikis you can view/i);
        const rows = await page.locator(".platform-recent-activity > li").count();
        const empty = await page.locator(".platform-recent-activity > .platform-empty").count();
        assert.ok(rows > 0 || empty > 0, "activity must have data or an explicit empty state");
        const links = await page.locator(".platform-recent-activity a").evaluateAll((anchors) =>
          anchors.map((anchor) => anchor.href),
        );
        for (const href of links) requireCandidateOrigin(href, new URL(platformOrigin).port, "activity link");
        results.activity = {status: response.status(), visibleRows: rows, emptyState: empty === 1, links};
      } else {
        assert.match(body, /public sites hosted on this instance/i);
        const links = await page.locator(".platform-site-list > ul > li > a").evaluateAll((anchors) =>
          anchors.map((anchor) => ({text: anchor.textContent?.trim() ?? "", href: anchor.href})),
        );
        const emptyState = await page.locator(".platform-site-list .platform-empty").count();
        assert.ok(links.length > 0 || emptyState === 1, "public site directory must contain listed sites or an explicit empty state");
        for (const item of links) requireCandidateOrigin(item.href, new URL(platformOrigin).port, "site directory link");
        results.sites = {status: response.status(), listedSites: links, emptyState: emptyState === 1};
      }
      await page.close();
    }
    await context.close();
    return {
      schema: "wikijump.issue2064_platform_directory_browser_verification.v1",
      status: "pass",
      platform_origin: platformOrigin,
      results,
      blocked_external_request_count: blockedExternalRequests.length,
    };
  } finally {
    await browser.close();
  }
}

export async function main(argv, {stdout = console.log} = {}) {
  const result = await verify(parseArgs(argv));
  stdout(JSON.stringify(result, null, 2));
  return 0;
}

await runCliIfMain(import.meta.url, main, {onError: (error) => { console.error(error?.stack ?? String(error)); return 1; }});
