import assert from "node:assert/strict";
import test from "node:test";

import { Open43SettingsCandidateSession } from "../src/open43-settings-candidate-http.mjs";

const candidateIdentity = {
  candidate: {
    endpoint: {
      scheme: "https",
      host: "scpaiueouiuiuiui.wikijump.localhost",
      port: 18443,
      local_connect_address: "127.0.0.1",
      allowed_origin_set: [
        "https://scpaiueouiuiuiui.wikijump.localhost:18443",
        "https://scpaiueouiuiuiui.wjfiles.localhost:18443",
      ],
    },
  },
};

const privateInput = {
  deepwell_rpc_url: "http://127.0.0.1:22747/jsonrpc",
  deepwell_rpc_token: "a".repeat(64),
  tls_ca_pem: "private-ca",
  actors: {
    administrator: { user_id: 41, session_token: "admin-secret" },
    non_admin: { user_id: 42, session_token: "non-admin-secret" },
    expired: { user_id: 43, session_token: "expired-secret" },
  },
  fixture: {
    site_id: 6_000_003,
    cross_site_sentinel_id: 9_000_000_043,
    default_category: { category_id: 100_000_015, slug: "_default", page_id: 70, page_slug: "boundary-check" },
    transition_category: { category_id: 100_000_016, slug: "corpus", page_id: 71, page_slug: "corpus:scp-9506-draft" },
  },
};

test("settings candidate session hashes private actors and uses public HTTP seams", async () => {
  const requests = [];
  const session = new Open43SettingsCandidateSession({
    candidateIdentity,
    privateInput,
    async requestImpl(request) {
      requests.push(request);
      if (request.url.protocol === "http:") {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from('{"jsonrpc":"2.0","id":1,"result":{"site_id":17}}'),
        };
      }
      return {
        status: 403,
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"type":"failure","status":403}'),
      };
    },
  });

  assert.equal(JSON.stringify(session.privateInputIdentity).includes("secret"), false);
  assert.equal(session.privateInputIdentity.administrator_user_id, 41);
  assert.equal(session.privateInputIdentity.fixture_identity_sha256.length, 64);
  assert.equal(session.fixtureIdentity.transition_category.page_slug, "corpus:scp-9506-draft");
  assert.equal(session.storageState("administrator").cookies[0].value, "admin-secret");
  assert.deepEqual(await session.rpc("site_get", { site: "scpaiueouiuiuiui" }), {
    site_id: 17,
  });
  const action = await session.action(
    "analytics",
    { siteId: 17, expectedSettingsRevision: 4, enabled: true, profile: "UA-754-1" },
    { actor: "non_admin", origin: "https://wrong.example" },
  );
  assert.equal(action.http_status, 403);
  assert.equal(requests[1].connectAddress, "127.0.0.1");
  assert.equal(requests[1].tlsCa, "private-ca");
  assert.equal(requests[1].headers.cookie, "wikijump_token=non-admin-secret");
  assert.equal(requests[1].headers.origin, "https://wrong.example");
});
