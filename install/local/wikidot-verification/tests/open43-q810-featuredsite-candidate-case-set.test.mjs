import assert from "node:assert/strict";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";

const HASH = "a".repeat(64);

const candidateIdentity = {
  candidate: {
    endpoint: {
      scheme: "https",
      host: "scpaiueouiuiuiui.wikijump.localhost",
      port: 18443,
    },
  },
};

const privateInput = {
  deepwell_rpc_url: "http://127.0.0.1:27747/jsonrpc",
  object_store_origin: "http://127.0.0.1:29000",
  presigned_origin: "http://127.0.0.1:29000",
  deepwell_rpc_token: "a".repeat(64),
  tls_ca_pem: "candidate-ca",
  actors: { editor: { user_id: -1, session_token: "candidate-session" } },
  featuredsite_fixture: {
    site: { site_id: 1, slug: "scpaiueouiuiuiui" },
    saved_page: { page_id: 2, revision_id: 3, slug: "featuredsite-saved", source_sha256: HASH },
    nested_page: { page_id: 4, revision_id: 5, slug: "featuredsite-nested", source_sha256: HASH },
  },
};

test("Q810 candidate command reaches the real FeaturedSite prepare seam", async () => {
  const selected = await candidateCaseSet("open43-featuredsite");
  const prepared = selected.prepareRun({
    runId: "candidate-case-0123456789ab",
    candidateIdentity,
    candidateIdentitySha256: HASH,
    privateInput,
    privateInputSha256: HASH,
    signal: null,
    resources: { register() { throw new Error("prepareRun must not register resources"); } },
    candidateBrowserContexts: {},
  });

  assert.equal(selected.id, "open43-featuredsite");
  assert.deepEqual(selected.caseIds, ["Q810_CANDIDATE_FAIL_CLOSED_NETWORK"]);
  assert.equal(prepared.plan.schema, "wikijump.open43_featuredsite_candidate_plan.v1");
  assert.equal(typeof prepared.execute, "function");
  assert.equal(typeof prepared.verifyCase, "function");
});
