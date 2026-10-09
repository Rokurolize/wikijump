#!/usr/bin/env node

import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {runCliIfMain} from "../src/cli-entry.mjs";
import {defaultBrowserRoot} from "../src/browser-session.mjs";

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--site-url", "--platform-origin", "--browser-root"].includes(flag)
      || !value || value.startsWith("--") || values.has(flag)) {
      throw new Error(`invalid or duplicate option: ${flag}`);
    }
    values.set(flag, value);
  }
  for (const flag of ["--site-url", "--platform-origin"]) {
    if (!values.has(flag)) throw new Error(`${flag} is required`);
  }

  const siteUrl = new URL(values.get("--site-url"));
  const platformOrigin = new URL(values.get("--platform-origin"));
  if (siteUrl.protocol !== "https:" || platformOrigin.protocol !== "https:"
    || siteUrl.hostname === platformOrigin.hostname
    || !siteUrl.hostname.endsWith(".localhost")
    || !platformOrigin.hostname.endsWith(".localhost")
    || platformOrigin.pathname !== "/" || platformOrigin.search || platformOrigin.hash) {
    throw new Error("site and platform URLs must be distinct HTTPS .localhost origins");
  }
  if (platformOrigin.port === "" || platformOrigin.port === "443") {
    throw new Error("platform origin must exercise a non-default HTTPS port");
  }
  return {
    siteUrl: siteUrl.href,
    platformOrigin: platformOrigin.origin,
    browserRoot: path.resolve(values.get("--browser-root") ?? defaultBrowserRoot()),
  };
}

async function verify({siteUrl, platformOrigin, browserRoot}) {
  const requireFromBrowserRoot = createRequire(path.join(browserRoot, "package.json"));
  const {chromium} = requireFromBrowserRoot("playwright");
  const browser = await chromium.launch({headless: true});
  try {
    const context = await browser.newContext({ignoreHTTPSErrors: true});
    const page = await context.newPage();
    const homeResponse = await page.goto(siteUrl, {waitUntil: "domcontentloaded"});
    assert.equal(homeResponse?.status(), 200, "default-template homepage response");

    const links = [
      ["Recent activity", "activity"],
      ["All wikis", "sites"],
      ["Search", "search"],
    ];
    for (const [label, slug] of links) {
      const link = page.getByRole("link", {name: label, exact: true});
      assert.equal(await link.count(), 1, `${label} navigation link count`);
      assert.equal(await link.isVisible(), true, `${label} navigation link visibility`);
      assert.equal(
        await link.evaluate((element) => element.classList.contains("newpage")),
        false,
        `${label} must not use missing-page styling`,
      );

      const targetUrl = `${platformOrigin}/platform:${slug}`;
      const navigationResponse = page.waitForResponse(
        (response) => response.url() === targetUrl && response.request().isNavigationRequest(),
      );
      await link.click();
      assert.equal((await navigationResponse).status(), 200, `${label} platform response`);
      await page.waitForURL(targetUrl);
      assert.equal(page.url(), targetUrl, `${label} platform URL`);
      assert.equal(await page.title().then((title) => title.length > 0), true, `${label} title`);
      assert.equal(await page.locator("body").innerText().then((text) => text.trim().length > 0), true, `${label} body`);

      await page.goBack({waitUntil: "domcontentloaded"});
      assert.equal(page.url(), siteUrl, `${label} browser back`);
      await page.goForward({waitUntil: "domcontentloaded"});
      assert.equal(page.url(), targetUrl, `${label} browser forward`);
      await page.goBack({waitUntil: "domcontentloaded"});
    }
    await context.close();
    return {
      schema: "wikijump.issue2056_platform_navigation_browser_verification.v1",
      status: "pass",
      site_url: siteUrl,
      platform_origin: platformOrigin,
      links: links.map(([label, slug]) => ({label, target: `${platformOrigin}/platform:${slug}`})),
      browser_back_forward: true,
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
