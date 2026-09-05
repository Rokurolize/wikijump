import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import {
  OPEN43_ISSUE1041_CASE_IDS,
  createOpen43Issue1041LifecycleCandidateCaseSet,
} from "../src/open43-issue1041-lifecycle-candidate-case-set.mjs";
import { waitForIssue1041ActionPageStable } from "../src/open43-issue1041-lifecycle-browser-adapter.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const PAGE_ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const RUN_SUFFIX = digest("open43-issue1041-run").slice(0, 12);
const PAGE_PATH = `/open43-issue1041-${RUN_SUFFIX}`;
const PAGE_URL = `${PAGE_ORIGIN}${PAGE_PATH}`;
const EDIT_PATH = `${PAGE_PATH}/edit`;
const EDIT_URL = `${PAGE_ORIGIN}${EDIT_PATH}`;
const hash = (character) => digest(`open43-issue1041-${character}-fixture`);
const git = (character) => digest(`open43-issue1041-${character}-git`).slice(0, 40);
const runId = () => `candidate-run-${digest("open43-issue1041-run").slice(0, 12)}`;

test("issue 1041 action-page settling rejects a transient editor disappearance", async () => {
  const previousDocument = globalThis.document;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  let frame = 0;
  let attempts = 0;
  const editorCounts = [0, 1, 1, 0, 0, 0, 0, 0];
  globalThis.document = {
    querySelectorAll(selector) {
      if (selector === 'a.wiki-standalone-button[href="javascript:;"]') return Array.from({ length: 5 });
      if (selector === "#editor") return Array.from({ length: editorCounts[Math.min(frame, editorCounts.length - 1)] });
      return [];
    },
  };
  globalThis.requestAnimationFrame = (callback) => {
    frame += 1;
    callback(frame * 16);
  };
  const page = {
    async waitForFunction(callback, argument) {
      for (let retry = 0; retry < 12; retry += 1) {
        attempts += 1;
        if (await callback(argument)) return;
        frame += 1;
      }
      throw new Error("fake waitForFunction never observed stable state");
    },
  };
  try {
    await waitForIssue1041ActionPageStable(page, 1_000);
    assert.ok(attempts > 1, "the transient editor disappearance must not satisfy the settling predicate");
    assert.ok(frame >= 6, "the stable state must survive three consecutive animation frames");
  } finally {
    globalThis.document = previousDocument;
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  }
});

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "issue1041-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "issue1041-fixture",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: { caddy: `sha256:${hash("4")}`, deepwell: `sha256:${hash("5")}` },
      config: { isolated_overlay_sha256: hash("6"), promotion_base_manifest_sha256: hash("7"), effective_runtime_services_sha256: hash("8") },
      endpoint: {
        scheme: "https",
        host: "scpaiueouiuiuiui.wikijump.localhost",
        port: 18443,
        resolved_addresses: ["127.0.0.1"],
        allowed_origin_set: [PAGE_ORIGIN, "https://scpaiueouiuiuiui.wjfiles.localhost:18443"].sort(),
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: { status: "sealed", manifest_sha256: hash("9"), seal_sha256: hash("0") },
  };
}

class Fake1041State {
  page = null;
  nextPageId = 501;
  nextRevisionId = 21;
}

class Fake1041Session {
  constructor(state) {
    this.state = state;
    this.pageOrigin = PAGE_ORIGIN;
    this.privateInputIdentity = {
      administrator_user_id: 7,
      non_admin_user_id: 8,
      administrator_session_sha256: hash("s"),
      non_admin_session_sha256: hash("t"),
    };
  }

  requiredServiceBindings = [];

  storageState(actor) {
    return {
      cookies: [{ name: "wikijump_token", value: `session-${actor}`, url: PAGE_ORIGIN, httpOnly: true, secure: true, sameSite: "Lax" }],
      origins: [],
    };
  }

  async verifyActorSessions() {
    return { administrator_user_id: 7, non_admin_user_id: 8, expired_session: null };
  }

  async rpc(method, params = {}, options = {}) {
    if (method === "site_get") return { site_id: 7, slug: "scpaiueouiuiuiui" };
    if (method === "page_get") return structuredClone(this.state.page);
    if (method === "page_edit_permission") return { can_edit: options.actor === "administrator" };
    if (method === "page_create") {
      this.state.page = {
        page_id: this.state.nextPageId++,
        site_id: params.site_id,
        revision_id: this.state.nextRevisionId++,
        slug: params.slug,
        title: params.title,
        wikitext: params.wikitext,
        tags: structuredClone(params.tags),
      };
      return structuredClone(this.state.page);
    }
    if (method === "page_delete") {
      assert.equal(options.cleanup, true);
      this.state.page = null;
      return null;
    }
    throw new Error(`unexpected fake RPC: ${method}`);
  }
}

function pageState(overrides = {}) {
  return {
    url: PAGE_URL,
    path: PAGE_PATH,
    history_length: 3,
    standalone_button_count: 5,
    editor_count: 0,
    action_area_visible: false,
    source_pane_visible: false,
    history_pane_visible: false,
    error_popup_visible: false,
    focused_control: false,
    any_aria_busy: false,
    busy_events: [],
    print_pending: 0,
    source_disclosure: false,
    ...overrides,
  };
}

function editState(overrides = {}) {
  return {
    url: EDIT_URL,
    path: EDIT_PATH,
    history_length: 3,
    standalone_button_count: 0,
    editor_count: 1,
    action_area_visible: false,
    source_pane_visible: false,
    history_pane_visible: false,
    error_popup_visible: false,
    focused_control: false,
    any_aria_busy: false,
    busy_events: [{ label: "Edit page here", busy: true }],
    print_pending: 0,
    source_disclosure: false,
    ...overrides,
  };
}

function capture() {
  const document = (phase) => ({
    phase,
    presence_probes: [{ id: "standalone-actions", count: 5, rendered_count: 5 }],
  });
  return {
    navigation_status: 200,
    input_url: PAGE_URL,
    final_url: PAGE_URL,
    first_paint: { document: document("domcontentloaded_immediate_observation") },
    document: document("settled"),
    settled_viewport_screenshot: { path: "issue1041-settled.png", sha256: hash("e") },
    screenshot: { path: "issue1041-full.png", sha256: hash("f") },
  };
}

function editOperation() {
  return {
    before: pageState({ focused_control: true }),
    during: pageState({ focused_control: true, any_aria_busy: true, busy_events: [{ label: "Edit page here", busy: true }] }),
    after: editState({ history_length: 4 }),
    mutation_request_count: 1,
  };
}

function paneOperation(label, kind) {
  return {
    before: pageState({ focused_control: true }),
    after: pageState({
      action_area_visible: true,
      ...(kind === "history"
        ? { history_pane_visible: true }
        : { source_pane_visible: true, source_disclosure: true }),
      busy_events: [{ label, busy: true }, { label, busy: false }],
    }),
    mutation_request_count: 0,
  };
}

function printOperation() {
  return {
    before: pageState({ focused_control: true }),
    during: pageState({ any_aria_busy: true, print_pending: 1 }),
    independent: pageState({
      any_aria_busy: true,
      print_pending: 1,
      action_area_visible: true,
      source_pane_visible: true,
      source_disclosure: true,
      busy_events: [
        { label: "Print this page", busy: true },
        { label: "view source", busy: true },
        { label: "view source", busy: false },
      ],
    }),
    after: pageState({
      action_area_visible: true,
      source_pane_visible: true,
      source_disclosure: true,
      busy_events: [
        { label: "Print this page", busy: true },
        { label: "view source", busy: true },
        { label: "view source", busy: false },
        { label: "Print this page", busy: false },
      ],
    }),
    mutation_request_count: 0,
  };
}

function setTagsOperation() {
  return {
    before: pageState({ focused_control: true }),
    after: pageState({ busy_events: [{ label: "Apply tags", busy: true }] }),
    mutation_request_count: 1,
    navigation_count: 1,
  };
}

function setTagsDenial() {
  return {
    before: pageState({ focused_control: true }),
    after: pageState({
      error_popup_visible: true,
      busy_events: [{ label: "Apply tags", busy: true }, { label: "Apply tags", busy: false }],
    }),
    mutation_request_count: 1,
    navigation_count: 0,
  };
}

function fakeBrowserAdapter(state) {
  return {
    async run({ pageUrl, pagePath }) {
      assert.equal(pageUrl, PAGE_URL);
      assert.equal(pagePath, PAGE_PATH);
      state.page.tags = ["candidate"];
      state.page.revision_id = state.nextRevisionId++;
      return {
        initial: { capture: capture(), state: pageState() },
        edit: {
          click: editOperation(),
          keyboard: editOperation(),
          double: editOperation(),
          back_forward: { home: { path: "/" }, back: pageState(), forward: editState() },
        },
        history: { click: paneOperation("history", "history") },
        source: {
          click: paneOperation("view source", "source"),
          keyboard: paneOperation("view source", "source"),
        },
        print: { hold: printOperation() },
        set_tags: { click: setTagsOperation(), keyboard: setTagsOperation(), double: setTagsOperation() },
        set_tags_error: { non_editable_member: setTagsDenial() },
      };
    },
  };
}

async function runFixture(t) {
  const state = new Fake1041State();
  const caseSet = createOpen43Issue1041LifecycleCandidateCaseSet({
    sessionFactory: () => new Fake1041Session(state),
    browserAdapterFactory: () => fakeBrowserAdapter(state),
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "issue1041-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
  return await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: { fixture: "private" },
    privateInputSha256: hash("7"),
    outputDir: path.join(root, "evidence"),
    caseSet,
    runId: runId(),
    dependencies: {
      collectExecutionIdentity: async (_identity, sourceFiles) => ({ schema: "fixture.execution.v1", source_files: sourceFiles }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime.v1", identity: "stable" }),
      assertStableRuntimeIdentity(before, after) { assert.deepEqual(before, after); },
      createBrowserContexts() { throw new Error("the fake candidate case must not launch a browser"); },
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });
}

test("issue 1041 executes the exact standalone action lifecycle and cleans its run-owned page", async (t) => {
  const result = await runFixture(t);
  assert.deepEqual(result.denominator.case_ids, OPEN43_ISSUE1041_CASE_IDS);
  assert.equal(result.status, "pass");
  assert.equal(result.cleanup.public_absence_verified, true);
  assert.equal(result.resources[0].released, true);
  const receipt = JSON.parse(await fs.readFile(result.cases[0].path, "utf8"));
  assert.equal(receipt.verification.verified, true);
  assert.deepEqual(receipt.verification.controls, ["edit", "history", "source", "print", "set-tags"]);
  assert.deepEqual(receipt.verification.tags_after_set_tags, ["candidate"]);
  assert.equal(receipt.verification.error_popup_verified, true);
  assert.equal(receipt.verification.independent_buttons_verified, true);
  assert.equal(receipt.cleanup.page_absent, true);
});
