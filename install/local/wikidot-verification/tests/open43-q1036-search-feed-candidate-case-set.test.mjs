import assert from "node:assert/strict";
import test from "node:test";

import {
  OPEN43_Q1036_CASE_IDS,
  createOpen43Q1036CandidateCaseSet,
} from "../src/open43-q1036-search-feed-candidate-case-set.mjs";
import { candidateCaseSet } from "../src/candidate-case-command.mjs";

const hash = (character) => character.repeat(64);
const git = (character) => character.repeat(40);
const SEARCH_ERROR = "<div class=\"error-block\">Search is temporarily unavailable, we are working to bring it online!</div>";
const FEED_MISSING = "<div class=\"error-block\">No feed source specified (\"src\" element missing).</div>";
const FEED_UNAVAILABLE = '<div class="error-block">Error processing the feed "https://example.com/feed.xml". The feed can not be accessed or contains errors. </div>';
const SAVED_SOURCE = "SEARCH_START\n[[module Search]]\nSEARCH_END\nFEED_START\n[[module Feed]]\nFEED_END";

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-q1036-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-open43-q1036-fixture",
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

test("Q1036 candidate case exercises preview and saved public RPC boundaries", async () => {
  const calls = [];
  const session = {
    pageOrigin: "https://scpaiueouiuiuiui.wikijump.localhost:18443",
    privateInputIdentity: { editor_user_id: 7 },
    requiredServiceBindings: [],
    async rpc(method, params, options) {
      calls.push({ method, params, options });
      if (method === "wikidot_page_preview") return { body: /\[\[module\s+search\b/iu.test(params.wikitext) ? SEARCH_ERROR : params.wikitext.includes('src=\"https://example.com/feed.xml\"') ? FEED_UNAVAILABLE : FEED_MISSING };
      if (method === "page_get") return { page_id: 1, slug: params.page, title: "Q1036 saved boundary", revision_id: 2, wikitext: SAVED_SOURCE };
      return { type: "found", data: { wikitext: SAVED_SOURCE, compiled_body_html: `SEARCH_START${SEARCH_ERROR}SEARCH_ENDFEED_START${FEED_MISSING}FEED_END` } };
    },
  };
  const caseSet = createOpen43Q1036CandidateCaseSet({ sessionFactory: () => session });
  const prepared = caseSet.prepareRun({ candidateIdentity: candidateIdentity(), privateInput: { site_id: 9, saved_page_id: 1, saved_revision_id: 2, saved_page_slug: "q1036-saved-boundary" }, signal: null });
  const rows = await prepared.execute();

  assert.deepEqual(rows.map(({ case_id }) => case_id), [...OPEN43_Q1036_CASE_IDS]);
  assert.equal(calls.length, 14);
  assert.equal(calls.filter(({ method }) => method === "wikidot_page_preview").length, 12);
  assert.deepEqual(calls.slice(-2).map(({ method }) => method), ["page_get", "page_view"]);
  assert.equal(prepared.verifyCase(rows[0].case_id, rows[0].observations).verified, true);
  assert.equal((await prepared.verifyCleanup(await prepared.cleanup(), [])).public_absence_verified, true);
});

test("canonical candidate command exposes the executable Q1036 case", async () => {
  const selected = await candidateCaseSet("open43-q1036-search-feed");
  assert.equal(selected.id, "open43-q1036-search-feed");
  assert.deepEqual(selected.caseIds, [...OPEN43_Q1036_CASE_IDS]);
});
