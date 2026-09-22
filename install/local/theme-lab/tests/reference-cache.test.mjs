import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ReferenceCache,
  assertFetchableUrl,
  extractCssReferences,
  extractHtmlReferences,
  isPrivateAddress,
  objectPath,
  resolveUrl,
  rewriteCssReferences,
  rewriteHtmlReferences,
  sha256Hex,
} from "../src/reference-cache.mjs";
import {startReferenceReplay} from "../src/reference-replay.mjs";
import {ThemeLabError} from "../src/errors.mjs";

test("private address detection", () => {
  for (const value of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.9.9", "169.254.1.1", "::1", "fc00::1", "fe80::1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateAddress(value), true, value);
  }
  for (const value of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) {
    assert.equal(isPrivateAddress(value), false, value);
  }
});

test("assertFetchableUrl blocks unsafe schemes and private hosts", () => {
  assert.equal(assertFetchableUrl("https://example.com/a").hostname, "example.com");
  for (const bad of ["file:///etc/passwd", "ftp://example.com/x", "http://localhost/x", "http://127.0.0.1/x", "https://user:pass@example.com/x"]) {
    assert.throws(() => assertFetchableUrl(bad), (error) => error instanceof ThemeLabError, bad);
  }
  assert.equal(assertFetchableUrl("http://127.0.0.1:8080/x", {allowPrivate: true}).hostname, "127.0.0.1");
});

test("resolveUrl and objectPath", () => {
  assert.equal(resolveUrl("https://example.com/a/b.css", "../c.png"), "https://example.com/c.png");
  assert.equal(objectPath("abcdef"), path.join("objects", "ab", "abcdef"));
  assert.equal(sha256Hex(Buffer.from("x")).length, 64);
});

test("extractCssReferences finds imports and assets but skips data", () => {
  const css = `@import "nested.css"; @import url("other.css") screen; a { background: url("/bg.png"); } i { background: url(data:image/png;base64,AAAA); }`;
  const {imports, assets} = extractCssReferences(css, "https://example.com/css/main.css");
  assert.deepEqual(imports.map((entry) => entry.url), [
    "https://example.com/css/nested.css",
    "https://example.com/css/other.css",
  ]);
  assert.deepEqual(assets.map((entry) => entry.url), ["https://example.com/bg.png"]);
});

test("extractHtmlReferences finds link, script, img, srcset, and inline style urls", () => {
  const html = `<link rel="stylesheet" href="/s.css"><script src="a.js"></script><img src="/i.png" srcset="/i2.png 2x"><div style="background:url('/b.png')"></div>`;
  const refs = extractHtmlReferences(html, "https://example.com/page");
  assert.deepEqual(refs, [
    "https://example.com/s.css",
    "https://example.com/a.js",
    "https://example.com/i.png",
    "https://example.com/i2.png",
    "https://example.com/b.png",
  ]);
});

test("rewriteCssReferences and rewriteHtmlReferences localize relative and absolute urls", () => {
  const map = new Map([
    ["https://example.com/bg.png", "/o/deadbeef"],
    ["https://example.com/css/nested.css", "/o/cafe"],
  ]);
  assert.equal(
    rewriteCssReferences("a{background:url('https://example.com/bg.png')}", "https://example.com/css/main.css", map),
    'a{background:url("/o/deadbeef")}',
  );
  assert.equal(
    rewriteCssReferences('@import "nested.css";', "https://example.com/css/main.css", map),
    '@import url("/o/cafe");',
  );
  assert.equal(
    rewriteHtmlReferences('<img src="/bg.png">', "https://example.com/page", map),
    '<img src="/o/deadbeef">',
  );
});

async function fixtureServer() {
  const routes = {
    "/index.html": {
      type: "text/html",
      body: `<html><head><link rel="stylesheet" href="/style.css"></head><body><img src="/img.png"></body></html>`,
    },
    "/style.css": {type: "text/css", body: `@import "nested.css"; body { background: url("/bg.png"); }`},
    "/nested.css": {type: "text/css", body: `p { color: red; }`},
    "/img.png": {type: "image/png", body: Buffer.from([0x89, 0x50, 0x4e, 0x47])},
    "/bg.png": {type: "image/png", body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01])},
  };
  const hits = [];
  const server = http.createServer((request, response) => {
    hits.push(request.url);
    if (request.url === "/r") {
      response.statusCode = 302;
      response.setHeader("location", "/style.css");
      response.end();
      return;
    }
    const route = routes[request.url];
    if (!route) {
      response.statusCode = 404;
      response.end("no");
      return;
    }
    response.statusCode = 200;
    response.setHeader("content-type", route.type);
    response.end(route.body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const {port} = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("acquire is once-then-local and replay serves rewritten content", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "theme-lab-ref-"));
  const fixture = await fixtureServer();
  t.after(async () => {
    await fixture.close();
    await fs.rm(dir, {recursive: true, force: true});
  });

  const cache = new ReferenceCache({cacheDir: dir, allowPrivate: true});
  const first = await cache.acquire(`${fixture.origin}/index.html`);
  assert.ok(first.asset_count >= 4);
  assert.ok(cache.externalRequests >= 4);
  assert.equal(first.external_requests, cache.externalRequests);

  const requestsAfterFirst = fixture.hits.length;
  const second = await cache.acquire(`${fixture.origin}/index.html`);
  assert.equal(second.external_requests, 0);
  assert.equal(fixture.hits.length, requestsAfterFirst, "second acquire must not hit the network");

  const replay = await startReferenceReplay({cache, rootUrl: `${fixture.origin}/index.html`});
  t.after(() => replay.close());
  const html = await (await fetch(replay.entryUrl)).text();
  assert.match(html, /\/o\/[0-9a-f]{64}/u);
  assert.doesNotMatch(html, /https:\/\/example\.com/u);
  assert.ok(!html.includes(fixture.origin), "rewritten HTML must not reference the fixture origin");

  const cssDigest = html.match(/\/o\/([0-9a-f]{64})/u)[1];
  const css = await (await fetch(`${replay.origin}/o/${cssDigest}`)).text();
  assert.match(css, /url\("\/o\/[0-9a-f]{64}"\)/u);
});

test("offline acquire fails closed on an empty cache", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "theme-lab-ref-off-"));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const cache = new ReferenceCache({cacheDir: dir, allowPrivate: true});
  await assert.rejects(
    () => cache.acquire("http://127.0.0.1:9/none.html", {offline: true}),
    (error) => error instanceof ThemeLabError && error.code === "reference_offline_miss",
  );
});

test("redirects are followed and recorded", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "theme-lab-ref-redir-"));
  const fixture = await fixtureServer();
  t.after(async () => {
    await fixture.close();
    await fs.rm(dir, {recursive: true, force: true});
  });
  const cache = new ReferenceCache({cacheDir: dir, allowPrivate: true});
  const record = await cache.fetchRaw(`${fixture.origin}/r`);
  assert.match(record.final_url, /\/style\.css$/u);
});
