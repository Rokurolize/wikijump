import assert from "node:assert/strict";
import {test} from "node:test";

import {
  createBrowserRequestGate,
  createBrowserResponseCache,
  installBrowserRequestGate,
} from "../src/browser-request-gate.mjs";

function createContext() {
  const routes = [];
  return {
    routes,
    async route(pattern, handler) {
      routes.push({pattern, handler});
    },
    async routeWebSocket() {},
    on() {},
  };
}

function createResponse(body) {
  return {
    status: () => 200,
    headers: () => ({
      "cache-control": "public, max-age=600",
      "content-length": String(Buffer.byteLength(body)),
    }),
    body: async () => Buffer.from(body),
  };
}

function createRoute(url, {response = null} = {}) {
  const actions = [];
  const request = {
    url: () => url,
    method: () => "GET",
    resourceType: () => "stylesheet",
    headers: () => ({}),
    frame: () => null,
  };
  return {
    actions,
    request: () => request,
    async fetch(options) {
      actions.push({type: "fetch", options});
      if (response === null) throw new Error("unexpected external fetch");
      return response;
    },
    async fulfill(options) {
      actions.push({type: "fulfill", status: options.status ?? options.response?.status() ?? null});
    },
    async abort(reason) {
      actions.push({type: "abort", reason});
    },
    async continue() {
      actions.push({type: "continue"});
    },
  };
}

test("candidate Wikidot-family dependency miss fetches once and is reused from cache", async () => {
  const gate = createBrowserRequestGate({intervalMs: 0});
  const responseCache = createBrowserResponseCache();
  const context = createContext();
  await installBrowserRequestGate(context, {gate, responseCache, cacheOnly: true});
  const handler = context.routes[0].handler;
  const url = "https://scp-wiki.wdfiles.com/local--files/component:theme/font-bauhaus.css";
  const miss = createRoute(url, {response: createResponse("cached-wikidot-asset")});
  const hit = createRoute(url);

  await handler(miss);
  await handler(hit);

  assert.deepEqual(miss.actions, [
    {type: "fetch", options: {maxRedirects: 0}},
    {type: "fulfill", status: 200},
  ]);
  assert.deepEqual(hit.actions, [{type: "fulfill", status: 200}]);
  assert.equal(gate.snapshot().public_requests, 1);
  assert.equal(gate.snapshot().enforcement_failed, false);
  assert.equal(responseCache.snapshot().misses, 1);
  assert.equal(responseCache.snapshot().hits, 1);
  assert.equal(responseCache.snapshot().stores, 1);
});
