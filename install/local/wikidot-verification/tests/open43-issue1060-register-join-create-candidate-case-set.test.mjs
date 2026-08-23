import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import {
  OPEN43_ISSUE1060_CASE_IDS,
  createOpen43Issue1060RegisterJoinCreateCandidateCaseSet,
} from "../src/open43-issue1060-register-join-create-candidate-case-set.mjs";
import { canonicalJson, sha256Value } from "../src/standing-browser-parity-util.mjs";

const PAGE_ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const SITE_ID = 6000003;
const ADMIN_ID = 41;
const ELIGIBLE_ID = 42;
const REGISTERED_ID = 4242;
const RUN_ID = "candidate-run-0123456789ab";
const SUFFIX = RUN_ID.slice("candidate-run-".length);
const USERNAME = `candidate${SUFFIX}`;
const COMPONENT_SLUG = `component:open43-issue1060-${SUFFIX}`;
const CONTENT_SLUG = `open43-issue1060-${SUFFIX}`;
const CONTENT_SOURCE = "Created by the public self-join browser candidate.";
const hash = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(32);
const git = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(20);

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "issue1060-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "issue1060-fixture",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: { caddy: `sha256:${hash("4")}`, deepwell: `sha256:${hash("5")}`, files: `sha256:${hash("6")}` },
      config: { isolated_overlay_sha256: hash("7"), promotion_base_manifest_sha256: hash("8"), effective_runtime_services_sha256: hash("9") },
      endpoint: {
        scheme: "https",
        host: "scpaiueouiuiuiui.wikijump.localhost",
        port: 18443,
        resolved_addresses: ["127.0.0.1"],
        allowed_origin_set: [`${PAGE_ORIGIN}`, "https://scpaiueouiuiuiui.wjfiles.localhost:18443"].sort(),
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: { status: "sealed", manifest_sha256: hash("a"), seal_sha256: hash("b") },
  };
}

function membership(userId) {
  return { from_id: userId, dest_id: SITE_ID };
}

function pageRecord(slug, wikitext = CONTENT_SOURCE) {
  return { site_id: SITE_ID, page_id: 700 + slug.length, revision_id: 701 + slug.length, slug, wikitext };
}

function captureDocument() {
  return {
    phase: "settled",
    presence_probes: [{ id: "system-join", count: 1, rendered_count: 1 }],
  };
}

function browserLifecycle() {
  return {
    username: USERNAME,
    initial: {
      capture: { navigation_status: 200, first_paint: { document: captureDocument() }, document: captureDocument() },
      state: { join_control_count: 1, source_disclosure: false },
    },
    register: { login_form_visible: true, register_form_visible: false },
    logout: { logout_button_visible: false, session_cookie_after: true },
    login_again: { state: { login_form_visible: false } },
    session_token: "registered-session-token",
    join: {
      before: { join_control_count: 1, focused_control: true, aria_busy: false },
      after: { join_control_count: 0, aria_busy: false, error_popup_visible: false },
      mutation_request_count: 1,
      navigation_count: 1,
    },
    create: { path: `/${COMPONENT_SLUG}`, body_contains_source: true, error_popup_visible: false },
    read_back: { path: `/${COMPONENT_SLUG}`, body_contains_source: true, error_popup_visible: false },
  };
}

function runtime() {
  const members = new Map();
  const pages = new Map();
  pages.set("system:join", { site_id: SITE_ID, page_id: 1, revision_id: 2, slug: "system:join", wikitext: "[[module Join]]" });
  let joinCalls = 0;
  let createCalls = 0;
  let userDeleted = false;
  const rpc = async (method, params, { actor = "editor", sessionUserId = ADMIN_ID } = {}) => {
    if (method === "session_get") {
      const token = params[0];
      if (token === "administrator-session-token") return { user_id: ADMIN_ID };
      if (token === "eligible-session-token") return { user_id: ELIGIBLE_ID };
      if (token === "registered-session-token") return { user_id: REGISTERED_ID };
      throw new Error(`unknown session token ${token}`);
    }
    if (method === "site_get") {
      if (params.site !== "scpaiueouiuiuiui") throw new Error("wrong site");
      return { site_id: SITE_ID, slug: "scpaiueouiuiuiui" };
    }
    if (method === "page_get") return pages.get(params.page) ?? null;
    if (method === "page_view") {
      if (params.route?.slug !== "system:join" || sessionUserId !== ELIGIBLE_ID) throw new Error("wrong Join view actor or route");
      return {
        type: "found",
        data: {
          membership_actions: [{ type: "join", page_id: 1, revision_id: 2, index: 0, fingerprint: "a".repeat(32) }],
        },
      };
    }
    if (method === "user_get") {
      if (params.user !== REGISTERED_ID) return null;
      return userDeleted
        ? { user_id: REGISTERED_ID, user_type: "regular", name: USERNAME, deleted_at: "2026-08-16T00:00:00Z" }
        : { user_id: REGISTERED_ID, user_type: "regular", name: USERNAME, deleted_at: null };
    }
    if (method === "user_delete") {
      userDeleted = true;
      return null;
    }
    if (method === "member_get") return members.get(params.user_id) ?? null;
    if (method === "member_remove") {
      members.delete(params.user_id);
      return null;
    }
    if (method === "membership_join") {
      const outcome = joinCalls++ === 0 ? "joined" : "already_member";
      assert.deepEqual(params, { page_id: 1, last_revision_id: 2, action_index: 0, action_fingerprint: "a".repeat(32) });
      members.set(sessionUserId, membership(sessionUserId));
      return outcome;
    }
    if (method === "page_create") {
      if (createCalls++ !== 0) throw Object.assign(new Error("page already exists"), { rpc: { code: 102, message_sha256: hash("r") } });
      const page = pageRecord(params.slug, params.wikitext);
      pages.set(params.slug, page);
      return page;
    }
    if (method === "page_delete") {
      const byId = [...pages.values()].find((page) => page.page_id === params.page);
      if (byId !== undefined) pages.delete(byId.slug);
      return null;
    }
    throw new Error(`unexpected fake RPC method: ${method}`);
  };
  return {
    members,
    pages,
    sessionFactory() {
      return ({ candidateIdentity: identity, privateInput }) => {
        assert.equal(identity?.candidate?.endpoint?.host, "scpaiueouiuiuiui.wikijump.localhost");
        assert.equal(privateInput?.cargo_env?.DATABASE_URL, "postgres://fixture");
        const editor = privateInput?.actors?.editor;
        const selected = privateInput?.actors?.administrator ?? editor;
        const userId = selected?.user_id ?? editor?.user_id;
        const boundRpc = (method, params, options = {}) => rpc(method, params, { ...options, sessionUserId: userId });
        if (userId === ELIGIBLE_ID) return { editorUserId: ELIGIBLE_ID, editorSessionToken: "eligible-session-token", pageOrigin: PAGE_ORIGIN, privateInputIdentity: { fixture_identity_sha256: hash("e") }, requiredServiceBindings: [], rpc: boundRpc };
        if (userId === REGISTERED_ID) return { editorUserId: REGISTERED_ID, editorSessionToken: "registered-session-token", pageOrigin: PAGE_ORIGIN, privateInputIdentity: { fixture_identity_sha256: hash("e") }, requiredServiceBindings: [], rpc: boundRpc };
        return { editorUserId: ADMIN_ID, editorSessionToken: "administrator-session-token", pageOrigin: PAGE_ORIGIN, privateInputIdentity: { fixture_identity_sha256: hash("e") }, requiredServiceBindings: [], rpc: boundRpc };
      };
    },
    browserAdapter() {
      return {
        async run({ componentSlug }) {
          members.set(REGISTERED_ID, membership(REGISTERED_ID));
          pages.set(componentSlug, pageRecord(componentSlug));
          return browserLifecycle();
        },
      };
    },
    cargoRunner() {
      return async ({ commands }) => commands.map((command) => ({ command, exit_code: 0, duration_ms: 1 }));
    },
  };
}

function privateInput() {
  return {
    actors: {
      administrator: { user_id: ADMIN_ID, session_token: "administrator-session-token" },
      eligible: { user_id: ELIGIBLE_ID, session_token: "eligible-session-token" },
    },
    cargo_env: { DATABASE_URL: "postgres://fixture", CARGO_TARGET_DIR: "/tmp/fixture-target" },
  };
}

async function runFixture(t, identity, caseSet) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "issue1060-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: privateInput(),
    privateInputSha256: hash("7"),
    outputDir: path.join(root, "evidence"),
    caseSet,
    runId: RUN_ID,
    dependencies: {
      collectExecutionIdentity: async (_i, sourceFiles) => ({ schema: "fixture.execution.v1", source_files: sourceFiles }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime.v1", identity: "stable" }),
      assertStableRuntimeIdentity() {},
      createBrowserContexts() { throw new Error("the fake candidate case must not launch a browser"); },
      now: () => "2026-08-16T00:00:00.000Z",
    },
  });
}

test("issue 1060 is an executable candidate case set", async () => {
  const selected = await candidateCaseSet("open43-issue1060-register-join-create");
  assert.equal(selected.id, "open43-issue1060-register-join-create");
  assert.deepEqual(selected.caseIds, [...OPEN43_ISSUE1060_CASE_IDS]);
  assert.equal(typeof selected.prepareRun, "function");
});

test("issue 1060 executes through the shared runner and cleans its run-owned state", async (t) => {
  const state = runtime();
  const caseSet = createOpen43Issue1060RegisterJoinCreateCandidateCaseSet({
    sessionFactory: state.sessionFactory(),
    browserAdapterFactory: state.browserAdapter,
    cargoRunner: state.cargoRunner(),
  });
  const result = await runFixture(t, candidateIdentity(), caseSet);

  assert.deepEqual(result.denominator.case_ids, OPEN43_ISSUE1060_CASE_IDS);
  assert.equal(result.status, "pass");
  assert.equal(result.cleanup.public_absence_verified, true);
  assert.equal(result.resources.length, 5);
  assert.equal(result.resources.every((resource) => resource.released), true);
});

test("issue 1060 candidate verification fails closed on a stale Join-route identity", async (t) => {
  const state = runtime();
  const caseSet = createOpen43Issue1060RegisterJoinCreateCandidateCaseSet({
    sessionFactory: state.sessionFactory(),
    browserAdapterFactory: state.browserAdapter,
    cargoRunner: state.cargoRunner(),
  });
  const resources = { register(kind, identity) { return { sequence: 1, kind, identity }; } };
  const prepared = await caseSet.prepareRun({
    runId: RUN_ID,
    candidateIdentity: candidateIdentity(),
    privateInput: privateInput(),
    signal: null,
    resources,
    candidateBrowserContexts: {},
  });
  const rows = await prepared.execute();
  const joined = rows.find(({ case_id }) => case_id === "A1060_BROWSER_REGISTER_JOIN_CREATE");
  const tampered = { ...joined.observations, page: { ...joined.observations.page, join_path: "/system:join-changed" } };
  assert.throws(() => prepared.verifyCase("A1060_BROWSER_REGISTER_JOIN_CREATE", tampered), /Join route identity drifted/u);
});
