import assert from "node:assert/strict";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import {
  OPEN43_BACKLINKS_CASE_IDS,
  OPEN43_BACKLINKS_SOURCE_FILES,
  createOpen43BacklinksCandidateCaseSet,
} from "../src/open43-backlinks-candidate-case-set.mjs";
import { sha256Text } from "../src/standing-browser-parity-util.mjs";

const POPULATED = '<div class="backlinks-module-box">\n\t\t\t<ul>\n\t\t\t\t\t\t\t<li>\n\t\t\t\t\t\t<a href="/source">Source</a>\n\t\t\t\t\t</li>\n\t\t\t\t\t\t</ul>\n\t</div>';
const EMPTY = '<div class="backlinks-module-box">\n</div>';

function fixture() {
  const page = (page_id, slug, title) => ({ page_id, slug, title });
  return {
    fixture: {
      site_id: 7,
      site_slug: "scpaiueouiuiuiui",
      holder: { ...page(1, "holder", "Holder"), source: "Q1027\n[[module Backlinks]]\n" },
      empty_holder: { ...page(2, "empty-holder", "Empty holder"), source: "Q1027 empty\n[[module Backlinks]]\n" },
      visible: [page(3, "source", "Source")],
      hidden: [page(4, "hidden-source", "Hidden source")],
      private: [page(5, "private-source", "Private source")],
      deleted: [page(6, "deleted-source", "Deleted source")],
      foreign_page: { ...page(8, "foreign-holder", "Foreign holder"), site_id: 9, site_slug: "other-site" },
      stale_page_slug: "stale-holder",
      expected: { populated: POPULATED, empty: EMPTY },
    },
  };
}

function preparedRun() {
  return createOpen43BacklinksCandidateCaseSet({
    sessionFactory: () => ({
      editorUserId: 41,
      requiredServiceBindings: [],
      privateInputIdentity: { fixture: "test" },
    }),
  }).prepareRun({
    candidateIdentity: { candidate: { endpoint: { host: "scpaiueouiuiuiui.wikijump.localhost" } } },
    privateInput: fixture(),
    signal: null,
  });
}

function validObservation() {
  const input = fixture().fixture;
  const side = (expected) => ({ fragment_sha256: sha256Text(expected) });
  const negative = (empty_wrapper) => ({ has_wrapper: false, empty_wrapper });
  return {
    actor: { rendered_viewer: "anonymous" },
    fixture: {
      source_sha256: sha256Text(input.holder.source),
      empty_source_sha256: sha256Text(input.empty_holder.source),
      expected_populated_dom_sha256: sha256Text(input.expected.populated),
      expected_empty_dom_sha256: sha256Text(input.expected.empty),
    },
    saved: { populated: side(POPULATED), empty: side(EMPTY) },
    preview: { populated: side(POPULATED), empty: side(EMPTY) },
    identity_negative: {
      no_identity: negative(true),
      missing_id: negative(true),
      stale: negative(true),
      foreign: negative(true),
      mismatched_id: negative(true),
      syntax_only: { ...negative(false), source_sha256: sha256Text(input.holder.source) },
      inline_module: {
        ...negative(false),
        source_sha256: sha256Text(input.holder.source.replace("[[module Backlinks]]", "start-[[module Backlinks]]-middle")),
      },
    },
    state_before_sha256: "same",
    state_after_sha256: "same",
    request_events: [],
  };
}

test("Q1027 Backlinks candidate is registered and binds rendering authority", async () => {
  const registered = await candidateCaseSet("open43-backlinks");
  assert.deepEqual(registered.caseIds, OPEN43_BACKLINKS_CASE_IDS);

  const run = preparedRun();
  assert.deepEqual(run.sourceFiles, OPEN43_BACKLINKS_SOURCE_FILES);
  for (const required of [
    "deepwell/src/services/render/backlinks.rs",
    "deepwell/src/services/render/service.rs",
    "docs/wikidot-specifications/specifications/module/module-backlinks.md",
    "install/local/wikidot-verification/artifacts/navigation-list-modules-live.json",
  ]) assert.ok(run.sourceFiles.includes(required), required);
  assert.equal(new Set(run.sourceFiles).size, run.sourceFiles.length);
  assert.deepEqual(run.plan.proof_scope, {
    anonymous_hidden_private_deleted_fail_closed: true,
    non_anonymous_private_visibility: "unproven",
    beyond_limit_behavior: "unproven",
    standing_proof: "unproven",
  });
});

test("Q1027 Backlinks verifier keeps anonymous-only evidence explicitly scoped", () => {
  const run = preparedRun();
  const verification = run.verifyCase(OPEN43_BACKLINKS_CASE_IDS[0], validObservation());
  assert.equal(verification.verified, true);
  assert.equal(verification.anonymous_hidden_private_deleted_fail_closed, true);
  assert.equal(verification.non_anonymous_private_visibility, "unproven");
  assert.equal(verification.beyond_limit_behavior, "unproven");
  assert.equal(verification.standing_proof, "unproven");

  assert.throws(
    () => run.verifyCase(OPEN43_BACKLINKS_CASE_IDS[0], { ...validObservation(), actor: { rendered_viewer: "editor" } }),
    /anonymous rendered viewer/u,
  );
});
