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
  assert.equal(session.privateInputIdentity.non_admin_user_id, 42);
  assert.equal(Object.hasOwn(session.privateInputIdentity, "expired_user_id"), false);
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

test("settings candidate session admits active and expired actors through public session_get", async () => {
  const requests = [];
  const results = new Map([
    ["admin-secret", { user_id: 41, session_token: "must-not-be-retained" }],
    ["non-admin-secret", { user_id: 42, session_token: "must-not-be-retained" }],
    ["expired-secret", null],
  ]);
  const session = new Open43SettingsCandidateSession({
    candidateIdentity,
    privateInput,
    async requestImpl(request) {
      const payload = JSON.parse(request.body);
      requests.push({ payload, headers: request.headers });
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: results.get(payload.params[0]) })),
      };
    },
  });

  assert.deepEqual(await session.verifyActorSessions(), {
    administrator_user_id: 41,
    non_admin_user_id: 42,
    expired_session: null,
  });
  assert.deepEqual(requests.map(({ payload }) => payload.method), ["session_get", "session_get", "session_get"]);
  assert.deepEqual(requests.map(({ payload }) => payload.params[0]), ["admin-secret", "non-admin-secret", "expired-secret"]);
  assert.equal(requests.every(({ headers }) => !("x-deepwell-session-token" in headers)), true);
  assert.equal(JSON.stringify(await session.verifyActorSessions()).includes("must-not-be-retained"), false);
});

test("settings candidate session rejects public actor identity drift and a live expired session", async () => {
  for (const [name, result, message] of [
    ["administrator", { user_id: 99 }, /administrator session_get user ID/u],
    ["non_admin", { user_id: 99 }, /non_admin session_get user ID/u],
    ["expired", { user_id: 43 }, /expired session_get result/u],
  ]) {
    const results = {
      "admin-secret": { user_id: 41 },
      "non-admin-secret": { user_id: 42 },
      "expired-secret": null,
    };
    results[privateInput.actors[name].session_token] = result;
    const session = new Open43SettingsCandidateSession({
      candidateIdentity,
      privateInput,
      async requestImpl(request) {
        const payload = JSON.parse(request.body);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: results[payload.params[0]] })),
        };
      },
    });
    await assert.rejects(session.verifyActorSessions(), message);
  }
});
