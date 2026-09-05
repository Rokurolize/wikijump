import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import {
  OPEN43_ISSUE1029_CASE_IDS,
  createOpen43Issue1029JoinCandidateCaseSet,
} from "../src/open43-issue1029-join-candidate-case-set.mjs";
import { Open43Issue1029JoinBrowserAdapter } from "../src/open43-issue1029-join-browser-adapter.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const PAGE_ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const JOIN_PATH = "/system:join";
const PAGE_URL = `${PAGE_ORIGIN}${JOIN_PATH}`;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const hash = (character) => digest(`open43-issue1029-${character}-fixture`);
const git = (character) => digest(`open43-issue1029-${character}-git`).slice(0, 40);
const runId = () => `candidate-run-${digest("open43-issue1029-run").slice(0, 12)}`;
const actorIds = { administrator: -1, eligible: 101 };

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "issue1029-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "issue1029-fixture",
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

class FakeIssue1029State {
  member = false;
}

class FakeIssue1029Session {
  #actor;
  #state;

  constructor(actor, state) {
    this.#actor = actor;
    this.#state = state;
    this.editorUserId = actorIds[actor];
    this.editorSessionToken = `session-${actor}`;
    this.pageOrigin = PAGE_ORIGIN;
    this.privateInputIdentity = { editor_user_id: actorIds[actor], editor_session_sha256: hash(actor[0]) };
  }

  requiredServiceBindings = [];

  async rpc(method, params = {}, options = {}) {
    if (method === "session_get") return { user_id: this.editorUserId };
    if (method === "site_get") return { site_id: 7, slug: "scpaiueouiuiuiui" };
    if (method === "page_get") {
      if (params.page !== "system:join") return null;
      return { page_id: 300, site_id: 7, slug: "system:join", title: "Join this site", wikitext: "[[module Join]]" };
    }
    if (method === "member_get") return this.#state.member ? { from_id: actorIds.eligible, dest_id: 7 } : null;
    if (method === "member_remove") {
      assert.equal(this.#actor, "administrator");
      this.#state.member = false;
      return { deleted_by: actorIds.administrator };
    }
    throw new Error(`unexpected fake RPC ${this.#actor}:${method}`);
  }
}

function state({ joined = false, anonymous = false, focused = false, busy = false } = {}) {
  const busyEvents = joined ? [true] : [];
  return {
    url: PAGE_URL,
    path: JOIN_PATH,
    history_length: 2,
    join_control_count: joined ? 0 : 1,
    focused_control: focused,
    aria_busy: busy,
    busy_events: busyEvents,
    authored_join_calls: 0,
    source_disclosure: false,
  };
}

function capture() {
  const document = (phase) => ({
    phase,
    presence_probes: [{ id: "join-control", count: 1, rendered_count: 1 }],
  });
  return {
    navigation_status: 200,
    input_url: PAGE_URL,
    final_url: PAGE_URL,
    first_paint: { document: document("domcontentloaded_immediate_observation") },
    document: document("settled"),
    settled_viewport_screenshot: { path: "issue1029-settled.png", sha256: hash("e") },
    screenshot: { path: "issue1029-full.png", sha256: hash("f") },
  };
}

function fakeBrowserAdapter(membershipState) {
  return {
    async run({ pageUrl, pagePath, reset }) {
      assert.equal(pageUrl, PAGE_URL);
      assert.equal(pagePath, JOIN_PATH);
      for (const mode of ["click", "enter", "space", "repeated"]) {
        await reset();
        membershipState.member = true;
      }
      return {
        page_path: JOIN_PATH,
        initial: { capture: capture(), state: state() },
        denial: {
          before: state({ anonymous: true }),
          after: state({ anonymous: true }),
          mutation_request_count: 0,
        },
        history: {
          home: { path: "/" },
          back: { path: "/" },
          forward: state(),
        },
        operations: Object.fromEntries(
          ["click", "enter", "space", "repeated"].map((name) => [
            name,
            {
              before: state({ focused: true }),
              after: state({ joined: true }),
              mutation_request_count: 1,
            },
          ]),
        ),
      };
    },
  };
}

async function runFixture(t) {
  const membershipState = new FakeIssue1029State();
  const caseSet = createOpen43Issue1029JoinCandidateCaseSet({
    sessionFactory: ({ privateInput }) => {
      const userId = privateInput.actors.editor.user_id;
      const name = userId === actorIds.administrator ? "administrator" : "eligible";
      return new FakeIssue1029Session(name, membershipState);
    },
    browserAdapterFactory: () => fakeBrowserAdapter(membershipState),
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "issue1029-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
  return await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: {
      actors: {
        administrator: { user_id: actorIds.administrator, session_token: "session-administrator" },
        eligible: { user_id: actorIds.eligible, session_token: "session-eligible" },
      },
    },
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

test("issue 1029 executes the exact Join transitions and cleans its membership", async (t) => {
  const result = await runFixture(t);
  assert.deepEqual(result.denominator.case_ids, OPEN43_ISSUE1029_CASE_IDS);
  assert.equal(result.status, "pass");
  assert.equal(result.cleanup.public_absence_verified, true);
  assert.equal(result.resources[0].released, true);
  const receipt = JSON.parse(await fs.readFile(result.cases[0].path, "utf8"));
  assert.equal(receipt.verification.verified, true);
  assert.equal(receipt.verification.authored_join_calls, 0);
  assert.equal(receipt.verification.joined_state_hidden, true);
  assert.equal(receipt.cleanup.membership_absent, true);
});

class FakeIssue1029BrowserPage {
  #actor;
  #requestHandlers = new Set();
  #routeHandler = null;
  #url = PAGE_URL;
  #path = JOIN_PATH;
  #joinControlCount = 1;
  #focused = false;
  #ariaBusy = false;
  #busyEvents = [];

  constructor(actor) {
    this.#actor = actor;
  }

  async goto(url) {
    this.#url = url;
    this.#path = new URL(url).pathname;
  }

  locator() {
    return {
      waitFor: async () => {},
      count: async () => this.#joinControlCount,
      focus: async () => { this.#focused = true; },
      click: async () => await this.#activate(),
      press: async () => await this.#activate(),
    };
  }

  async evaluate(fn) {
    const source = fn.toString();
    if (source.includes("history.back")) {
      this.#path = "/";
      this.#url = `${PAGE_ORIGIN}/`;
      return;
    }
    if (source.includes("history.forward")) {
      this.#path = JOIN_PATH;
      this.#url = PAGE_URL;
      return;
    }
    if (source.includes("element?.click()")) {
      await this.#activate();
      await this.#activate();
      return;
    }
    return {
      url: this.#url,
      path: this.#path,
      history_length: 2,
      join_control_count: this.#joinControlCount,
      focused_control: this.#focused,
      aria_busy: this.#ariaBusy,
      busy_events: [...this.#busyEvents],
      authored_join_calls: 0,
      source_disclosure: false,
    };
  }

  on(event, handler) {
    if (event === "request") this.#requestHandlers.add(handler);
  }

  off(event, handler) {
    if (event === "request") this.#requestHandlers.delete(handler);
  }

  async route(_matcher, handler) {
    this.#routeHandler = handler;
  }

  async unroute() {
    this.#routeHandler = null;
  }

  async waitForTimeout() {}

  async waitForFunction() {
    assert.equal(this.#joinControlCount, 0);
  }

  async waitForURL() {}

  async close() {}

  async #activate() {
    if (this.#actor === "anonymous" || this.#joinControlCount === 0) return;
    const request = {
      method: () => "POST",
      url: () => `${PAGE_URL}?/membershipJoin`,
    };
    for (const handler of this.#requestHandlers) handler(request);
    this.#ariaBusy = true;
    this.#busyEvents.push(true);
    if (this.#routeHandler !== null) {
      await this.#routeHandler({
        continue: async () => {
          this.#joinControlCount = 0;
          this.#ariaBusy = false;
        },
      });
    }
  }
}

function fakeIssue1029BrowserContexts() {
  return {
    async setActiveFixture() {},
    async newCandidateContext({ storageState }) {
      const actor = storageState?.cookies?.length > 0 ? "eligible" : "anonymous";
      return {
        context: {
          async newPage() {
            return new FakeIssue1029BrowserPage(actor);
          },
        },
      };
    },
    async captureCandidateObservation() {
      return capture();
    },
  };
}

test("successful issue 1029 request observation releases its bounded timeout", async () => {
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  const tracked = new Set();
  globalThis.setTimeout = (callback, milliseconds, ...args) => {
    let timer;
    const wrapped = (...callbackArgs) => {
      tracked.delete(timer);
      return callback(...callbackArgs);
    };
    timer = nativeSetTimeout(wrapped, milliseconds, ...args);
    if (milliseconds === 300_000) tracked.add(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    tracked.delete(timer);
    return nativeClearTimeout(timer);
  };
  try {
    const adapter = new Open43Issue1029JoinBrowserAdapter({
      browserContexts: fakeIssue1029BrowserContexts(),
      storageState: () => ({cookies: [{name: "actor", value: "eligible"}], origins: []}),
    });
    const result = await adapter.run({pageUrl: PAGE_URL, pagePath: JOIN_PATH, reset: async () => {}});
    assert.equal(result.operations.click.mutation_request_count, 1);
    assert.equal(result.operations.repeated.mutation_request_count, 1);
    assert.equal(tracked.size, 0, "successful request observation left a 300-second timeout active");
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
    globalThis.clearTimeout = nativeClearTimeout;
    for (const timer of tracked) nativeClearTimeout(timer);
  }
});
