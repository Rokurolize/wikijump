import assert from "node:assert/strict";
import test from "node:test";

import {createDeepwellPreviewClient, validateLocalRpcUrl} from "../src/deepwell-preview.mjs";

test("validateLocalRpcUrl accepts only uncredentialed loopback /jsonrpc", () => {
  assert.equal(validateLocalRpcUrl("http://127.0.0.1:2747/jsonrpc"), "http://127.0.0.1:2747/jsonrpc");
  assert.equal(validateLocalRpcUrl("http://localhost:2747/jsonrpc"), "http://localhost:2747/jsonrpc");
  for (const bad of [
    "https://127.0.0.1:2747/jsonrpc",
    "http://example.com/jsonrpc",
    "http://127.0.0.1:2747/",
    "http://user:pass@127.0.0.1:2747/jsonrpc",
    "http://127.0.0.1:2747/jsonrpc?x=1",
  ]) {
    assert.throws(() => validateLocalRpcUrl(bad), /loopback/u, bad);
  }
});

test("preview client requires a token", () => {
  assert.throws(() => createDeepwellPreviewClient({rpcToken: ""}), /token is required/u);
});

test("preview client sends wikidot_page_preview and returns body/styles", async () => {
  let seen = null;
  const client = createDeepwellPreviewClient({
    rpcToken: "a".repeat(64),
    fetchImpl: async (url, options) => {
      seen = {url, body: JSON.parse(options.body), headers: options.headers};
      return {
        ok: true,
        status: 200,
        async json() {
          return {jsonrpc: "2.0", id: 1, result: {body: "<p>x</p>", styles: ["a{}"], legacy_actions: []}};
        },
      };
    },
  });
  const rendered = await client.preview({siteId: 6000003, title: "T", wikitext: "x", syntaxOnly: true});
  assert.equal(seen.body.method, "wikidot_page_preview");
  assert.deepEqual(seen.body.params, {site_id: 6000003, title: "T", wikitext: "x", syntax_only: true});
  assert.equal(seen.headers.authorization, `Bearer ${"a".repeat(64)}`);
  assert.deepEqual(rendered, {body: "<p>x</p>", styles: ["a{}"], legacy_actions: [], membership_actions: []});
});

test("preview client surfaces a JSON-RPC error", async () => {
  const client = createDeepwellPreviewClient({
    rpcToken: "a".repeat(64),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {jsonrpc: "2.0", id: 1, error: {message: "boom"}};
      },
    }),
  });
  await assert.rejects(() => client.preview({siteId: 1, title: "T", wikitext: "x"}), /boom/u);
});

test("saved fixture retains page tag context and rejects stale source or tags", async () => {
  const source = '[[iftags -heritage]]normal[[/iftags]]';
  const page = {site_id: 6000003, slug: 'run-owned:fixture', page_id: 42, revision_id: 43,
    layout: 'wikidot', tags: ['jp'], wikitext: source, compiled_body_html: '<p>normal</p>',
    compiled_body_styles: [], compiled_generator: 'test-generator'};
  let request;
  const client = createDeepwellPreviewClient({rpcToken: 'test-token',
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return {ok: true, async json() {return {result: page};}};
    }});
  const input = {siteId: 6000003, page: 'run-owned:fixture', wikitext: source, tags: ['jp']};
  const result = await client.savedPage(input);
  assert.equal(request.method, 'page_get');
  assert.deepEqual(request.params.details, {wikitext: true, compiled: true});
  assert.equal(result.body, '<p>normal</p>');
  assert.equal(result.identity.revision_id, 43);
  for (const changed of [{wikitext: source + 'new'}, {tags: ['heritage']}, {siteId: 7}, {page: 'other'}]) {
    await assert.rejects(client.savedPage({...input, ...changed}), /does not match/u);
  }
});
