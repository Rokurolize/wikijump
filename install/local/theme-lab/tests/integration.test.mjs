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
  // This is a diagnostic loopback fixture, not source-Wikidot authority.
  // Flatten decorative remote URLs so cache acquisition itself stays local.
  const pixel='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const baseCss = (await fs.readFile(WIKIDOT_BASE_CSS,'utf8'))
    .replace(/url\(\s*(['"]?)(?:https?:)?\/\/[^)]*\)/giu,`url("${pixel}")`);
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

async function withSession(t, run, {previewClient = null} = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "theme-lab-integration-"));
  const fixture = await fixtureServer();
  const chromium = loadChromium();
  const server = await startSessionServer({
    socketPath: path.join(dir, "session.sock"),
    chromium,
    headless: true,
    candidateUrl: `${fixture.origin}/candidate`,
    referenceAssets: new ReferenceCache({cacheDir: path.join(dir, "cache"), allowPrivate: true}),
    previewClient,
  });
  t.after(async () => {
    await server.close().catch(() => {});
    await fixture.close();
    await fs.rm(dir, {recursive: true, force: true});
  });
  await run({session: server.session, fixture});
}

test("theme-port check fails on a missing included component in the rendered preview", async (t) => {
  const previewClient = {
    preview: async () => ({
      body: '<span class="theme-lab-jp-font-probe">日本語の字形</span><div class="error-block">Included page "component:theme-squares" does not exist (create it now)</div>',
      styles: [],
      legacy_actions: [],
      membership_actions: [],
    }),
  };
  await withSession(t, async ({session}) => {
    const verdict = await session.check({
      siteId: 6000003,
      title: "Theme preview include diagnostic",
      wikitext: '[[include :scp-jp:component:theme-squares]]',
      viewports: false,
      torture: false,
    });
    assert.equal(verdict.verdict, "fail");
    assert.equal(verdict.font_diagnostics.status, "measured");
    assert.equal(verdict.font_diagnostics.evidence, "japanese-glyph-specimen");
    assert.ok(verdict.font_diagnostics.fonts.some((font) => font.glyph_count > 0));
    assert.ok(verdict.top_issues.some((issue) => issue.kind === "unresolved_include" && issue.include === "component:theme-squares"));
    assert.deepEqual(verdict.next_actions, [{
      kind: "resolve_candidate_include",
      include: "component:theme-squares",
      evidence: {preview_error: 'Included page "component:theme-squares" does not exist (create it now)'},
    }]);
  }, {previewClient});
});

test("theme-port check retains a target-only selector suggestion without a parity action", async (t) => {
  await withSession(t, async ({session, fixture}) => {
    const verdict = await session.check({
      referenceUrl: `${fixture.origin}/reference`,
      selectors: SELECTORS,
      css: "#page-content { font-size: 15px; }",
      viewports: true,
      torture: false,
    });
    assert.equal(verdict.verdict, "fail");
    assert.equal(verdict.port_decision.verdict, "inconclusive");
    const missing = verdict.top_issues.find((issue) => issue.selector === ".foreign-rate-box");
    assert.ok(missing, "foreign rate box should be reported missing");
    assert.equal(missing.reference_role, "rating_widget");
    assert.equal(missing.suggested_candidate.selector, ".page-rate-widget-box");
    assert.ok(missing.suggested_candidate.confidence >= 0.6);
    assert.equal(missing.parity_review.decision_authority, "SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY");
    assert.equal(missing.parity_review.port_conclusion_eligible, false);
    assert.ok(verdict.target_acceptance.findings.some((issue) => issue.selector === ".foreign-rate-box"));
    assert.ok(!verdict.next_actions.some((action) => action.kind === "rewrite_selector"));
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
    const headerColor = verdict.target_acceptance.style_changes.find(
      (change) => change.anchor === "#header h1" && change.property === "color",
    );
    assert.ok(headerColor, "header color delta should be reported");
    assert.ok(headerColor.cascade, "delta should carry a cascade diagnosis");
    assert.equal(headerColor.decision_authority, "SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY");
    assert.equal(headerColor.port_conclusion_eligible, false);
    assert.ok(!verdict.style_changes.some((change) => change.anchor === "#header h1" && change.property === "color"));
    assert.equal(headerColor.cascade.status, "overridden");
    assert.equal(headerColor.cascade.winner.important, true);
    assert.equal(headerColor.cascade.winner.value, "rgb(0, 0, 0)");
  });
});

test("iteration-mode check keeps local target comparison and explicitly defers full acceptance", async (t) => {
  const previewClient = {preview: async () => ({body: '<span class="theme-lab-jp-font-probe">日本語の字形</span><div id="iteration-content">theme DOM</div>', styles: [], legacy_actions: [], membership_actions: []})};
  await withSession(t, async ({session, fixture}) => {
    const verdict = await session.check({
      siteId: 6000003,
      title: "Fast theme CSS iteration",
      wikitext: "日本語の反復プレビュー",
      css: "#page-content { color: rgb(1, 2, 3); }",
      referenceUrl: `${fixture.origin}/reference`,
      selectors: SELECTORS,
      iteration: true,
      viewports: true,
      torture: true,
      visual: true,
    });
    assert.equal(verdict.verification_scope.mode, "iteration");
    assert.ok(verdict.target_acceptance.style_changes.some((change) => change.property === "color"));
    assert.ok(verdict.target_acceptance.style_changes.every((change) => change.decision_authority === "SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY"));
    assert.equal(verdict.viewport_status, null);
    assert.equal(verdict.torture, null);
    assert.equal(verdict.interaction_diagnostics, null);
    assert.equal(verdict.visual, null);
    assert.deepEqual(verdict.verification_scope.deferred, ["all viewports", "torture", "widget interactions", "visual screenshots"]);
    const cssOnly = await session.check({
      css: "#iteration-content { color: rgb(4, 5, 6); }",
      referenceUrl: `${fixture.origin}/reference`,
      selectors: SELECTORS,
      referenceOffline: true,
      iteration: true,
    });
    assert.equal(cssOnly.timing_ms.preview_ms, undefined);
    assert.equal((await session.probe({selector: "#iteration-content", property: "display"})).matched, 1,
      "CSS-only iterations keep the current preview DOM live");
  }, {previewClient});
});

test("broken CSS canary fails local acceptance without certifying a parity mismatch", async (t) => {
  await withSession(t, async ({session}) => {
    const verdict = await session.check({
      css: "#page-content { width: 5000px; }",
      viewports: true,
      torture: false,
    });
    assert.equal(verdict.verdict, "fail");
    assert.equal(verdict.overall_acceptance.status, "fail");
    assert.equal(verdict.port_decision.verdict, "pass");
    assert.equal(verdict.target_acceptance.status, "fail");
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
