import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {
  acquireBrowserCaptureLock,
  createBrowserRequestGate,
  createBrowserResponseCache,
  createPersistentBrowserRequestGate,
  isWikidotCapturePublicOrigin,
  installBrowserRequestGate,
  isCaptureDependencyResourceType,
  localBrowserCaptureOrigins,
  parseRetryAfterMilliseconds,
} from "../src/browser-request-gate.mjs";

function createClock({failSleeps = 0} = {}) {
  let milliseconds = 0;
  let remainingFailures = failSleeps;
  const sleeps = [];
  return {
    now() {
      return milliseconds;
    },
    sleep: async (duration) => {
      sleeps.push(duration);
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("simulated clock failure");
      }
      milliseconds += duration;
    },
    set(value) {
      milliseconds = value;
    },
    sleeps,
  };
}

function createContext() {
  const routes = [];
  const webSocketRoutes = [];
  const events = new Map();
  return {
    routes,
    webSocketRoutes,
    events,
    async route(pattern, handler) {
      routes.push({pattern, handler});
    },
    async routeWebSocket(pattern, handler) {
      webSocketRoutes.push({pattern, handler});
    },
    on(event, handler) {
      events.set(event, handler);
    },
  };
}

function createRoute(url, {abortError = null, continueError = null, method = "GET", resourceType = "script", headers = {}, fetchResponse = null, frameUrl = null} = {}) {
  const actions = [];
  const request = {url: () => url, method: () => method, resourceType: () => resourceType, headers: () => headers, frame: () => frameUrl === null ? null : {url: () => frameUrl}};
  return {
    actions,
    request() {
      return request;
    },
    async continue() {
      actions.push({type: "continue"});
      if (continueError) throw continueError;
    },
    async abort(reason) {
      actions.push({type: "abort", reason});
      if (abortError) throw abortError;
    },
    async fetch(options) {
      actions.push({type: "fetch", options});
      if (!fetchResponse) throw new Error("unexpected route fetch");
      return fetchResponse;
    },
    async fulfill(options) {
      actions.push({type: "fulfill", status: options.status ?? options.response?.status() ?? null});
    },
  };
}

function createFetchResponse({status = 200, headers = {}, body = "asset"} = {}) {
  return {
    status: () => status,
    headers: () => ({"content-length": String(Buffer.byteLength(body)), ...headers}),
    body: async () => Buffer.from(body),
  };
}

test("shared gate admits concurrent public requests one per four seconds", async () => {
  const clock = createClock();
  const gate = createBrowserRequestGate({intervalMs: 4_000, now: clock.now, sleep: clock.sleep});

  const grants = await Promise.all([gate.acquire(), gate.acquire(), gate.acquire()]);

  assert.deepEqual(grants.map((grant) => grant.released_at_epoch_ms), [0, 4_000, 8_000]);
  assert.deepEqual(clock.sleeps, [4_000, 4_000]);
  assert.deepEqual(gate.snapshot().grants.map((grant) => grant.sequence), [1, 2, 3]);
});

test("Retry-After extends a shared gate without accepting an invalid or unbounded value", async () => {
  const clock = createClock();
  const gate = createBrowserRequestGate({intervalMs: 4_000, now: clock.now, sleep: clock.sleep});

  await gate.acquire();
  clock.set(100);
  assert.equal(await gate.deferForRetryAfter("5"), true);
  assert.equal(await gate.deferForRetryAfter("9".repeat(400)), false);
  const delayed = await gate.acquire();

  assert.equal(delayed.released_at_epoch_ms, 5_100);
  assert.equal(parseRetryAfterMilliseconds("3"), 3_000);
  assert.equal(parseRetryAfterMilliseconds("not-a-date"), null);
  assert.equal(gate.snapshot().retry_after_honored, 1);
  assert.equal(gate.snapshot().retry_after_invalid, 1);
});

test("source and local contexts share the gate while only the exact local origin is exempt", async () => {
  const clock = createClock();
  const gate = createBrowserRequestGate({intervalMs: 4_000, now: clock.now, sleep: clock.sleep});
  const sourceContext = createContext();
  const localContext = createContext();
  await installBrowserRequestGate(sourceContext, {gate});
  await installBrowserRequestGate(localContext, {gate, exemptOrigins: ["https://scp-wiki.wikijump.localhost"]});

  const localExact = createRoute("https://scp-wiki.wikijump.localhost/scp-173");
  assert.equal(localContext.routes[0].pattern(new URL(localExact.request().url())), false);
  localContext.events.get("request")(localExact.request());
  const source = createRoute("https://scp-wiki.wikidot.com/scp-173");
  const wrongPort = createRoute("https://scp-wiki.wikijump.localhost:18443/scp-173");
  assert.equal(localContext.routes[0].pattern(new URL(wrongPort.request().url())), true);
  await Promise.all([sourceContext.routes[0].handler(source), localContext.routes[0].handler(wrongPort)]);
  let connected = false;
  await sourceContext.webSocketRoutes[0].handler({connectToServer() { connected = true; }});

  assert.deepEqual(localExact.actions, []);
  assert.deepEqual(source.actions, [{type: "continue"}]);
  assert.deepEqual(wrongPort.actions, [{type: "continue"}]);
  assert.equal(connected, false);
  assert.deepEqual(gate.snapshot().grants.map((grant) => grant.released_at_epoch_ms), [0, 4_000]);
  assert.equal(gate.snapshot().local_exempt_requests, 1);
  assert.equal(gate.snapshot().websocket_connections_blocked, 1);
});

test("the public gate admits Wikidot and css.wikidot.com but blocks unrelated public hosts before admission", async () => {
  const clock = createClock();
  const gate = createBrowserRequestGate({intervalMs: 4_000, now: clock.now, sleep: clock.sleep});
  gate.setActiveFixture("syntax-collapsible");
  const context = createContext();
  await installBrowserRequestGate(context, {gate, publicOriginPredicate: isWikidotCapturePublicOrigin});
  const handler = context.routes[0].handler;
  const ad = createRoute("https://api.rlcdn.com/api/identity");
  const css = createRoute("https://css.wikidot.com/local--code/1", {resourceType: "stylesheet"});
  const page = createRoute("http://sandbox-for-codex.wikidot.com/codex-oracle:fixture");
  const styleFrame = createRoute("https://interwiki.scpwiki.com/styleFrame.html?priority=1&theme=example", {resourceType: "document"});
  const styleFrameAsScript = createRoute("https://interwiki.scpwiki.com/styleFrame.html?priority=1&theme=example", {resourceType: "script"});
  const styleFramePost = createRoute("https://interwiki.scpwiki.com/styleFrame.html?priority=1&theme=example", {method: "POST", resourceType: "document"});
  const interwikiRuntime = createRoute("https://interwiki.scpwiki.com/interwiki.js", {resourceType: "script", frameUrl: "https://interwiki.scpwiki.com/interwikiFrame.html?lang=en"});
  const resizeRuntime = createRoute("https://interwiki.scpwiki.com/resizeIframe.js", {resourceType: "script", frameUrl: "https://interwiki.scpwiki.com/styleFrame.html?priority=1"});
  const unknownInterwikiScript = createRoute("https://interwiki.scpwiki.com/other.js", {resourceType: "script"});

  await handler(ad);
  await handler(css);
  await handler(page);
  await handler(styleFrame);
  await handler(styleFrameAsScript);
  await handler(styleFramePost);
  await handler(interwikiRuntime);
  await handler(resizeRuntime);
  await handler(unknownInterwikiScript);

  assert.deepEqual(ad.actions, [{type: "abort", reason: "blockedbyclient"}]);
  assert.deepEqual(css.actions, [{type: "continue"}]);
  assert.deepEqual(page.actions, [{type: "continue"}]);
  assert.equal(gate.snapshot().public_requests, 5);
  assert.deepEqual(gate.snapshot().blocked_hosts, {"api.rlcdn.com": 1, "interwiki.scpwiki.com": 3});
  assert.deepEqual(gate.snapshot().blocked_hosts_by_fixture, {"syntax-collapsible": {"api.rlcdn.com": 1, "interwiki.scpwiki.com": 3}});
  assert.equal(isWikidotCapturePublicOrigin("https://css.wikidot.com"), true);
  assert.equal(isWikidotCapturePublicOrigin("https://wikidot.com"), true);
  assert.equal(isWikidotCapturePublicOrigin("http://d3g0gp89917ko0.cloudfront.net/v--7690939296dc/common--javascript/WIKIDOT.combined.js"), true);
  assert.equal(isWikidotCapturePublicOrigin("https://d3g0gp89917ko0.cloudfront.net/ads.js"), false);
  assert.deepEqual(styleFrameAsScript.actions, [{type: "abort", reason: "blockedbyclient"}]);
  assert.deepEqual(styleFramePost.actions, [{type: "abort", reason: "blockedbyclient"}]);
  assert.deepEqual(interwikiRuntime.actions, [{type: "continue"}]);
  assert.deepEqual(resizeRuntime.actions, [{type: "continue"}]);
  assert.deepEqual(unknownInterwikiScript.actions, [{type: "abort", reason: "blockedbyclient"}]);
  assert.equal(isWikidotCapturePublicOrigin("https://interwiki.scpwiki.com/styleFrame.html?priority=1", "document", "GET"), true);
  assert.equal(isWikidotCapturePublicOrigin("https://interwiki.scpwiki.com/interwikiFrame.html?lang=en", "document", "GET"), true);
  assert.equal(isWikidotCapturePublicOrigin("https://interwiki.scpwiki.com/styleFrame.html", "script", "GET"), false);
  assert.equal(isWikidotCapturePublicOrigin("https://interwiki.scpwiki.com/styleFrame.html", "document", "POST"), false);
  assert.equal(isWikidotCapturePublicOrigin("https://interwiki.scpwiki.com/interwiki.js", "script", "GET", "https://interwiki.scpwiki.com/interwikiFrame.html"), true);
  assert.equal(isWikidotCapturePublicOrigin("https://interwiki.scpwiki.com/resizeIframe.js", "script", "GET", "https://interwiki.scpwiki.com/styleFrame.html"), true);
  assert.equal(isWikidotCapturePublicOrigin("https://interwiki.scpwiki.com/interwiki.js", "script", "GET"), false);
  assert.equal(isWikidotCapturePublicOrigin("https://interwiki.scpwiki.com/other.js", "script", "GET"), false);
  assert.equal(isWikidotCapturePublicOrigin("https://interwiki.scpwiki.com/other.html", "document", "GET"), false);
  assert.equal(isWikidotCapturePublicOrigin("http://interwiki.scpwiki.com/styleFrame.html", "document", "GET"), false);
  assert.equal(isWikidotCapturePublicOrigin("https://example.com"), false);
});

test("theme dependencies are admitted by resource type while third-party execution is blocked", async () => {
  const clock = createClock();
  const gate = createBrowserRequestGate({intervalMs: 4_000, now: clock.now, sleep: clock.sleep});
  const context = createContext();
  await installBrowserRequestGate(context, {gate, publicOriginPredicate: isWikidotCapturePublicOrigin});
  const handler = context.routes[0].handler;
  const stylesheet = createRoute("https://cdn.scpwiki.com/theme/en/sigma/theme.css", {resourceType: "stylesheet"});
  const font = createRoute("https://cdn.scpwiki.com/theme/en/sigma/font.woff2", {resourceType: "font"});
  const image = createRoute("https://cdn.scpwiki.com/theme/en/sigma/logo.svg", {resourceType: "image"});
  const script = createRoute("https://cdn.scpwiki.com/theme/en/sigma/theme.js", {resourceType: "script"});

  await handler(stylesheet);
  await handler(font);
  await handler(image);
  await handler(script);

  assert.deepEqual(stylesheet.actions, [{type: "continue"}]);
  assert.deepEqual(font.actions, [{type: "continue"}]);
  assert.deepEqual(image.actions, [{type: "continue"}]);
  assert.deepEqual(script.actions, [{type: "abort", reason: "blockedbyclient"}]);
  assert.equal(isCaptureDependencyResourceType("stylesheet"), true);
  assert.equal(isCaptureDependencyResourceType("font"), true);
  assert.equal(isCaptureDependencyResourceType("image"), true);
  assert.equal(isCaptureDependencyResourceType("script"), false);
  assert.equal(gate.snapshot().public_requests, 3);
  assert.deepEqual(gate.snapshot().blocked_hosts, {"cdn.scpwiki.com": 1});
});

test("a source response cache serves repeated cacheable assets without another gate grant", async () => {
  const clock = createClock();
  const gate = createBrowserRequestGate({intervalMs: 4_000, now: clock.now, sleep: clock.sleep});
  const responseCache = createBrowserResponseCache();
  const context = createContext();
  await installBrowserRequestGate(context, {gate, responseCache});
  const handler = context.routes[0].handler;
  const url = "https://cdn.example.test/shared.css";
  const first = createRoute(url, {
    resourceType: "stylesheet",
    fetchResponse: createFetchResponse({headers: {"cache-control": "public, max-age=600"}, body: "body{}"}),
  });
  const second = createRoute(url, {resourceType: "stylesheet"});

  await handler(first);
  await handler(second);

  assert.deepEqual(first.actions, [
    {type: "fetch", options: {maxRedirects: 0}},
    {type: "fulfill", status: 200},
  ]);
  assert.deepEqual(second.actions, [{type: "fulfill", status: 200}]);
  assert.equal(gate.snapshot().public_requests, 1);
  assert.deepEqual(responseCache.snapshot(), {
    schema: "wikijump_full_parity.browser_response_cache.v1",
    entries: 1,
    bytes: 6,
    hits: 1,
    misses: 1,
    stores: 1,
    bypasses: 0,
    evictions: 0,
    max_entries: 512,
    max_bytes: 64 * 1024 * 1024,
    max_entry_bytes: 8 * 1024 * 1024,
    lookup_key: "exact_url",
    lifetime: "browser_context",
    documents_cached: false,
  });
});

test("a persistent response cache replays a stable external 404 without another request", async (t) => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "wikijump-browser-negative-cache-"));
  t.after(() => fs.rm(cacheDir, {recursive: true, force: true}));
  const identity = "live-reference:avatar-19102600";
  const firstGate = createBrowserRequestGate({intervalMs: 4_000});
  const firstCache = createBrowserResponseCache({persistentDir: cacheDir, persistentIdentity: identity});
  await firstCache.load();
  const firstContext = createContext();
  await installBrowserRequestGate(firstContext, {gate: firstGate, responseCache: firstCache});
  await firstContext.routes[0].handler(createRoute("https://www.wikidot.com/avatar.php?userid=19102600&amp;size=small", {
    resourceType: "image",
    fetchResponse: createFetchResponse({status: 404, headers: {"cache-control": "public, max-age=600"}, body: "not found"}),
  }));
  await firstCache.flush();

  const secondGate = createBrowserRequestGate({intervalMs: 4_000});
  const secondCache = createBrowserResponseCache({persistentDir: cacheDir, persistentIdentity: identity});
  await secondCache.load();
  const secondContext = createContext();
  await installBrowserRequestGate(secondContext, {gate: secondGate, responseCache: secondCache, cacheOnly: true});
  const second = createRoute("https://www.wikidot.com/avatar.php?userid=19102600&amp;size=small", {resourceType: "image"});
  await secondContext.routes[0].handler(second);

  assert.deepEqual(second.actions, [{type: "fulfill", status: 404}]);
  assert.equal(secondGate.snapshot().public_requests, 0);
  assert.equal(secondCache.snapshot().persistent_entries_loaded, 1);

  const timestamped = createRoute("https://www.wikidot.com/avatar.php?userid=19102600&amp;size=small&amp;timestamp=1788341729", {resourceType: "image"});
  await secondContext.routes[0].handler(timestamped);
  assert.deepEqual(timestamped.actions, [{type: "fulfill", status: 404}]);
  assert.equal(secondGate.snapshot().public_requests, 0);
});

test("candidate cache misses for unsupported scripts abort without an external request or gate grant", async () => {
  const gate = createBrowserRequestGate({intervalMs: 4_000});
  const responseCache = createBrowserResponseCache();
  const context = createContext();
  await installBrowserRequestGate(context, {gate, responseCache, cacheOnly: true});
  const miss = createRoute("https://rsms.me/inter/inter.js", {resourceType: "script"});

  await context.routes[0].handler(miss);

  assert.deepEqual(miss.actions, [{type: "abort", reason: "blockedbyclient"}]);
  assert.equal(gate.snapshot().public_requests, 0);
  assert.equal(gate.snapshot().enforcement_failed, true);
  assert.equal(responseCache.snapshot().misses, 1);
});

test("candidate cache misses for explicit provider origins use the metered network", async () => {
  const gate = createBrowserRequestGate({intervalMs: 0});
  const responseCache = createBrowserResponseCache();
  const context = createContext();
  await installBrowserRequestGate(context, {gate, responseCache, cacheOnly: true, cacheOnlyAllowedOrigins: ["https://www.youtube.com"]});
  const miss = createRoute("https://www.youtube.com/embed/example", {resourceType: "stylesheet"});

  await context.routes[0].handler(miss);

  assert.deepEqual(miss.actions, [{type: "continue"}]);
  assert.equal(gate.snapshot().public_requests, 1);
  assert.equal(gate.snapshot().enforcement_failed, false);
  assert.equal(responseCache.snapshot().misses, 1);
});

test("an explicitly identified persistent source cache reuses documents without a second Wikidot request", async (t) => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "wikijump-browser-response-cache-"));
  t.after(() => fs.rm(cacheDir, {recursive: true, force: true}));
  const identity = "live-reference:scp-8980:chromium-149:fixture-2026-08-27";
  const url = "https://scp-wiki.wikidot.com/scp-8980";
  const firstGate = createBrowserRequestGate({intervalMs: 4_000});
  const firstCache = createBrowserResponseCache({persistentDir: cacheDir, persistentIdentity: identity, cacheDocuments: true});
  await firstCache.load();
  const firstContext = createContext();
  await installBrowserRequestGate(firstContext, {gate: firstGate, responseCache: firstCache});
  await firstContext.routes[0].handler(createRoute(url, {
    resourceType: "document",
    fetchResponse: createFetchResponse({headers: {"cache-control": "public, max-age=600"}, body: "<html>retained</html>"}),
  }));
  await firstCache.flush();

  const secondGate = createBrowserRequestGate({intervalMs: 4_000});
  const secondCache = createBrowserResponseCache({persistentDir: cacheDir, persistentIdentity: identity, cacheDocuments: true});
  await secondCache.load();
  const secondContext = createContext();
  await installBrowserRequestGate(secondContext, {gate: secondGate, responseCache: secondCache});
  const second = createRoute(url, {resourceType: "document"});
  await secondContext.routes[0].handler(second);

  assert.deepEqual(second.actions, [{type: "fulfill", status: 200}]);
  assert.equal(secondGate.snapshot().public_requests, 0);
  assert.equal(secondCache.snapshot().lifetime, "persistent");
  assert.equal(secondCache.snapshot().persistent_entries_loaded, 1);
  await assert.rejects(
    createBrowserResponseCache({persistentDir: cacheDir, persistentIdentity: "different-browser"}).load(),
    /identity or schema mismatch/u,
  );
});

test("a URL-only source response cache bypasses revalidation and request-context responses", async (t) => {
  const cases = [
    ["no-cache", {"cache-control": "no-cache"}],
    ["private", {"cache-control": "private, max-age=600"}],
    ["max-age zero", {"cache-control": "public, max-age=0"}],
    ["must-revalidate", {"cache-control": "public, max-age=600, must-revalidate"}],
    ["cookie variance", {"cache-control": "public, max-age=600", vary: "Cookie"}],
    ["language variance", {"cache-control": "public, max-age=600", vary: "Accept-Language"}],
    ["response cookie", {"cache-control": "public, max-age=600", "set-cookie": "session=secret"}],
  ];

  for (const [name, responseHeaders] of cases) {
    await t.test(name, async () => {
      const clock = createClock();
      const gate = createBrowserRequestGate({intervalMs: 4_000, now: clock.now, sleep: clock.sleep});
      const responseCache = createBrowserResponseCache();
      const context = createContext();
      await installBrowserRequestGate(context, {gate, responseCache});
      const handler = context.routes[0].handler;
      const url = `https://cdn.example.test/${encodeURIComponent(name)}.css`;

      const first = createRoute(url, {
        resourceType: "stylesheet",
        fetchResponse: createFetchResponse({headers: responseHeaders, body: "first"}),
      });
      const second = createRoute(url, {
        resourceType: "stylesheet",
        fetchResponse: createFetchResponse({headers: responseHeaders, body: "second"}),
      });

      await handler(first);
      await handler(second);

      assert.deepEqual(first.actions, [
        {type: "fetch", options: {maxRedirects: 0}},
        {type: "fulfill", status: 200},
      ]);
      assert.deepEqual(second.actions, [
        {type: "fetch", options: {maxRedirects: 0}},
        {type: "fulfill", status: 200},
      ]);
      assert.equal(gate.snapshot().public_requests, 2);
      assert.equal(responseCache.snapshot().entries, 0);
      assert.equal(responseCache.snapshot().stores, 0);
      assert.equal(responseCache.snapshot().bypasses, 2);
    });
  }
});

test("documents and no-store assets keep using the unchanged request gate", async () => {
  const clock = createClock();
  const gate = createBrowserRequestGate({intervalMs: 4_000, now: clock.now, sleep: clock.sleep});
  const responseCache = createBrowserResponseCache();
  const context = createContext();
  await installBrowserRequestGate(context, {gate, responseCache});
  const handler = context.routes[0].handler;
  const document = createRoute("https://example.test/page", {resourceType: "document"});
  const noStoreUrl = "https://example.test/dynamic.js";
  const noStoreResponse = createFetchResponse({headers: {"cache-control": "no-store"}});

  await handler(document);
  await handler(createRoute(noStoreUrl, {fetchResponse: noStoreResponse}));
  await handler(createRoute(noStoreUrl, {fetchResponse: noStoreResponse}));

  assert.deepEqual(document.actions, [{type: "continue"}]);
  assert.equal(gate.snapshot().public_requests, 3);
  assert.equal(responseCache.snapshot().entries, 0);
  assert.equal(responseCache.snapshot().stores, 0);
  assert.equal(responseCache.snapshot().bypasses, 3);
});

test("intentional unsupported-request attribution requires the exact request object", async () => {
  const gate = createBrowserRequestGate({intervalMs: 4_000});
  const context = createContext();
  const attribution = await installBrowserRequestGate(context, {gate});
  const dataUrl = createRoute("data:text/plain,unmetered");

  await context.routes[0].handler(dataUrl);

  assert.deepEqual(dataUrl.actions, [{type: "abort", reason: "blockedbyclient"}]);
  assert.deepEqual(attribution.classifyRequestFailure(dataUrl.request()), {
    decision: "unsupported_protocol",
    abort_reason: "blockedbyclient",
  });
  assert.equal(
    attribution.classifyRequestFailure({
      url: () => "data:text/plain,unmetered",
      resourceType: () => "script",
    }),
    null,
  );
});

test("gate implementation failures latch enforcement closed", async () => {
  const clock = createClock({failSleeps: 1});
  const gate = createBrowserRequestGate({intervalMs: 4_000, now: clock.now, sleep: clock.sleep});
  const context = createContext();
  await installBrowserRequestGate(context, {gate});
  const handler = context.routes[0].handler;

  await gate.acquire();
  const blockedAfterSleepFailure = createRoute("https://scp-wiki.wikidot.com/queued");
  await handler(blockedAfterSleepFailure);
  assert.deepEqual(blockedAfterSleepFailure.actions, [{type: "abort", reason: "blockedbyclient"}]);
  assert.equal(gate.snapshot().enforcement_failed, true);
  await assert.rejects(gate.acquire(), /simulated clock failure/u);
});

test("a persisted gate prevents a later capture process from granting before the prior interval", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wikijump-browser-request-state-"));
  const statePath = path.join(root, "campaign.state.json");
  const firstClock = createClock();
  const first = await createPersistentBrowserRequestGate({
    statePath,
    intervalMs: 4_000,
    now: firstClock.now,
    sleep: firstClock.sleep,
  });
  await first.acquire();
  await first.flush();

  const secondClock = createClock();
  const second = await createPersistentBrowserRequestGate({
    statePath,
    intervalMs: 4_000,
    now: secondClock.now,
    sleep: secondClock.sleep,
  });
  const grant = await second.acquire();
  await second.flush();

  assert.equal(grant.released_at_epoch_ms, 4_000);
  assert.deepEqual(secondClock.sleeps, [4_000]);
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(state.next_admissible_at_epoch_ms, 8_000);
});

test("context-level response handling preserves Retry-After from a different page or popup", async () => {
  const clock = createClock();
  const gate = createBrowserRequestGate({intervalMs: 4_000, now: clock.now, sleep: clock.sleep});
  const context = createContext();
  await installBrowserRequestGate(context, {gate});

  context.events.get("response")({
    url: () => "https://scp-wiki.wikidot.com/popup-response",
    headers: () => ({"retry-after": "7"}),
  });
  await gate.flush();
  const route = createRoute("https://scp-wiki.wikidot.com/after-popup");
  await context.routes[0].handler(route);

  assert.deepEqual(route.actions, [{type: "continue"}]);
  assert.deepEqual(gate.snapshot().grants.map((grant) => grant.released_at_epoch_ms), [7_000]);
  assert.equal(gate.snapshot().retry_after_honored, 1);
});

test("uninspectable public response metadata latches the gate closed", async () => {
  const gate = createBrowserRequestGate();
  const context = createContext();
  await installBrowserRequestGate(context, {gate});

  context.events.get("response")({
    url: () => "https://scp-wiki.wikidot.com/uninspectable",
    headers() {
      throw new Error("metadata unavailable");
    },
  });
  const route = createRoute("https://scp-wiki.wikidot.com/after-uninspectable");
  await context.routes[0].handler(route);

  assert.deepEqual(route.actions, [{type: "abort", reason: "blockedbyclient"}]);
  await assert.rejects(gate.flush(), /headers cannot be inspected/);
  assert.equal(gate.snapshot().enforcement_failed, true);
});

test("persistence failure latches the gate closed before a restart can be admitted", async () => {
  const clock = createClock();
  let writes = 0;
  const gate = createBrowserRequestGate({
    now: clock.now,
    sleep: clock.sleep,
    persistState: async () => {
      writes += 1;
      if (writes > 1) throw new Error("durable state write failed");
    },
  });
  await gate.acquire();
  await assert.rejects(gate.deferForRetryAfter("30"), /durable state write failed/);

  await assert.rejects(gate.flush(), /durable state write failed/);
  await assert.rejects(gate.acquire(), /durable state write failed/);
  assert.equal(gate.snapshot().enforcement_failed, true);
});

test("only canonical Wikijump local origins can become local exemptions", () => {
  assert.deepEqual(localBrowserCaptureOrigins("https://scp-wiki.wikijump.localhost/scp-173?x=1"), [
    "https://scp-wiki.wikijump.localhost",
    "https://scp-wiki.wjfiles.localhost",
  ]);
  assert.deepEqual(localBrowserCaptureOrigins("https://scp-wiki.wikijump.localhost:18443/scp-173"), [
    "https://scp-wiki.wikijump.localhost:18443",
    "https://scp-wiki.wjfiles.localhost:18443",
  ]);
  assert.throws(() => localBrowserCaptureOrigins("https://public.example/scp-173"), /\.wikijump\.localhost/);
  assert.throws(() => localBrowserCaptureOrigins("https://user@scp-wiki.wikijump.localhost/scp-173"), /without credentials/);
});

test("capture lock refuses a live owner regardless of state confirmation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wikijump-browser-request-lock-"));
  const lockPath = path.join(root, "campaign.lock");
  const ticks = new Map([[process.pid, "123"]]);
  const processStartTicks = async (pid) => ticks.get(pid) ?? null;
  const first = await acquireBrowserCaptureLock({
    lockPath,
    runId: "first",
    hostname: "test-host",
    processStartTicks,
    now: () => "2026-07-20T00:00:00.000Z",
  });

  await assert.rejects(
    () => acquireBrowserCaptureLock({lockPath, runId: "second", hostname: "test-host", processStartTicks}),
    /held by run first/
  );
  await first.confirmState();
  await assert.rejects(
    () => acquireBrowserCaptureLock({lockPath, runId: "second", hostname: "test-host", processStartTicks}),
    /held by run first/
  );
  await first.release();
});

test("capture lock safely replaces a sealed stale owner", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wikijump-browser-request-lock-"));
  const lockPath = path.join(root, "campaign.lock");
  const processStartTicks = async (pid) => pid === process.pid ? "123" : null;
  await fs.writeFile(lockPath, `${JSON.stringify({
    schema: "wikijump_full_parity.browser_capture_lock.v1",
    hostname: "test-host",
    pid: 42,
    process_start_ticks: "456",
    run_id: "stale-run",
    state_confirmation: "sealed",
  })}\n`, {mode: 0o600});
  const replacement = await acquireBrowserCaptureLock({lockPath, runId: "replacement", hostname: "test-host", processStartTicks});
  assert.equal(replacement.owner.run_id, "replacement");
  await replacement.confirmState();
  await replacement.release();
  await assert.rejects(fs.lstat(lockPath), {code: "ENOENT"});
});

test("capture lock replaces an unsealed stale owner when durable state preserves the request floor", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wikijump-browser-request-lock-"));
  const lockPath = path.join(root, "campaign.lock");
  const statePath = `${lockPath}.state.json`;
  const processStartTicks = async (pid) => pid === process.pid ? "123" : null;
  await fs.writeFile(lockPath, `${JSON.stringify({
    schema: "wikijump_full_parity.browser_capture_lock.v1",
    hostname: "test-host",
    pid: 42,
    process_start_ticks: "456",
    run_id: "stale-run",
    state_confirmation: "pending",
  })}\n`, {mode: 0o600});
  await fs.writeFile(statePath, `${JSON.stringify({
    schema: "wikijump_full_parity.browser_request_gate_state.v1",
    next_admissible_at_epoch_ms: 12_000,
    retry_after_until_epoch_ms: 0,
  })}\n`, {mode: 0o600});

  const replacement = await acquireBrowserCaptureLock({lockPath, runId: "replacement", hostname: "test-host", processStartTicks});
  assert.equal(replacement.owner.run_id, "replacement");
  assert.equal(replacement.statePath, statePath);
  const clock = createClock();
  const gate = await createPersistentBrowserRequestGate({statePath: replacement.statePath, intervalMs: 4_000, now: clock.now, sleep: clock.sleep});
  const grant = await gate.acquire();
  assert.equal(grant.released_at_epoch_ms, 12_000);
  assert.deepEqual(clock.sleeps, [12_000]);
  await replacement.confirmState();
  await replacement.release();
  await assert.rejects(fs.lstat(lockPath), {code: "ENOENT"});
});

test("capture lock refuses an unsealed stale owner when durable state is unavailable or malformed", async (t) => {
  for (const state of [null, "malformed\n"]) {
    await t.test(state === null ? "missing state" : "malformed state", async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "wikijump-browser-request-lock-"));
      const lockPath = path.join(root, "campaign.lock");
      const processStartTicks = async (pid) => pid === process.pid ? "123" : null;
      await fs.writeFile(lockPath, `${JSON.stringify({
        schema: "wikijump_full_parity.browser_capture_lock.v1",
        hostname: "test-host",
        pid: 42,
        process_start_ticks: "456",
        run_id: "stale-run",
        state_confirmation: "pending",
      })}\n`, {mode: 0o600});
      if (state !== null) await fs.writeFile(`${lockPath}.state.json`, state, {mode: 0o600});

      await assert.rejects(
        () => acquireBrowserCaptureLock({lockPath, runId: "blocked", hostname: "test-host", processStartTicks}),
        (error) => {
          assert.match(error.message, /unconfirmed request-gate state from run stale-run; operator review is required/);
          if (state === null) {
            assert.equal(error.cause, undefined);
          } else {
            assert.match(error.cause.message, /browser request gate state is malformed/);
          }
          return true;
        },
      );
    });
  }
});
