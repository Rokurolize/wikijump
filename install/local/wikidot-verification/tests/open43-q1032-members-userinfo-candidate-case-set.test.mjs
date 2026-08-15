import assert from "node:assert/strict";
import test from "node:test";

import {
  OPEN43_Q1032_CASE_IDS,
  createOpen43Q1032CandidateCaseSet,
} from "../src/open43-q1032-members-userinfo-candidate-case-set.mjs";
import { candidateCaseSet } from "../src/candidate-case-command.mjs";

const hash = (character) => character.repeat(64);
const git = (character) => character.repeat(40);

function identity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-q1032-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-open43-q1032-fixture",
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
        allowed_origin_set: [
          "https://scpaiueouiuiuiui.wikijump.localhost:18443",
          "https://scpaiueouiuiuiui.wjfiles.localhost:18443",
        ],
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: { status: "sealed", manifest_sha256: hash("a"), seal_sha256: hash("b") },
  };
}

function fakeSession(calls) {
  return {
    pageOrigin: "https://scpaiueouiuiuiui.wikijump.localhost:18443",
    privateInputIdentity: { editor_user_id: 7, fixture_identity_sha256: hash("e") },
    requiredServiceBindings: [],
    async rpc(method, params, options) {
      calls.push({ method, params, options });
      if (method === "wikidot_members_list_module") return { status: "ok", body: '<div><table><tr><td>member</td></tr></table><span class="pager-no">page 1 of 2</span><script>OZONE.ajax.requestModule("membership/MembersListModule")</script></div>' };
      return { body: "\n\n<div class=\"error-block\">No user specified.</div>" };
    },
  };
}

test("Q1032 executable case reaches Members and both UserInfo actor boundaries", async () => {
  const calls = [];
  const selected = createOpen43Q1032CandidateCaseSet({ sessionFactory: () => fakeSession(calls) });
  const prepared = selected.prepareRun({ candidateIdentity: identity(), privateInput: { site_id: 9, preview_title: "q1032-boundary" }, signal: null });
  const rows = await prepared.execute();
  assert.deepEqual(rows.map(({ case_id }) => case_id), [...OPEN43_Q1032_CASE_IDS]);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(({ method }) => method), ["wikidot_members_list_module", "wikidot_page_preview", "wikidot_page_preview"]);
  assert.deepEqual(calls.map(({ options }) => options.actor), ["anonymous", "anonymous", "editor"]);
  assert.equal(prepared.verifyCase(rows[0].case_id, rows[0].observations).verified, true);
  const cleanup = await prepared.cleanup();
  assert.equal(prepared.verifyCleanup(cleanup, []).public_absence_verified, true);
});

test("Q1032 case is registered as an executable canonical case set", async () => {
  const selected = await candidateCaseSet("open43-q1032-members-userinfo");
  assert.equal(selected.id, "open43-q1032-members-userinfo");
  assert.deepEqual(selected.caseIds, [...OPEN43_Q1032_CASE_IDS]);
  assert.equal(typeof selected.prepareRun, "function");
});
