import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import {
  OPEN43_MEMBERSHIP_JOIN_CASE_IDS,
  createOpen43MembershipJoinCandidateCaseSet,
} from "../src/open43-membership-join-candidate-case-set.mjs";

const hash = (character) => character.repeat(64);
const git = (character) => character.repeat(40);
const joinBody = '<div class="join-box"><a href="javascript:;" onclick="WIKIDOT.page.listeners.join(event, \'unified\')">Join</a></div>';
const fingerprint = "1".repeat(32);
const actorIds = { administrator: -1, eligible: 101, pending: 102, banned: 103 };

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-membership-join-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-open43-membership-join-fixture",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: { caddy: `sha256:${hash("4")}` },
      config: {
        isolated_overlay_sha256: hash("5"),
        promotion_base_manifest_sha256: hash("6"),
        effective_runtime_services_sha256: hash("7"),
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
    evidence: { status: "sealed", manifest_sha256: hash("8"), seal_sha256: hash("9") },
  };
}

class FakeMembershipState {
  pages = new Map();
  member = false;
  nextPageId = 11;
  nextRevisionId = 21;
}

class FakeMembershipSession {
  #actor;
  #events = [];
  #state;

  constructor(actor, state) {
    this.#actor = actor;
    this.#state = state;
    this.editorUserId = actorIds[actor];
    this.editorSessionToken = `session-${actor}`;
    this.privateInputIdentity = { editor_user_id: actorIds[actor], editor_session_sha256: hash(actor[0]) };
  }

  requiredServiceBindings = [];

  get events() {
    return structuredClone(this.#events);
  }

  #visible(options) {
    return options.actor === "anonymous" || (this.#actor === "eligible" && !this.#state.member);
  }

  #view(page, options) {
    const visible = this.#visible(options);
    return {
      type: "found",
      data: {
        page: { page_id: page.page_id },
        page_revision: { revision_id: page.revision_id },
        compiled_body_html: visible ? joinBody : "",
        membership_actions: options.actor !== "anonymous" && this.#actor === "eligible" && visible
          ? [{ type: "join", page_id: page.page_id, revision_id: page.revision_id, index: 0, fingerprint }]
          : [],
      },
    };
  }

  async rpc(method, params = {}, options = {}) {
    this.#events.push({ service: "deepwell", operation: method, method: "POST", response_status: 200 });
    if (method === "session_get") return { user_id: this.editorUserId };
    if (method === "site_get") return params.site === "scp-wiki" ? { site_id: 8, slug: "scp-wiki" } : { site_id: 7, slug: "scpaiueouiuiuiui" };
    if (method === "member_get") return this.#state.member ? { from_id: actorIds.eligible, dest_id: 7 } : null;
    if (method === "wikidot_page_preview") return { body: this.#visible(options) ? joinBody : "", styles: [], membership_actions: [] };
    if (method === "page_get") return structuredClone(this.#state.pages.get(params.page) ?? null);
    if (method === "page_create") {
      if (this.#actor === "eligible" && !this.#state.member) throw new Error("not a member");
      const page = {
        page_id: this.#state.nextPageId++,
        site_id: params.site_id,
        revision_id: this.#state.nextRevisionId++,
        slug: params.slug,
        title: params.title,
        wikitext: params.wikitext,
      };
      this.#state.pages.set(page.slug, page);
      return structuredClone(page);
    }
    if (method === "page_view") {
      const page = this.#state.pages.get(params.route.slug);
      if (!page) return { type: "missing" };
      return this.#view(page, options);
    }
    if (method === "membership_join") {
      const page = this.#state.pages.get(options.page);
      if (options.siteId !== 7 || !page || params.action_fingerprint !== fingerprint) throw new Error("join denied");
      if (this.#state.member) return "already_member";
      this.#state.member = true;
      return "joined";
    }
    if (method === "member_remove") {
      assert.equal(this.#actor, "administrator");
      assert.equal(options.cleanup, true);
      this.#state.member = false;
      return { deleted_by: actorIds.administrator };
    }
    if (method === "page_delete") {
      assert.equal(this.#actor, "administrator");
      assert.equal(options.cleanup, true);
      const page = [...this.#state.pages.values()].find(({ page_id }) => page_id === params.page);
      if (page) this.#state.pages.delete(page.slug);
      return null;
    }
    throw new Error(`unexpected fake RPC ${this.#actor}:${method}`);
  }
}

test("the #1029 candidate adapter proves actor-bound Join through public seams", async (t) => {
  const registered = await candidateCaseSet("open43-membership-join");
  assert.deepEqual(registered.caseIds, OPEN43_MEMBERSHIP_JOIN_CASE_IDS);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-membership-join-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = new FakeMembershipState();
  const sessions = new Map();
  const aggregate = await runCandidateCaseSet({
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: hash("a"),
    privateInput: {
      actors: Object.fromEntries(Object.entries(actorIds).map(([actor, user_id]) => [actor, { user_id, session_token: `session-${actor}` }])),
    },
    privateInputSha256: hash("b"),
    outputDir: path.join(root, "evidence"),
    caseSet: createOpen43MembershipJoinCandidateCaseSet({
      sessionFactory: ({ actor }) => {
        const session = new FakeMembershipSession(actor, state);
        sessions.set(actor, session);
        return session;
      },
    }),
    dependencies: {
      collectExecutionIdentity: async () => ({ schema: "fixture.execution.v1", source_clean: true }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime.v1", stable: true }),
      assertStableRuntimeIdentity() {},
      runId: () => "candidate-case-0123456789ab",
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });

  assert.equal(aggregate.status, "pass");
  assert.deepEqual(aggregate.denominator.case_ids, ["A1029_CENTRAL_PUBLIC_SEAMS"]);
  assert.equal(aggregate.cleanup.public_absence_verified, true);
  assert.equal(aggregate.resources.length, 3);
  assert.equal(aggregate.resources.every(({ released }) => released), true);
  assert.equal(state.member, false);
  assert.equal(state.pages.size, 0);
  assert.equal(sessions.size, 4);
});
