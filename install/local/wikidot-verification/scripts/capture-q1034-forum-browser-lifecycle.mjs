#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  acquireBrowserCaptureLock,
  createPersistentBrowserRequestGate,
} from "../src/browser-request-gate.mjs";
import { startCaptureEgressProxy } from "../src/capture-egress-proxy.mjs";
import { defaultBrowserRoot, loadPlaywright } from "../src/browser-session.mjs";

const ORIGIN = "http://sandbox-for-codex.wikidot.com";
const CATEGORY = "/forum/c-8503559/open-topic";
const THREAD = "/forum/t-18029831/codex-smoke-thread-20260617194313";
const SECOND_CATEGORY = "/forum/c-8503561/deleted-threads";
const MISSING_CATEGORY = "/forum/c-999999999/missing";
const MISSING_THREAD = "/forum/t-999999999/missing";
const DEFAULT_OUTPUT = fileURLToPath(
  new URL("../artifacts/q1034-forum-browser-lifecycle-live-20260915.json", import.meta.url),
);
const ALLOWED_HOSTS = new Set([
  "sandbox-for-codex.wikidot.com",
  "sandbox-for-codex.wdfiles.com",
  "d3g0gp89917ko0.cloudfront.net",
  "www.wikidot.com",
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function parseArgs(argv) {
  const args = { output: DEFAULT_OUTPUT, browserRoot: defaultBrowserRoot() };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || !["--output", "--browser-root"].includes(flag)) {
      throw new Error("usage: capture-q1034-forum-browser-lifecycle.mjs [--output PATH] [--browser-root PATH]");
    }
    args[flag.slice(2)] = path.resolve(value);
  }
  return args;
}

function normalizeState(raw, status = null) {
  const text = raw.box_text ?? "";
  return {
    label: raw.label,
    path: raw.path,
    ready_state: raw.ready_state,
    status,
    active_element: raw.active_element,
    body_wait_class: raw.body_wait_class,
    category_box_count: raw.category_box_count,
    thread_box_count: raw.thread_box_count,
    post_count: raw.post_count,
    error_text: raw.error_text,
    target_thread_link: raw.target_thread_link,
    box: {
      class_name: raw.box_class,
      text_sha256: text === "" ? null : sha256(text),
      text_bytes: Buffer.byteLength(text),
    },
  };
}

async function snapshot(page, label, status = null) {
  const raw = await page.evaluate((captureLabel) => {
    const active = document.activeElement;
    const box = document.querySelector(".forum-category-box,.forum-thread-box,.forum-start-box");
    const target = document.querySelector('a[href^="/forum/t-18029831/"]');
    return {
      label: captureLabel,
      path: location.pathname,
      ready_state: document.readyState,
      active_element: {
        tag: active?.tagName ?? null,
        id: active?.id ?? "",
        class_name: String(active?.className ?? ""),
      },
      body_wait_class: document.body?.classList.contains("wait") === true,
      category_box_count: document.querySelectorAll(".forum-category-box").length,
      thread_box_count: document.querySelectorAll(".forum-thread-box").length,
      post_count: document.querySelectorAll(".post-container").length,
      error_text: [...document.querySelectorAll("#page-content .error-block")]
        .map((element) => (element.textContent ?? "").replace(/\s+/gu, " ").trim())
        .filter(Boolean)
        .join(" | "),
      target_thread_link: target === null
        ? { present: false, href: null }
        : { present: true, href: target.getAttribute("href") },
      box_class: String(box?.className ?? ""),
      box_text: box?.textContent ?? "",
    };
  }, label);
  return normalizeState(raw, status);
}

async function navigate(page, states, targetPath, label) {
  const response = await page.goto(`${ORIGIN}${targetPath}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  states.push(await snapshot(page, `${label}_domcontentloaded`, response?.status() ?? null));
  await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  states.push(await snapshot(page, `${label}_settled`));
}

async function captureRecentPostsPageTwo(page) {
  const observed = await page.evaluate(async () => {
    const body = new URLSearchParams({
      moduleName: "forum/ForumRecentPostsListModule",
      page: "2",
      categoryId: "",
      callbackIndex: "1034",
      wikidot_token7: globalThis.OZONE?.utils?.getCookie?.("wikidot_token7") ?? "",
    });
    const response = await fetch("/ajax-module-connector.php", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body,
    });
    const raw = await response.text();
    const payload = JSON.parse(raw);
    const template = document.createElement("template");
    template.innerHTML = typeof payload.body === "string" ? payload.body : "";
    return {
      http_status: response.status,
      raw,
      payload_status: payload.status ?? null,
      body: typeof payload.body === "string" ? payload.body : "",
      post_count: template.content.querySelectorAll(".post-container,.post").length,
      pager_count: template.content.querySelectorAll(".pager").length,
    };
  });
  return {
    http_status: observed.http_status,
    payload_status: observed.payload_status,
    raw_sha256: sha256(observed.raw),
    raw_bytes: Buffer.byteLength(observed.raw),
    body_sha256: sha256(observed.body),
    body_bytes: Buffer.byteLength(observed.body),
    post_count: observed.post_count,
    pager_count: observed.pager_count,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = `q1034-browser-${randomUUID()}`;
  const requests = [];
  const blocked = [];
  const failedRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
  const ajaxPosts = [];

  const lock = await acquireBrowserCaptureLock({ runId });
  const gate = await createPersistentBrowserRequestGate({ statePath: lock.statePath, intervalMs: 0 });
  const proxy = await startCaptureEgressProxy();
  const { chromium } = loadPlaywright(args.browserRoot);
  let browser;
  let context;
  let page;
  try {
    browser = await chromium.launch({ headless: true, proxy: { server: proxy.url } });
    context = await browser.newContext({ serviceWorkers: "block" });
    page = await context.newPage();

    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (["GET", "HEAD"].includes(method)) {
        if (!ALLOWED_HOSTS.has(url.hostname)) {
          blocked.push({ method, host: url.hostname, path: url.pathname, resource_type: request.resourceType(), reason: "host" });
          gate.recordUnsupportedRequestBlocked(url.hostname);
          return route.abort("blockedbyclient");
        }
        await gate.acquire();
        requests.push({ method, host: url.hostname, path: url.pathname, resource_type: request.resourceType() });
        return route.continue();
      }

      if (method === "POST" && url.hostname === "sandbox-for-codex.wikidot.com" && url.pathname === "/ajax-module-connector.php") {
        const form = new URLSearchParams(request.postData() ?? "");
        const moduleName = form.get("moduleName");
        const action = form.get("action");
        const event = form.get("event");
        const safe = moduleName === "forum/ForumRecentPostsListModule"
          && form.get("page") === "2"
          && form.get("categoryId") === ""
          && !action
          && !event;
        ajaxPosts.push({
          safe,
          module_name: moduleName,
          page: form.get("page"),
          category_id: form.get("categoryId"),
          action_present: Boolean(action),
          event_present: Boolean(event),
          token_parameter_present: [...form.keys()].some((key) => /^wikidot_token/iu.test(key)),
        });
        if (!safe) {
          blocked.push({ method, host: url.hostname, path: url.pathname, resource_type: request.resourceType(), reason: "non-q1034-readonly-post", module_name: moduleName });
          gate.recordUnsupportedRequestBlocked(url.hostname);
          return route.abort("blockedbyclient");
        }
        await gate.acquire();
        requests.push({ method, host: url.hostname, path: url.pathname, resource_type: request.resourceType(), module_name: moduleName });
        return route.continue();
      }

      blocked.push({ method, host: url.hostname, path: url.pathname, resource_type: request.resourceType(), reason: "method" });
      gate.recordUnsupportedRequestBlocked(url.hostname);
      return route.abort("blockedbyclient");
    });

    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      const expectedBlocked = blocked.some((entry) => entry.method === request.method() && entry.host === url.hostname && entry.path === url.pathname);
      if (!expectedBlocked) failedRequests.push({ method: request.method(), resource_type: request.resourceType(), url_sha256: sha256(request.url()), error: request.failure()?.errorText ?? "" });
    });
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("ERR_BLOCKED_BY_CLIENT")) consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    const states = [];
    await navigate(page, states, CATEGORY, "category");
    const targetThread = page.locator('a[href^="/forum/t-18029831/"]').first();
    if (await targetThread.count() !== 1) throw new Error("Q1034 live category did not expose the sealed target thread link");
    await targetThread.focus();
    states.push(await snapshot(page, "category_thread_link_focused"));
    await targetThread.click();
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });
    states.push(await snapshot(page, "thread_domcontentloaded"));
    await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    states.push(await snapshot(page, "thread_settled"));

    let response = await page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 });
    states.push(await snapshot(page, "after_back_domcontentloaded", response?.status() ?? null));
    await page.waitForTimeout(250);
    states.push(await snapshot(page, "after_back_settled"));
    response = await page.goForward({ waitUntil: "domcontentloaded", timeout: 15_000 });
    states.push(await snapshot(page, "after_forward_domcontentloaded", response?.status() ?? null));
    await page.waitForTimeout(250);
    states.push(await snapshot(page, "after_forward_settled"));

    await navigate(page, states, SECOND_CATEGORY, "second_category");
    await navigate(page, states, MISSING_CATEGORY, "missing_category");
    await navigate(page, states, MISSING_THREAD, "missing_thread");
    const recentPostsPageTwo = await captureRecentPostsPageTwo(page);

    await page.unrouteAll({ behavior: "wait" }).catch(() => undefined);
    await gate.flush();
    const requestGate = gate.snapshot();
    const documentRequests = requests.filter(({ resource_type: resourceType }) => resourceType === "document");
    const requestCounts = Object.entries(requests.reduce((counts, request) => {
      const key = `${request.method} ${request.host} ${request.resource_type}`;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {})).map(([key, count]) => ({ key, count }));

    const artifact = {
      schema: "wikijump.q1034_forum_browser_lifecycle_live.v1",
      captured_at: new Date().toISOString(),
      site: "sandbox-for-codex",
      actor: "anonymous",
      mutation_performed: false,
      targets: {
        category: CATEGORY,
        thread: THREAD,
        second_category: SECOND_CATEGORY,
        missing_category: MISSING_CATEGORY,
        missing_thread: MISSING_THREAD,
      },
      states,
      recent_posts_page_two: recentPostsPageTwo,
      ajax_posts: ajaxPosts,
      document_requests: documentRequests,
      request_counts: requestCounts,
      blocked_requests: blocked,
      failed_requests: failedRequests,
      console_errors: consoleErrors,
      page_errors: pageErrors,
      request_gate: {
        schema: requestGate.schema,
        interval_ms: requestGate.interval_ms,
        enforcement_failed: requestGate.enforcement_failed,
        public_requests: requestGate.public_requests,
        external_network_requests: requestGate.external_network_requests,
        unsupported_requests_blocked: requestGate.unsupported_requests_blocked,
        websocket_connections_blocked: requestGate.websocket_connections_blocked,
      },
      authority_boundary: {
        forum_specific: "category/thread navigation, focus, history, failure DOM, settled DOM, and RecentPosts page=2 read-only connector behavior",
        ambient_wait_class: "Wikidot body.wait was observed only while an unrelated misc/CookiePolicyPlModule request was attempted; it is retained in state observations but is not treated as forum-specific authority.",
        excluded: ["authenticated actors", "forum mutation", "private visibility", "remote advertising/analytics behavior"],
      },
      credentials_in_evidence: false,
    };
    await fs.mkdir(path.dirname(args.output), { recursive: true });
    await fs.writeFile(args.output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ output: args.output, states: states.length, recent_posts_page_two: recentPostsPageTwo, blocked_requests: blocked.length, request_gate: artifact.request_gate }, null, 2));
  } finally {
    await gate.flush().catch(() => undefined);
    await page?.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await proxy.close().catch(() => undefined);
    await lock.release().catch(() => undefined);
  }
}

await main();
