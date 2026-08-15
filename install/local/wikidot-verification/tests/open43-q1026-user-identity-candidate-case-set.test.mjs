import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildQ1026UserIdentitySource,
  createOpen43Q1026UserIdentityCandidateCaseSet,
  Open43Q1026UserIdentityCandidateSession,
} from "../src/open43-q1026-user-identity-candidate-case-set.mjs";
import { OPEN43_Q1026_EXPECTED_EM_CONTENTS } from "../src/open43-q1026-user-identity-candidate-contract.mjs";

const PAGE_ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const visible = { user_id: 19_102_600, name: "Extant User", slug: "extant-user", is_deleted: false };
const deleted = { user_id: 19_102_601, name: "Deleted User", slug: "deleted-user", is_deleted: true };
const source = buildQ1026UserIdentitySource(visible, deleted);
const sourceSha256 = "496aa92286a90cbf996a6e428f8829619527c16cf2ff87e57851f8ce9babe99f";
assert.equal(createHash("sha256").update(source).digest("hex"), sourceSha256);
const fixture = {
  site_id: 7,
  page: { page_id: 11, revision_id: 21, slug: "fixture-wikidot-user-identity-matrix" },
  source_sha256: sourceSha256,
  provenance: {
    path: "deepwell/tests/page.rs#wikidot_user_blocks_match_live_preview_and_saved_page_identity_boundaries",
    source_file: "deepwell/tests/page.rs",
    sha256: "ea3e1a1daf6db9d750d13af649e46137186b9d4b415e562fd69fad7a1dacf8f7",
  },
  visible_user: visible,
  deleted_user: deleted,
};
const privateInput = {
  deepwell_rpc_url: "http://127.0.0.1:22747/jsonrpc",
  deepwell_rpc_token: "a".repeat(64),
  tls_ca_pem: "private-ca",
  fixture,
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
  const profile = `http://www.wikidot.com/user:info/${visible.slug}`;
  const onclick = `WIKIDOT.page.listeners.userInfo(${visible.user_id}); return false;`;
  return {
    printuser_count: 2,
    avatarhover_count: 1,
    anchors: [
      { href: profile, onclick },
      { href: profile, onclick },
      { href: profile, onclick },
    ],
    avatar_images: [{ class: "small", alt: visible.name, style: `background-image:url(https://www.wikidot.com/userkarma.php?u=${visible.user_id})` }],
    error_count: OPEN43_Q1026_EXPECTED_EM_CONTENTS.length,
    error_em_html: [...OPEN43_Q1026_EXPECTED_EM_CONTENTS],
    error_texts: OPEN43_Q1026_EXPECTED_EM_CONTENTS.map((em) => `${em} does not match any existing user name`),
    error_anchor_counts: OPEN43_Q1026_EXPECTED_EM_CONTENTS.map(() => 0),
  };
}

function fakeBrowserContexts(state) {
  const events = [];
  const page = {
    on() {},
    off() {},
    async goto() {
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
  const profile = `http://www.wikidot.com/user:info/${visible.slug}`;
  const onclick = `WIKIDOT.page.listeners.userInfo(${visible.user_id}); return false;`;
  const good = `<span class="printuser"><a href="${profile}" onclick="${onclick}">${visible.name}</a></span>`;
  const bad = `<span class="error-inline"><em>${deleted.name}</em> does not match any existing user name</span>`;
  return `NAME=${good}\nID=${good}\nDELETED=${bad}\nA=${bad}\nB=${bad}\nC=${bad}\nD=${bad}\nE=${bad}\nF=${bad}\nG=${bad}`;
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
  assert.equal(session.privateInputIdentity.visible_user_id, visible.user_id);
  assert.equal(session.privateInputIdentity.deleted_user_id, deleted.user_id);
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
        requests.push(payload);
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

  assert.equal(caseSet.id, "open43-q1026-user-identity");
  assert.deepEqual(caseSet.caseIds, ["Q1026_EXACT_CANDIDATE_PREVIEW_SAVED_IDENTITY", "Q1026_BROWSER_PRINTUSER_INTERVALS"]);
  assert.deepEqual(rows.map(({ case_id }) => case_id), caseSet.caseIds);
  assert.equal(verification.verified, true);
  assert.equal(verification.visible_lookup_count, 4);
  assert.equal(verification.hidden_lookup_count, 16);
  assert.equal(printuser.verified, true);
  assert.equal(printuser.initial.printuser_count, 2);
  assert.equal(printuser.initial.error_count, 8);
  assert.equal(printuser.settled.avatarhover_count, 1);
  assert.deepEqual(browser.events.slice(0, 2), ["fixture:Q1026_PRINTUSER_INTERVALS", "context"]);
  assert.deepEqual(requests.map(({ method }) => method), ["page_get", "wikidot_page_preview", "page_view"]);
  assert.equal(requests[1].params.wikitext, source);
  assert.equal(requests[2].params.session_token, null);
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

test("#1026 browser row requires the exact non-standing public origin", async () => {
  const caseSet = createOpen43Q1026UserIdentityCandidateCaseSet();
  const wrongHost = candidateIdentity();
  wrongHost.candidate.endpoint.host = "scp-wiki.wikijump.localhost";
  assert.throws(
    () => caseSet.prepareRun({ candidateIdentity: wrongHost, privateInput, candidateBrowserContexts: fakeBrowserContexts(printuserState()) }),
    /requires exact non-standing/u,
  );
});
