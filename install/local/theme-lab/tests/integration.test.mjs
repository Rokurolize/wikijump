// End-to-end browser integration for the theme-port loop.
//
// Everything is served from loopback fixtures; the reference stylesheet is the
// repository's checked-in Wikidot base theme, so the selector shapes are real.
// No external network is used.

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {loadChromium} from "../src/browser-lab.mjs";
import {ReferenceCache} from "../src/reference-cache.mjs";
import {startSessionServer} from "../src/session-server.mjs";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, "../../../..");
const WIKIDOT_BASE_CSS = path.join(
  REPO_ROOT,
  "framerail/static/wikidot/styles/wikidot-base-165bc434fd1d.css",
);

const CANDIDATE_HTML = `<!doctype html><html><head><link rel="stylesheet" href="/wikidot-base.css"></head>
<body><div id="header"><h1>JP</h1></div>
<div id="page-content"><div class="page-rate-widget-box"><span class="rate-points">+1</span></div>
<table class="wiki-content-table"><tr><td>x</td></tr></table></div></body></html>`;

const REFERENCE_HTML = `<!doctype html><html><head><link rel="stylesheet" href="/wikidot-base.css"><link rel="stylesheet" href="/foreign.css"></head>
<body><div id="header"><h1>Foreign</h1></div>
<div id="page-content"><div class="foreign-rate-box"><span class="rate-points">+1</span></div>
<table class="wiki-content-table"><tr><td>x</td></tr></table></div></body></html>`;

const FOREIGN_CSS = `#header h1 { color: rgb(187, 1, 17); font-size: 31px; }
.foreign-rate-box { display: inline-block; border: 1px solid rgb(187, 1, 17); }`;

const SELECTORS = ["#header h1", "#page-content", ".foreign-rate-box", ".page-rate-widget-box", "table.wiki-content-table"];

async function fixtureServer() {
  const baseCss = await fs.readFile(WIKIDOT_BASE_CSS);
  const hits = [];
  const server = http.createServer((request, response) => {
    hits.push(request.url);
    const send = (type, body) => {
      response.statusCode = 200;
      response.setHeader("content-type", type);
      response.end(body);
    };
    if (request.url === "/candidate") return send("text/html", CANDIDATE_HTML);
    if (request.url === "/reference") return send("text/html", REFERENCE_HTML);
    if (request.url === "/foreign.css") return send("text/css", FOREIGN_CSS);
    if (request.url === "/wikidot-base.css") return send("text/css", baseCss);
    response.statusCode = 404;
    response.end("no");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    hits,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withSession(t, run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "theme-lab-integration-"));
  const fixture = await fixtureServer();
  const chromium = loadChromium();
  const server = await startSessionServer({
    socketPath: path.join(dir, "session.sock"),
    chromium,
    headless: true,
    candidateUrl: `${fixture.origin}/candidate`,
    referenceAssets: new ReferenceCache({cacheDir: path.join(dir, "cache"), allowPrivate: true}),
  });
  t.after(async () => {
    await server.close().catch(() => {});
    await fixture.close();
    await fs.rm(dir, {recursive: true, force: true});
  });
  await run({session: server.session, fixture});
}

test("theme-port check maps a missing foreign selector to the SCP-JP anchor", async (t) => {
  await withSession(t, async ({session, fixture}) => {
    const verdict = await session.check({
      referenceUrl: `${fixture.origin}/reference`,
      selectors: SELECTORS,
      css: "#page-content { font-size: 15px; }",
      viewports: true,
      torture: false,
    });
    assert.equal(verdict.verdict, "fail");
    const missing = verdict.top_issues.find((issue) => issue.selector === ".foreign-rate-box");
    assert.ok(missing, "foreign rate box should be reported missing");
    assert.equal(missing.reference_role, "rating_widget");
    assert.equal(missing.suggested_candidate.selector, ".page-rate-widget-box");
    assert.ok(missing.suggested_candidate.confidence >= 0.6);
  });
});

test("theme-port check explains a computed-style delta via the cascade", async (t) => {
  await withSession(t, async ({session, fixture}) => {
    const verdict = await session.check({
      referenceUrl: `${fixture.origin}/reference`,
      selectors: SELECTORS,
      css: "#header h1 { color: rgb(0, 0, 0) !important; }",
      viewports: false,
      torture: false,
    });
    const headerColor = verdict.style_changes.find(
      (change) => change.anchor === "#header h1" && change.property === "color",
    );
    assert.ok(headerColor, "header color delta should be reported");
    assert.ok(headerColor.cascade, "delta should carry a cascade diagnosis");
    assert.equal(headerColor.cascade.status, "overridden");
    assert.equal(headerColor.cascade.winner.important, true);
    assert.equal(headerColor.cascade.winner.value, "rgb(0, 0, 0)");
  });
});

test("broken CSS canary fails closed with a viewport overflow", async (t) => {
  await withSession(t, async ({session}) => {
    const verdict = await session.check({
      css: "#page-content { width: 5000px; }",
      viewports: true,
      torture: false,
    });
    assert.equal(verdict.verdict, "fail");
    assert.ok(verdict.top_issues.some((issue) => issue.kind === "viewport_overflow"));
  });
});

test("second check is fully offline and makes no reference requests", async (t) => {
  await withSession(t, async ({session, fixture}) => {
    await session.check({referenceUrl: `${fixture.origin}/reference`, selectors: SELECTORS, viewports: false, torture: false});
    const hitsAfterFirst = fixture.hits.length;
    const second = await session.check({
      referenceUrl: `${fixture.origin}/reference`,
      referenceOffline: true,
      selectors: SELECTORS,
      viewports: false,
      torture: false,
    });
    assert.equal(fixture.hits.length, hitsAfterFirst, "offline check must not hit the fixture server");
    assert.ok(second.verdict);
  });
});
