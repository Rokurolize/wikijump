import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { createOpen43AuthoringHistoryCandidateCaseSet } from "../src/open43-authoring-history-candidate-case-set.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const hash = (value) => value.repeat(64);
const PAGE_ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const LONG_LINE = "L".repeat(8192);

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: {
      seal_sha256: hash("b"),
      verdict_sha256: hash("c"),
      final_images_sha256: hash("d"),
    },
    candidate: {
      owner: "candidate-case-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-candidate-case-fixture",
      port_443_published: false,
      wikijump_commit: "1".repeat(40),
      wikijump_tree: "2".repeat(40),
      ftml_sha: "3".repeat(40),
      profile: "production-build",
      source_clean: true,
      images: { caddy: `sha256:${hash("e")}` },
      config: {
        isolated_overlay_sha256: hash("f"),
        promotion_base_manifest_sha256: hash("0"),
        effective_runtime_services_sha256: hash("4"),
      },
      endpoint: {
        scheme: "https",
        host: "scpaiueouiuiuiui.wikijump.localhost",
        port: 18443,
        resolved_addresses: ["127.0.0.1"],
        allowed_origin_set: [
          "https://scpaiueouiuiuiui.wikijump.localhost:18443",
          "https://scpaiueouiuiuiui.wjfiles.localhost:18443",
        ],
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: {
      status: "sealed",
      manifest_sha256: hash("5"),
      seal_sha256: hash("6"),
    },
  };
}

function fakeSession(calls, state) {
  let nextRevisionId = 200;
  return {
    editorUserId: -1,
    editorSessionToken: "editor-session",
    pageOrigin: PAGE_ORIGIN,
    requiredServiceBindings: [],
    privateInputIdentity: { editor_session_sha256: hash("7") },
    async rpc(method, params, options) {
      calls.push({ kind: "rpc", method, params, options });
      if (method === "site_get") return { site_id: 99, slug: "scpaiueouiuiuiui" };
      if (method === "page_get") {
        const page = [...state.pages.values()].find((value) => value.slug === params.page || value.page_id === params.page);
        return page === undefined ? null : { ...page };
      }
      if (method === "page_create") {
        const page = { page_id: 100, revision_id: nextRevisionId++, revision_number: 0, slug: params.slug };
        state.pages.set(page.slug, page);
        return { ...page };
      }
      if (method === "page_edit") {
        const page = [...state.pages.values()].find((value) => value.page_id === params.page);
        Object.assign(page, { revision_id: nextRevisionId++, revision_number: page.revision_number + 1 });
        return { ...page };
      }
      if (method === "page_revision_diff") return {
        site_id: 99,
        page_id: params.page_id,
        from_revision_number: 0,
        to_revision_number: 2,
        lines: [
          { kind: "unchanged", text: "first line" },
          { kind: "removed", text: "old source only" },
          { kind: "added", text: "final line" },
        ],
      };
      if (method === "page_delete") {
        const page = [...state.pages.values()].find((value) => value.page_id === params.page);
        if (page) state.pages.delete(page.slug);
        return null;
      }
      if (method === "user_get") return { user_id: -1, user_type: "regular", locales: [...state.locales] };
      if (method === "user_edit") {
        assert.equal(params.user, -1);
        state.locales = [...params.locales];
        return { user_id: -1, user_type: "regular", locales: [...state.locales] };
      }
      throw new Error(`unexpected RPC ${method}`);
    },
    async ajaxModuleRequest(fields, options) {
      calls.push({ kind: "ajax", fields, options });
      return {
        http_status: 200,
        response_body_size: 32,
        response_body_sha256: hash("8"),
        payload: { status: "ok", body: "<history>public</history>" },
      };
    },
  };
}

class FakeResponse {
  constructor(url, status, body, method = "GET") {
    this.responseUrl = url;
    this.responseStatus = status;
    this.body = body;
    this.method = method;
  }

  status() { return this.responseStatus; }
  url() { return this.responseUrl; }
  request() { return { method: () => this.method, url: () => this.responseUrl }; }
  async text() { return this.body; }
}

class FakePage {
  constructor({ authenticated, state }) {
    this.authenticated = authenticated;
    this.state = state;
    this.currentUrl = "about:blank";
    this.history = [this.currentUrl];
    this.historyIndex = 0;
    this.inputValue = "";
    this.listeners = new Set();
    this.responseWaiters = [];
  }

  async goto(url) {
    this.currentUrl = !this.authenticated && new URL(url).pathname === "/-/settings"
      ? new URL("/-/login", PAGE_ORIGIN).href
      : url;
    this.history.splice(this.historyIndex + 1);
    this.history.push(this.currentUrl);
    this.historyIndex = this.history.length - 1;
    if (this.authenticated && new URL(this.currentUrl).pathname === "/-/settings") this.inputValue = this.state.locales.join(" ");
    return new FakeResponse(this.currentUrl, 200, "ok");
  }

  url() { return this.currentUrl; }

  async evaluate(_callback, argument) {
    if (argument.operation === "history-diff-workflow") return {
      initial_selection: { from: String(argument.fromRevisionNumber), to: String(argument.toRevisionNumber) },
      swapped_selection: { from: String(argument.toRevisionNumber), to: String(argument.fromRevisionNumber) },
      loading_observed: true,
      focus_before: true,
      focus_after: true,
      lines: [
        { kind: "removed", text: "first line" },
        { kind: "added", text: "final line" },
        { kind: "unchanged", text: LONG_LINE },
        { kind: "unchanged", text: "" },
      ],
      unsafe_element_count: 0,
    };
    if (argument.operation === "missing-revision-probe") return { status: 200, body_size: 12, body_sha256: hash("a"), leaked_markup: false };
    if (argument.operation === "history-fail-closed-workflow") return { loading_observed: true, result_count: 0, error_visible: false, error_text_sha256_input: "", hidden_source_present: false, unsafe_element_count: 0 };
    if (argument.operation === "settings-state") return { form_count: 1, input_count: 1, input_value: this.inputValue, save_count: 1, cancel_count: 1 };
    if (argument.operation === "add-submitted-user") {
      this.submittedUser = 999;
      return undefined;
    }
    throw new Error(`unexpected browser operation ${argument.operation}`);
  }

  async fill(selector, value) {
    assert.equal(selector, "#user-display-locales");
    this.inputValue = value;
  }

  async click(selector) {
    if (selector.endsWith(".button-cancel")) {
      this.inputValue = this.state.locales.join(" ");
      return;
    }
    assert.equal(selector, "#user-settings-form .button-save");
    const url = new URL("/-/settings?/display", PAGE_ORIGIN).href;
    const body = new URLSearchParams({ locales: this.inputValue });
    if (this.submittedUser !== undefined) body.set("user", String(this.submittedUser));
    const request = { method: () => "POST", url: () => url, postData: () => body.toString() };
    for (const listener of this.listeners) listener(request);
    const parsed = [...new Set(this.inputValue.replaceAll("_", "-").replaceAll(",", " ").split(/\s+/u).filter(Boolean))];
    const response = new FakeResponse(url, parsed.length === 0 ? 400 : 200, parsed.length === 0 ? "invalid" : "saved", "POST");
    if (parsed.length > 0) this.state.locales = parsed;
    for (const waiter of this.responseWaiters.splice(0)) {
      if (waiter.predicate(response)) waiter.resolve(response);
      else waiter.reject(new Error("fake response did not match"));
    }
  }

  waitForResponse(predicate) {
    return new Promise((resolve, reject) => this.responseWaiters.push({ predicate, resolve, reject }));
  }

  async reload() {
    this.inputValue = this.state.locales.join(" ");
    return new FakeResponse(this.currentUrl, 200, "ok");
  }

  async goBack() {
    this.historyIndex -= 1;
    this.currentUrl = this.history[this.historyIndex];
    return new FakeResponse(this.currentUrl, 200, "ok");
  }

  async goForward() {
    this.historyIndex += 1;
    this.currentUrl = this.history[this.historyIndex];
    return new FakeResponse(this.currentUrl, 200, "ok");
  }

  async waitForSelector() {}
  on(name, listener) { assert.equal(name, "request"); this.listeners.add(listener); }
  off(name, listener) { assert.equal(name, "request"); this.listeners.delete(listener); }
  async close() {}
}

function fakeCapture(url, label, index) {
  const artifact = (kind, digest) => ({ path: `/tmp/${label}-${index}-${kind}.png`, sha256: hash(digest) });
  return {
    schema: "wikijump_local_lab.standing_browser_parity_capture.v2",
    input_url: url,
    final_url: url,
    navigation_status: 200,
    failures: [],
    request_gate_aborts: [],
    first_paint: { document: { phase: "domcontentloaded_immediate_observation" }, screenshot: artifact("initial", "a") },
    document: { phase: "settled" },
    settled_viewport_screenshot: artifact("settled", "b"),
    screenshot: artifact("full", "c"),
  };
}

function fakeBrowserOwner(calls, state) {
  return {
    setActiveFixture(fixtureId) { calls.push({ kind: "fixture", fixtureId }); },
    async newCandidateContext({ storageState }) {
      const authenticated = storageState?.cookies?.some(({ name }) => name === "wikijump_token") === true;
      const context = {
        async newPage() { return new FakePage({ authenticated, state }); },
        request: {
          async post(url) { return new FakeResponse(url, 403, "cross-site origin rejected", "POST"); },
        },
      };
      return { context, environment: { browser: "fake" } };
    },
    async captureCandidateObservation({ page, url, label, index, navigate }) {
      if (navigate) await navigate({ page, url, timeoutMs: 300_000 });
      return fakeCapture(url, label, index);
    },
    async close() { return { browser_context_count: 3, browser_environments: [], request_gate: null }; },
  };
}

test("candidate registry executes the unblocked #1063 source, diff, and settings rows", async (t) => {
  const caseSet = await candidateCaseSet("open43-authoring-history");
  assert.equal(caseSet.id, "open43-authoring-history");
  assert.deepEqual(caseSet.caseIds, [
    "A1063_EXACT_PUBLIC_SOURCE_CANDIDATE",
    "A1063_DIFF_BROWSER_WORKFLOW",
    "A1063_SETTINGS_BROWSER_WORKFLOW",
  ]);
  assert.equal(typeof caseSet.prepareRun, "function");

  const calls = [];
  const state = { pages: new Map(), locales: ["en-US"] };
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "open43-history-case-"));
  t.after(() => fs.rm(outputRoot, { recursive: true, force: true }));
  const outputDir = path.join(outputRoot, "evidence");
  await runCandidateCaseSet({
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: sha256Value(candidateIdentity()),
    privateInput: { secret: "test-only" },
    privateInputSha256: hash("9"),
    outputDir,
    caseSet: createOpen43AuthoringHistoryCandidateCaseSet({ sessionFactory: () => fakeSession(calls, state) }),
    dependencies: {
      collectExecutionIdentity: async () => ({ schema: "fixture.execution_identity.v1" }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime_identity.v1", stable: true }),
      assertStableRuntimeIdentity: () => {},
      createBrowserContexts: async () => fakeBrowserOwner(calls, state),
      runId: () => "candidate-case-0123456789ab",
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });
  const aggregate = JSON.parse(await fs.readFile(path.join(outputDir, "candidate-case-receipt.json"), "utf8"));
  const plan = JSON.parse(await fs.readFile(path.join(outputDir, "run-plan.json"), "utf8"));
  assert.equal(aggregate.denominator.count, 3);
  assert.deepEqual(aggregate.denominator.case_ids, caseSet.caseIds);
  assert.deepEqual(plan.case_set_plan.excluded_claims, [
    "A1063_BREADCRUMB_SERVED_CANDIDATE",
    "A1063_LEGACY_AUTHORING_PRESENTATION",
    "A1063_FULL_BREADCRUMB_LIVE_BOUNDARY",
  ]);
  assert.equal(calls.filter((call) => call.kind === "rpc" && call.method === "page_edit").length, 2);
  assert.equal(calls.some((call) => call.kind === "rpc" && call.method === "page_revision_diff"), true);
  assert.deepEqual(calls.filter((call) => call.kind === "ajax").map((call) => call.fields.moduleName), [
    "history/PageRevisionListModule",
    "history/PageSourceModule",
    "history/PageVersionModule",
  ]);
  assert.deepEqual(calls.filter((call) => call.kind === "fixture").map(({ fixtureId }) => fixtureId), [
    "A1063_DIFF_BROWSER_WORKFLOW",
    "A1063_SETTINGS_BROWSER_WORKFLOW",
  ]);
  assert.equal(calls.some((call) => call.kind === "rpc" && call.method === "user_edit" && call.params.user === -1 && call.params.locales[0] === "en-US"), true);
  assert.equal(calls.some((call) => call.kind === "rpc" && call.method === "page_delete"), true);
  assert.equal(state.pages.size, 0);
  assert.deepEqual(state.locales, ["en-US"]);
});
