import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import {
  OPEN43_A1030_CASE_IDS,
  createOpen43A1030RateCandidateCaseSet,
} from "../src/open43-a1030-rate-candidate-case-set.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const PAGE_ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const SITE_ID = 6000003;
const ADMIN_ID = 41;
const EDITOR_ID = 42;
const RUN_ID = "candidate-run-0123456789ab";
const SUFFIX = RUN_ID.slice("candidate-run-".length);
const POINT_SLUG = `point-a1030-${SUFFIX}:holder`;
const STAR_SLUG = `star-a1030-${SUFFIX}:holder`;
const hash = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(32);
const git = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(20);

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "a1030-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "a1030-fixture",
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

function pointState(score) {
  return {
    present: true,
    busy: false,
    error_popup_visible: false,
    source_disclosure: false,
    score,
    rateup_count: 1,
    ratedown_count: 1,
    cancel_count: 1,
  };
}

function starState(score) {
  return {
    present: true,
    busy: false,
    error_popup_visible: false,
    source_disclosure: false,
    data_rating: score,
    star_image_count: 5,
    hidden_score: score,
    text_rating: score,
  };
}

function browserObservations({ forgedFailure = true } = {}) {
  return {
    point: {
      initial: pointState("0"),
      keyboard: pointState("+1"),
      repeated: pointState("+1"),
      changed: pointState("-1"),
      canceled: pointState("0"),
      reloaded: pointState("0"),
      forged: forgedFailure ? { http_status: 400, payload_type: "failure", message: "Rate action does not match the current page revision" } : { http_status: 200, payload_type: "success", message: null },
      mutation_request_count: 5,
    },
    star: {
      initial: starState("0"),
      clicked: starState("4"),
      repeated: starState("4"),
      changed: starState("3"),
      reloaded: starState("3"),
      forged: forgedFailure ? { http_status: 400, payload_type: "failure", message: "Rate action does not match the current page revision" } : { http_status: 200, payload_type: "success", message: null },
      mutation_request_count: 4,
    },
  };
}

function runtime() {
  const pages = new Map();
  const ratings = new Map();
  let pageSequence = 700;
  const rpc = async (method, params, { actor = "editor" } = {}) => {
    if (method === "session_get") {
      const token = params[0];
      if (token === "administrator-session-token") return { user_id: ADMIN_ID };
      if (token === "editor-session-token") return { user_id: EDITOR_ID };
      throw new Error(`unknown session token ${token}`);
    }
    if (method === "site_get") return { site_id: SITE_ID, slug: "scpaiueouiuiuiui" };
    if (method === "page_get") return pages.get(params.page) ?? null;
    if (method === "page_create") {
      const page = { site_id: SITE_ID, page_id: ++pageSequence, revision_id: pageSequence + 1, slug: params.slug, wikitext: params.wikitext };
      pages.set(params.slug, page);
      return page;
    }
    if (method === "category_get") return { category_id: 100 + params.category.length, slug: params.category };
    if (method === "category_update") {
      ratings.set(String(params.category), { enabled: params.rating_enabled, type: params.rating_type });
      return null;
    }
    if (method === "page_rerender") return null;
    if (method === "page_view") {
      const page = pages.get(params.route.slug);
      if (page === undefined) return { type: "NotFound", data: null };
      const plusMinus = ratings.get(String(params.route.slug.split(":", 1)[0]))?.type === "plus_minus";
      const actions = plusMinus
        ? [
            { type: "rate", value: 1, index: 0, fingerprint: hash("1").slice(0, 32) },
            { type: "rate", value: -1, index: 1, fingerprint: hash("2").slice(0, 32) },
            { type: "rate-cancel", index: 2, fingerprint: hash("3").slice(0, 32) },
          ]
        : Array.from({ length: 5 }, (_, index) => ({ type: "rate", value: index + 1, index, fingerprint: hash(String(index + 4)).slice(0, 32) }));
      return {
        type: "Found",
        data: {
          rate_actions: {
            site_id: SITE_ID,
            page_id: page.page_id,
            revision_id: page.revision_id,
            current_value: null,
            actions,
          },
        },
      };
    }
    if (method === "page_delete") {
      const byId = [...pages.values()].find((page) => page.page_id === params.page);
      if (byId !== undefined) pages.delete(byId.slug);
      return null;
    }
    throw new Error(`unexpected fake RPC method: ${method}`);
  };
  return {
    pages,
    ratings,
    sessionFactory() {
      return ({ privateInput }) => {
        const editor = privateInput?.actors?.editor;
        const selected = privateInput?.actors?.administrator ?? editor;
        const userId = selected?.user_id ?? editor?.user_id;
        if (userId === EDITOR_ID) return { editorUserId: EDITOR_ID, editorSessionToken: "editor-session-token", pageOrigin: PAGE_ORIGIN, privateInputIdentity: { fixture_identity_sha256: hash("e") }, requiredServiceBindings: [], rpc };
        return { editorUserId: ADMIN_ID, editorSessionToken: "administrator-session-token", pageOrigin: PAGE_ORIGIN, privateInputIdentity: { fixture_identity_sha256: hash("e") }, requiredServiceBindings: [], rpc };
      };
    },
    browserAdapter(options) {
      return {
        async run() {
          return browserObservations(options);
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
      editor: { user_id: EDITOR_ID, session_token: "editor-session-token" },
    },
    cargo_env: { DATABASE_URL: "postgres://fixture", CARGO_TARGET_DIR: "/tmp/fixture-target" },
  };
}

async function runFixture(t, state, browserOptions) {
  const caseSet = createOpen43A1030RateCandidateCaseSet({
    sessionFactory: state.sessionFactory(),
    browserAdapterFactory: () => state.browserAdapter(browserOptions),
    cargoRunner: state.cargoRunner(),
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "a1030-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
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

test("A1030 is an executable candidate case set", async () => {
  const selected = await candidateCaseSet("open43-a1030-rate");
  assert.equal(selected.id, "open43-a1030-rate");
  assert.deepEqual(selected.caseIds, [...OPEN43_A1030_CASE_IDS]);
  assert.equal(typeof selected.prepareRun, "function");
});

test("A1030 executes through the shared runner and cleans its run-owned pages", async (t) => {
  const state = runtime();
  const result = await runFixture(t, state, {});
  assert.deepEqual(result.denominator.case_ids, OPEN43_A1030_CASE_IDS);
  assert.equal(result.status, "pass");
  assert.equal(result.cleanup.public_absence_verified, true);
  assert.equal(result.resources.length, 2);
  assert.equal(result.resources.every((resource) => resource.released), true);
  assert.equal(state.pages.has(POINT_SLUG), false);
  assert.equal(state.pages.has(STAR_SLUG), false);
});

test("A1030 candidate verification fails closed when a forged Rate request is accepted", async (t) => {
  const state = runtime();
  await assert.rejects(
    runFixture(t, state, { forgedFailure: false }),
    /forged rate request was not rejected/u,
  );
});
