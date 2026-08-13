import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {parseFragment} from "parse5";

import {DeepwellRpcAdapter} from "../src/generic-runtime-differential.mjs";
import {validateRuntimeStateFixture} from "../src/runtime-state-fixture.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixtureRoot = path.join(
  repositoryRoot,
  "install/local/wikidot-verification/fixtures/open87-basalt-users",
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("Open87 Basalt static evidence metadata binds exact mock importer operations", async () => {
  const evidenceBytes = await fs.readFile(path.join(fixtureRoot, "evidence.jsonl"));
  const evidenceLines = evidenceBytes.toString("utf8").trim().split("\n");
  assert.equal(evidenceLines.length, 1);
  const evidence = JSON.parse(evidenceLines[0]);
  const fixturePath = path.join(fixtureRoot, "runtime-state.json");
  const fixtureBytes = await fs.readFile(fixturePath);
  const fixture = validateRuntimeStateFixture(JSON.parse(fixtureBytes));

  const expectedUsers = [
    {user_id: 3781861, name: "EstrellaYoshte", slug: "estrellayoshte"},
    {user_id: 6254643, name: "Liryn", slug: "liryn"},
    {user_id: 6536693, name: "Placeholder McD", slug: "placeholder-mcd"},
  ];
  const expectedPageEvidence = {
    source: "install/local/wikidot-verification/fixtures/open87-basalt-users/evidence.jsonl",
    capture_file_sha256: "17ec06b4d731c8772111d19806487dbb0c57d587b448d79db43072b04b0a0c2f",
    captured_at: "2026-08-11T23:48:23.973Z",
    capture_line: 1,
    site: "scp-wiki",
    slug: "theme:basalt",
    wikidot_url: "https://scp-wiki.wikidot.com/theme:basalt",
    page_identity: 1312334753,
    saved_source_sha256: "732c3d5922479d119cc31b834520ef84dfe5f0acb1c48cb497884757e3b1554a",
    wikidot_html_sha256: "d53a350b7deec493d5bb9a93f1eb63e027557564768fb4cda82a5ae20878bf52",
    raw_live_dom: {
      path: "/home/roku/wjlab/evidence/ftml-pin-2e5be6f2-conditional-canary/browser-rendering-candidate-final2/EN_theme_basalt-63ed4b2bb703/live.dom.html",
      sha256: "d53a350b7deec493d5bb9a93f1eb63e027557564768fb4cda82a5ae20878bf52",
    },
  };
  assert.equal(evidence.schema, "wikijump.open87_basalt_user_evidence.v1");
  assert.equal(evidence.capture_status, "captured");
  assert.deepEqual(evidence.page, {
    site: expectedPageEvidence.site,
    slug: expectedPageEvidence.slug,
    wikidot_url: expectedPageEvidence.wikidot_url,
    page_identity: expectedPageEvidence.page_identity,
    saved_source_sha256: expectedPageEvidence.saved_source_sha256,
    wikidot_html_sha256: expectedPageEvidence.wikidot_html_sha256,
  });
  assert.deepEqual(fixture.capture_source, {
    kind: "frozen-live-reference",
    report: "/home/roku/wjlab/evidence/open87-5f1-live-reference-policy-v9-attempt01/standing-browser-live-reference.json",
    report_sha256: "2d3b98a9f04767f396b9e3f4d6f2f1881f78d3a270a4bf5c5c22d939fc72ae4f",
    user_evidence: [expectedPageEvidence],
  });
  assert.deepEqual(
    evidence.retained_sources.confirmation_reports.at(-1),
    {
      path: fixture.capture_source.report,
      sha256: fixture.capture_source.report_sha256,
      captured_at: expectedPageEvidence.captured_at,
    },
  );
  assert.deepEqual(evidence.retained_sources.raw_live_dom, expectedPageEvidence.raw_live_dom);
  assert.deepEqual(
    fixture.wikidot_users.map(({user_id, name, slug}) => ({user_id, name, slug})),
    expectedUsers,
  );
  assert.deepEqual(
    evidence.users.map(({user_id, name, slug}) => ({user_id, name, slug})),
    expectedUsers,
  );
  assert.deepEqual(
    evidence.users.map(({name, source_occurrences, rendered_avatar_occurrences}) => ({
      name,
      source_occurrences,
      rendered_avatar_occurrences,
    })),
    [
      {name: "EstrellaYoshte", source_occurrences: 3, rendered_avatar_occurrences: 2},
      {name: "Liryn", source_occurrences: 1, rendered_avatar_occurrences: 1},
      {name: "Placeholder McD", source_occurrences: 2, rendered_avatar_occurrences: 2},
    ],
  );
  assert.deepEqual(evidence.occurrences, {
    source_total: 6,
    rendered_avatar_total: 5,
    note: evidence.occurrences.note,
  });
  assert.equal(evidence.retained_sources.confirmation_reports.length, 4);

  for (const user of fixture.wikidot_users) {
    assert.equal(user.provenance.capture_file_sha256, sha256(evidenceBytes));
    assert.equal(user.provenance.capture_line, 1);
    assert.equal(user.provenance.page_identity, evidence.page.page_identity);
    assert.equal(user.provenance.captured_at, evidence.captured_at);
    assert.equal(user.provenance.saved_source_sha256, evidence.page.saved_source_sha256);
    assert.equal(user.provenance.wikidot_html_sha256, evidence.page.wikidot_html_sha256);
  }

  assert.deepEqual(fixture.pages, []);
  assert.deepEqual(fixture.absent_pages, []);
  assert.deepEqual(fixture.categories, []);
  assert.equal(
    sha256(await fs.readFile(path.join(repositoryRoot, "deepwell/seeder/theme-basalt.ftml"))),
    evidence.page.saved_source_sha256,
  );

  const importedUsers = new Map();
  const importParams = [];
  const rpcCalls = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    rpcCalls.push({method: request.method, params: request.params});
    let result;
    if (request.method === "ping") result = "pong";
    else if (request.method === "site_get") result = {site_id: 7};
    else if (request.method === "login") result = {session_token: "fixture-session"};
    else if (request.method === "user_get") {
      result = request.params.user === "administrator"
        ? {user_id: 9}
        : importedUsers.get(request.params.user) ?? null;
    } else if (request.method === "import_wikidot_user") {
      importParams.push(request.params);
      const user = {
        user_id: request.params.user_id,
        user_type: "wikidot",
        name: request.params.name,
        slug: request.params.slug,
      };
      importedUsers.set(user.user_id, user);
      result = {user_id: user.user_id};
    } else throw new Error(`unexpected RPC method: ${request.method}`);
    return {ok: true, json: async () => ({jsonrpc: "2.0", id: request.id, result})};
  };
  const adapter = new DeepwellRpcAdapter({
    rpcUrl: "http://127.0.0.1:2741/jsonrpc",
    rpcToken: "0".repeat(64),
    textBlockBaseUrl: "http://127.0.0.1:9000/deepwell-text-blocks/",
    siteSlug: "sandbox-for-codex",
    administratorEmail: "admin@example.test",
    administratorPassword: "secret",
    fetchImpl,
  });
  const input = {path: fixturePath, sha256: sha256(fixtureBytes), fixture};
  const receipt = await adapter.applyStateFixture(input, "runtime-diff-abcdef123456");
  assert.deepEqual(
    receipt.operations,
    expectedUsers.map((user) => ({
      kind: "wikidot-user",
      ...user,
      provenance_time: expectedPageEvidence.captured_at,
      action: "imported",
    })),
  );
  assert.deepEqual(
    importParams,
    expectedUsers.map((user) => ({
      user_id: user.user_id,
      created_at: "2026-08-11T23:48:23.972Z",
      fetched_at: expectedPageEvidence.captured_at,
      user_type: "extant",
      name: user.name,
      slug: user.slug,
      avatar_uploaded_blob_id: null,
      real_name: null,
      gender: null,
      birthday: null,
      location: null,
      biography: null,
      website: null,
      karma: 0,
      is_pro: false,
      importing_user_id: 9,
      ip_address: "127.0.0.1",
    })),
  );
  assert.equal(
    rpcCalls.filter(({method}) => method === "import_wikidot_user").length,
    expectedUsers.length,
  );
});

test("Open87 Basalt retained evidence has exact nested HTTPS printuser DOM", async () => {
  const retained = JSON.parse(
    await fs.readFile(path.join(fixtureRoot, "retained-dom-shape.json"), "utf8"),
  );
  const runtimeState = JSON.parse(
    await fs.readFile(path.join(fixtureRoot, "runtime-state.json"), "utf8"),
  );
  const evidenceIdentity = runtimeState.capture_source.user_evidence[0];
  assert.deepEqual(retained.source, {
    path: evidenceIdentity.raw_live_dom.path,
    sha256: evidenceIdentity.raw_live_dom.sha256,
    site: evidenceIdentity.site,
    slug: evidenceIdentity.slug,
    page_identity: evidenceIdentity.page_identity,
  });
  assert.equal(retained.printusers.length, runtimeState.wikidot_users.length);
  assert.deepEqual(
    retained.printusers.map(({user_id, name, slug}) => ({user_id, name, slug})),
    runtimeState.wikidot_users.map(({user_id, name, slug}) => ({user_id, name, slug})),
  );

  for (const user of retained.printusers) {
    const fragment = parseFragment(user.html);
    assert.equal(fragment.childNodes.length, 1);
    const span = fragment.childNodes[0];
    const spanAttributes = Object.fromEntries(span.attrs.map(({name, value}) => [name, value]));
    assert.equal(span.tagName, "span");
    assert.deepEqual(spanAttributes, {class: "printuser avatarhover"});
    assert.equal(span.childNodes.length, 2);

    const [avatarLink, nameLink] = span.childNodes;
    const avatarLinkAttributes = Object.fromEntries(
      avatarLink.attrs.map(({name, value}) => [name, value]),
    );
    const expectedProfile = `http://www.wikidot.com/user:info/${user.slug}`;
    const expectedOnclick = `WIKIDOT.page.listeners.userInfo(${user.user_id}); return false;`;
    assert.equal(avatarLink.tagName, "a");
    assert.deepEqual(avatarLinkAttributes, {href: expectedProfile, onclick: expectedOnclick});
    assert.equal(avatarLink.childNodes.length, 1);

    const image = avatarLink.childNodes[0];
    const imageAttributes = Object.fromEntries(image.attrs.map(({name, value}) => [name, value]));
    assert.equal(image.tagName, "img");
    assert.deepEqual(Object.keys(imageAttributes).sort(), ["alt", "class", "src", "style"]);
    assert.equal(imageAttributes.class, "small");
    assert.equal(
      imageAttributes.src,
      `https://www.wikidot.com/avatar.php?userid=${user.user_id}&amp;size=small&amp;timestamp=1781455776`,
    );
    assert.equal(imageAttributes.alt, user.name);
    assert.equal(
      imageAttributes.style,
      `background-image:url(https://www.wikidot.com/userkarma.php?u=${user.user_id})`,
    );

    const nameLinkAttributes = Object.fromEntries(
      nameLink.attrs.map(({name, value}) => [name, value]),
    );
    assert.equal(nameLink.tagName, "a");
    assert.deepEqual(nameLinkAttributes, {href: expectedProfile, onclick: expectedOnclick});
    assert.equal(nameLink.childNodes.length, 1);
    assert.equal(nameLink.childNodes[0].value, user.name);
  }
});
