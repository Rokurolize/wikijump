import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import {
  OPEN43_MEMBERSHIP_CASE_IDS,
  createOpen43MembershipCandidateCaseSet,
} from "../src/open43-membership-candidate-case-set.mjs";

const hash = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(32);
const git = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(20);
const JOIN_ACTION = Object.freeze({
  type: "join",
  page_id: 5,
  revision_id: 6,
  index: 0,
  fingerprint: "1".repeat(32),
});
const ANONYMOUS_STATIC_BODY = [
  "MEMBERSHIP_APPLY_START",
  '<div id="membership-apply-box">You need to have a Wikidot.com account and be signed to apply for membership.</div>',
  "MEMBERSHIP_APPLY_END",
  "MEMBERSHIP_PASSWORD_START",
  '<div id="membership-by-password-box">Please create an account and/or sign in first.</div>',
  "MEMBERSHIP_PASSWORD_END",
  "INVITATION_START",
  '<div id="membership-email-invitation-box">Sorry, the invitation could not be found.</div>',
  "INVITATION_END",
  "UNSUBSCRIBE_START",
  '<div class="error-block">Invalid indentification token.</div>',
  "UNSUBSCRIBE_END",
  "SEND_INVITATIONS_START",
  '<div class="error-block">Inviting users has been disabled due to severe abuse.</div>',
  "SEND_INVITATIONS_END",
].join("\n");
const MEMBER_STATIC_BODY = ANONYMOUS_STATIC_BODY.replace(
  "Please create an account and/or sign in first.",
  "You can not apply.<br/> It seems you already are a member of this site.",
);

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-membership-fixture",
      expires_at: "2099-08-15T00:00:00.000Z",
      compose_project: "wikijump-open43-membership-fixture",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: { deepwell: `sha256:${hash("4")}` },
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

async function createFakeDeepwell() {
  const state = { membership: null, page: null, calls: [] };
  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/jsonrpc");
      assert.equal(request.headers.authorization, `Bearer ${hash("f")}`);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const token = request.headers["x-deepwell-session-token"];
      const actor = token === undefined ? "anonymous" : token === "ordinary-session" ? "registered" : token === "administrator-session" ? "administrator" : "unknown";
      assert.notEqual(actor, "unknown");
      state.calls.push({ operation: payload.method, actor, site: request.headers["x-deepwell-site-id"] ?? null, page: request.headers["x-deepwell-page"] ?? null });
      let result;
      if (payload.method === "session_get") result = { user_id: 91 };
      else if (payload.method === "user_get") result = { user_id: 91, user_type: "regular" };
      else if (payload.method === "site_get") result = { site_id: 7, slug: "scpaiueouiuiuiui" };
      else if (payload.method === "member_get") result = state.membership === null ? null : structuredClone(state.membership);
      else if (payload.method === "page_get") result = state.page === null ? null : structuredClone(state.page);
      else if (payload.method === "page_view" && payload.params.route.slug === "system:join") {
        result = {
          type: "found",
          data: {
            page: { page_id: JOIN_ACTION.page_id, slug: "system:join" },
            page_revision: { revision_id: JOIN_ACTION.revision_id },
            compiled_body_html: state.membership === null
              ? '<div><a href="javascript:;" onclick="WIKIDOT.page.listeners.join(event, \'unified\')">Join</a></div>'
              : "<p>You are a member.</p>",
            membership_actions: state.membership === null ? [JOIN_ACTION] : [],
          },
        };
      } else if (payload.method === "page_view") {
        result = {
          type: "found",
          data: {
            page: { page_id: state.page.page_id, slug: state.page.slug },
            page_revision: { revision_id: state.page.revision_id, user_id: 91 },
            wikitext: state.page.wikitext,
            compiled_body_html: actor === "anonymous" ? ANONYMOUS_STATIC_BODY : MEMBER_STATIC_BODY,
          },
        };
      } else if (payload.method === "wikidot_page_preview") {
        result = { body: actor === "anonymous" ? ANONYMOUS_STATIC_BODY : MEMBER_STATIC_BODY, styles: [] };
      } else if (payload.method === "membership_join") {
        assert.equal(actor, "registered");
        assert.equal(request.headers["x-deepwell-site-id"], "7");
        assert.equal(request.headers["x-deepwell-page"], "system:join");
        assert.deepEqual(payload.params, { page_id: 5, last_revision_id: 6, action_index: 0, action_fingerprint: "1".repeat(32) });
        state.membership = { dest_id: 7, from_id: 91, metadata: { accepted: { cause: "self_joined" } } };
        result = "joined";
      } else if (payload.method === "admin_view") {
        assert.equal(actor, "registered");
        result = { type: "admin_permissions", data: { html: "Permission denied" } };
      } else if (payload.method === "page_create") {
        assert.equal(actor, "registered");
        assert.equal(state.membership?.from_id, 91);
        assert.equal(payload.params.user_id, 91);
        state.page = { page_id: 11, site_id: 7, revision_id: 12, revision_user_id: 91, slug: payload.params.slug, title: payload.params.title, wikitext: payload.params.wikitext };
        result = { page_id: 11, revision_id: 12, slug: payload.params.slug, parser_errors: [] };
      } else if (payload.method === "page_delete") {
        assert.equal(actor, "administrator");
        state.page = null;
        result = { page_id: 11 };
      } else if (payload.method === "member_remove") {
        assert.equal(actor, "administrator");
        state.membership = null;
        result = { dest_id: 7, from_id: 91 };
      } else {
        assert.fail(`unexpected fake membership RPC ${payload.method}`);
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    state,
    rpcUrl: `http://127.0.0.1:${address.port}/jsonrpc`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("the membership candidate proves ordinary page creation and the #1033 static actor matrix", async (t) => {
  const registered = await candidateCaseSet("open43-membership");
  assert.deepEqual(registered.caseIds, OPEN43_MEMBERSHIP_CASE_IDS);
  const deepwell = await createFakeDeepwell();
  t.after(() => deepwell.close());

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-membership-case-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const aggregate = await runCandidateCaseSet({
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: hash("a"),
    privateInput: {
      deepwell_rpc_url: deepwell.rpcUrl,
      deepwell_rpc_token: hash("f"),
      actors: {
        registered: { user_id: 91, session_token: "ordinary-session" },
        administrator: { user_id: -1, session_token: "administrator-session" },
      },
    },
    privateInputSha256: hash("b"),
    outputDir: path.join(root, "evidence"),
    caseSet: createOpen43MembershipCandidateCaseSet(),
    runId: "candidate-run-0123456789ab",
    dependencies: {
      collectExecutionIdentity: async () => ({ schema: "fixture.execution.v1", source_clean: true }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime.v1", stable: true }),
      assertStableRuntimeIdentity() {},
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });

  assert.equal(aggregate.status, "pass");
  assert.deepEqual(aggregate.denominator.case_ids, [
    "A1060_ORDINARY_MEMBER_PAGE_CREATE",
    "A1033_CENTRAL_STATIC_MODULE_MATRIX",
  ]);
  assert.equal(aggregate.cleanup.page_absent, true);
  assert.equal(aggregate.cleanup.membership_absent, true);
  assert.equal(aggregate.resources.length, 2);
  assert.equal(aggregate.resources.every(({ released }) => released), true);
  const receipt = JSON.parse(await fs.readFile(aggregate.cases[0].path, "utf8"));
  assert.equal(receipt.verification.registered_user_id, 91);
  assert.equal(receipt.verification.joined_without_administrator_fallback, true);
  assert.equal(receipt.verification.component_page_created_and_read_back, true);
  const staticReceipt = JSON.parse(await fs.readFile(aggregate.cases[1].path, "utf8"));
  assert.equal(staticReceipt.case_id, "A1033_CENTRAL_STATIC_MODULE_MATRIX");
  assert.equal(staticReceipt.verification.preview_and_saved_page_equal, true);
  assert.deepEqual(staticReceipt.verification.actor_states, ["anonymous", "member"]);
  assert.equal(staticReceipt.verification.opaque_values_absent, true);
  assert.deepEqual(
    staticReceipt.observations.requests.map(({ operation, actor }) => [operation, actor]),
    [
      ["page_view", "registered"],
      ["wikidot_page_preview", "anonymous"],
      ["wikidot_page_preview", "registered"],
      ["page_view", "anonymous"],
    ],
  );
  assert.doesNotMatch(JSON.stringify(staticReceipt), /candidate-(?:invitation|unsubscribe)-secret/u);
  const executeEvents = receipt.observations.requests;
  assert.equal(executeEvents.some(({ actor }) => actor === "administrator"), false);
  assert.deepEqual(
    executeEvents.filter(({ operation }) => ["membership_join", "page_create", "page_view"].includes(operation)).map(({ operation, actor }) => [operation, actor]),
    [
      ["page_view", "registered"],
      ["membership_join", "registered"],
      ["page_view", "registered"],
      ["page_create", "registered"],
      ["page_view", "registered"],
    ],
  );
  assert.deepEqual(
    deepwell.state.calls.filter(({ operation }) => ["page_delete", "member_remove"].includes(operation)).map(({ operation, actor }) => [operation, actor]),
    [["page_delete", "administrator"], ["member_remove", "administrator"]],
  );
  assert.equal(deepwell.state.page, null);
  assert.equal(deepwell.state.membership, null);
});
