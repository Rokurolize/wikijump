import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildQ1026UserIdentitySource,
  createOpen43Q1026UserIdentityCandidateCaseSet,
  Open43Q1026UserIdentityCandidateSession,
  Q1026_USER_FIXTURES,
} from "../src/open43-q1026-user-identity-candidate-case-set.mjs";
import { OPEN43_Q1026_EXPECTED_EM_CONTENTS } from "../src/open43-q1026-user-identity-candidate-contract.mjs";

const visible = Q1026_USER_FIXTURES.visible_user;
const deleted = Q1026_USER_FIXTURES.deleted_user;
const source = buildQ1026UserIdentitySource(Q1026_USER_FIXTURES);
const sourceSha256 = "201031ec502c99355498ef27533d2c10f15bf49c959116a3bfacba9ce2f0a92d";
assert.equal(createHash("sha256").update(source).digest("hex"), sourceSha256);
const fixture = {
  site_id: 7,
  page: { page_id: 11, revision_id: 21, slug: "fixture-wikidot-user-identity-matrix" },
  source_sha256: sourceSha256,
  provenance: {
    path: "deepwell/tests/page.rs#wikidot_user_blocks_match_live_preview_and_saved_page_identity_boundaries",
    source_file: "deepwell/tests/page.rs",
    sha256: "b47242cdfd57e122367c43397527a576cf02df34aa7186ca4c11cb4675dd118b",
  },
  ...Q1026_USER_FIXTURES,
};
const privateInput = {
  deepwell_rpc_url: "http://127.0.0.1:22747/jsonrpc",
  deepwell_rpc_token: "a".repeat(64),
  tls_ca_pem: "private-ca",
  fixture,
  actors: {
    editor: { user_id: 20_000_007, session_token: `wj:${"e".repeat(64)}` },
    administrator: { user_id: -1, session_token: `wj:${"a".repeat(64)}` },
    other: { user_id: 20_000_012, session_token: `wj:${"o".repeat(64)}` },
  },
};

function candidateIdentity() {
  return {
    candidate: {
      endpoint: { scheme: "https", host: "scpaiueouiuiuiui.wikijump.localhost", port: 18443 },
      port_443_published: false,
    },
  };
}

function printuserState() {
  const anchor = (user) => ({ href: `http://www.wikidot.com/user:info/${user.slug}`, onclick: `WIKIDOT.page.listeners.userInfo(${user.user_id}); return false;` });
  return {
    printuser_count: 6,
    avatarhover_count: 1,
    anchors: [anchor(visible), anchor(visible), anchor(visible), anchor(Q1026_USER_FIXTURES.name_only_user), anchor(Q1026_USER_FIXTURES.unicode_user), anchor(Q1026_USER_FIXTURES.display_numeric_name_user), anchor(Q1026_USER_FIXTURES.system_user)],
    avatar_images: [{ class: "small", alt: visible.name, style: `background-image:url(http://www.wikidot.com/userkarma.php?u=${visible.user_id})` }],
    error_count: OPEN43_Q1026_EXPECTED_EM_CONTENTS.length,
    error_em_html: [...OPEN43_Q1026_EXPECTED_EM_CONTENTS],
    error_texts: OPEN43_Q1026_EXPECTED_EM_CONTENTS.map((em) => `${em} does not match any existing user name`),
    error_anchor_counts: OPEN43_Q1026_EXPECTED_EM_CONTENTS.map(() => 0),
    anonymous_literal_present: true,
  };
}

function fakeBrowserContexts(state) {
  const events = [];
  const listeners = new Map();
  const page = {
    on(name, listener) { listeners.set(name, listener); },
    off(name) { listeners.delete(name); },
    async goto() {
      const failed = listeners.get("requestfailed");
      failed?.({
        url: () => `https://www.wikidot.com/avatar.php?userid=${visible.user_id}&amp;size=small`,
        method: () => "GET",
        failure: () => ({ errorText: "csp" }),
      });
      failed?.({
        url: () => `https://www.wikidot.com/userkarma.php?u=${visible.user_id}`,
        method: () => "GET",
        failure: () => ({ errorText: "csp" }),
      });
      return { status: () => 200 };
    },
    async evaluate() {
      return structuredClone(state);
    },
    async close() {
      events.push("page-close");
    },
  };
  return {
    events,
    setActiveFixture(fixtureId) {
      events.push(`fixture:${fixtureId}`);
    },
    async newCandidateContext() {
      events.push("context");
      return { context: { async newPage() { return page; } } };
    },
  };
}

function renderedBody() {
  const good = (user, starred = false) => {
    const profile = `http://www.wikidot.com/user:info/${user.slug}`;
    const onclick = `WIKIDOT.page.listeners.userInfo(${user.user_id}); return false;`;
    const image = starred ? `<a href="${profile}" onclick="${onclick}"><img class="small" src="http://www.wikidot.com/avatar.php?userid=${user.user_id}&amp;size=small" alt="${user.name}" style="background-image:url(http://www.wikidot.com/userkarma.php?u=${user.user_id})" /></a>` : "";
    return `<span class="printuser${starred ? " avatarhover" : ""}">${image}<a href="${profile}" onclick="${onclick}">${user.name}</a></span>`;
  };
  const bad = (name) => `<span class="error-inline"><em>${name}</em> does not match any existing user name</span>`;
  return [
    `NAME=${good(visible)}`,
    `NAME_STAR=${good(visible, true)}`,
    `NAME_ONLY=${good(Q1026_USER_FIXTURES.name_only_user)}`,
    `COLLISION=${bad("Shared Person")}`,
    `UNKNOWN_AVATAR=${bad("Unknown Avatar User")}`,
    `UNICODE=${good(Q1026_USER_FIXTURES.unicode_user)}`,
    `NUMERIC_DISPLAY=${good(Q1026_USER_FIXTURES.display_numeric_name_user)}`,
    `ID=${bad(visible.user_id)}`,
    `DELETED=${bad(deleted.name)}`,
    `SYSTEM=${good(Q1026_USER_FIXTURES.system_user)}`,
    "ANONYMOUS=Anonymous",
    ...OPEN43_Q1026_EXPECTED_EM_CONTENTS.slice(4).map((name, index) => `${String.fromCharCode(65 + index)}=${bad(name)}`),
  ].join("\n");
}

function response(id, result) {
  return { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result })) };
}

test("#1026 candidate session binds existing fixture identities and only uses anonymous RPC", async () => {
  const requests = [];
  const session = new Open43Q1026UserIdentityCandidateSession({
    privateInput,
    requestImpl: async (request) => {
      const payload = JSON.parse(request.body);
      requests.push({ payload, request });
      return response(payload.id, { site_id: fixture.site_id });
    },
  });

  assert.equal(JSON.stringify(session.privateInputIdentity).includes("rpc-secret"), false);
  assert.equal(session.privateInputIdentity.actor_identities.editor.user_id, privateInput.actors.editor.user_id);
  assert.equal(session.privateInputIdentity.actor_identities.administrator.user_id, privateInput.actors.administrator.user_id);
  assert.deepEqual(session.requiredServiceBindings, [{ role: "deepwell", container_port: "2747/tcp", host_address: "127.0.0.1", host_port: 22747 }]);
  await session.rpc("site_get", { site: "scpaiueouiuiuiui" });
  assert.deepEqual(requests[0].payload, {
    jsonrpc: "2.0",
    id: 1,
    method: "site_get",
    params: { site: "scpaiueouiuiuiui" },
  });
  assert.equal(requests[0].request.headers.authorization.startsWith("Bearer "), true);
  assert.equal(requests[0].request.connectAddress, "127.0.0.1");
  assert.equal(requests[0].request.tlsCa, "private-ca");
  assert.equal(Object.hasOwn(requests[0].request.headers, "cookie"), false);
});

test("#1026 candidate case runs preview and saved identity controls through the read-only adapter", async () => {
  const body = renderedBody();
  const requests = [];
  const browser = fakeBrowserContexts(printuserState());
  const caseSet = createOpen43Q1026UserIdentityCandidateCaseSet({
    sessionFactory: (options) => new Open43Q1026UserIdentityCandidateSession({
      ...options,
      requestImpl: async (request) => {
        const payload = JSON.parse(request.body);
        requests.push({ payload, request });
        if (payload.method === "page_get") return response(payload.id, { page_id: fixture.page.page_id, revision_id: fixture.page.revision_id, slug: fixture.page.slug, wikitext: source });
        if (payload.method === "wikidot_page_preview") return response(payload.id, { body, styles: [] });
        if (payload.method === "page_view") return response(payload.id, { type: "found", data: { compiled_body_html: body } });
        throw new Error(`unexpected method ${payload.method}`);
      },
    }),
  });
  const run = caseSet.prepareRun({ candidateIdentity: candidateIdentity(), privateInput, candidateBrowserContexts: browser });
  const rows = await run.execute();
  const verification = run.verifyCase(rows[0].case_id, rows[0].observations);
  const printuser = run.verifyCase(rows[1].case_id, rows[1].observations);
  const actors = run.verifyCase(rows[2].case_id, rows[2].observations);

  assert.equal(caseSet.id, "open43-q1026-user-identity");
  assert.deepEqual(caseSet.caseIds, ["Q1026_EXACT_CANDIDATE_PREVIEW_SAVED_IDENTITY", "Q1026_BROWSER_PRINTUSER_INTERVALS", "Q1026_ACTOR_SPECIAL_IDENTITY_MATRIX"]);
  assert.deepEqual(rows.map(({ case_id }) => case_id), caseSet.caseIds);
  assert.equal(verification.verified, true);
  assert.equal(verification.visible_lookup_count, 12);
  assert.equal(verification.hidden_lookup_count, 22);
  assert.equal(printuser.verified, true);
  assert.equal(printuser.initial.printuser_count, 6);
  assert.equal(printuser.initial.error_count, 11);
  assert.equal(printuser.settled.avatarhover_count, 1);
  assert.equal(actors.verified, true);
  assert.equal(actors.actor_count, 4);
  assert.deepEqual(browser.events.slice(0, 2), ["fixture:Q1026_PRINTUSER_INTERVALS", "context"]);
  assert.deepEqual(requests.map(({ payload }) => payload.method), ["page_get", "wikidot_page_preview", "page_view", "wikidot_page_preview", "page_view", "wikidot_page_preview", "page_view", "wikidot_page_preview", "page_view"]);
  assert.equal(requests[1].payload.params.wikitext, source);
  assert.equal(requests[2].payload.params.session_token, null);
  assert.equal(requests[3].request.headers["x-deepwell-session-token"], privateInput.actors.editor.session_token);
  assert.equal(requests[4].payload.params.session_token, privateInput.actors.editor.session_token);
  assert.deepEqual(await run.cleanup(), { public_absence_verified: true, mutation_count: 0 });

  const leaked = printuserState();
  leaked.error_anchor_counts[0] = 1;
  assert.throws(
    () => run.verifyCase("Q1026_BROWSER_PRINTUSER_INTERVALS", {
      ...rows[1].observations,
      initial: leaked,
    }),
    /leaked a link or avatar authority/u,
  );
});

test("#1026 numeric identity text remains an exact fail-closed name lookup", () => {
  assert.deepEqual(OPEN43_Q1026_EXPECTED_EM_CONTENTS.slice(0, 4), ["Shared Person", "Unknown Avatar User", String(visible.user_id), deleted.name]);
  assert.equal(OPEN43_Q1026_EXPECTED_EM_CONTENTS.length, 11);
});

test("#1026 browser row requires the exact non-standing public origin", async () => {
  const caseSet = createOpen43Q1026UserIdentityCandidateCaseSet();
  const wrongHost = candidateIdentity();
  wrongHost.candidate.endpoint.host = "scp-wiki.wikijump.localhost";
  assert.throws(
    () => caseSet.prepareRun({ candidateIdentity: wrongHost, privateInput, candidateBrowserContexts: fakeBrowserContexts(printuserState()) }),
    /requires exact non-standing/u,
  );
});
