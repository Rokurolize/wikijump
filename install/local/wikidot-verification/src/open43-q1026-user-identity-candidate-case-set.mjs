import { createHash } from "node:crypto";
import net from "node:net";

import { requestCandidateCaseHttp } from "./candidate-case-http.mjs";
import { deepwellRpcAuthorization } from "./deepwell-rpc-auth.mjs";
import {
  verifyOpen43Q1026UserIdentityCase,
  verifyOpen43Q1026UserIdentityCleanup,
} from "./open43-q1026-user-identity-candidate-contract.mjs";
import {
  requireNonEmptyString,
  requirePlainObject,
  requireSha256,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_Q1026_USER_IDENTITY_CASE_IDS = Object.freeze([
  "Q1026_EXACT_CANDIDATE_PREVIEW_SAVED_IDENTITY",
]);

const FIXTURE_PROVENANCE = Object.freeze({
  path: "deepwell/tests/page.rs#wikidot_user_blocks_match_live_preview_and_saved_page_identity_boundaries",
  source_file: "deepwell/tests/page.rs",
  sha256: "ea3e1a1daf6db9d750d13af649e46137186b9d4b415e562fd69fad7a1dacf8f7",
});
const FIXTURE_SOURCE_SHA256 = "496aa92286a90cbf996a6e428f8829619527c16cf2ff87e57851f8ce9babe99f";
const EXISTING_USER_FIXTURES = Object.freeze({
  visible_user: Object.freeze({ user_id: 19_102_600, name: "Extant User", slug: "extant-user", is_deleted: false }),
  deleted_user: Object.freeze({ user_id: 19_102_601, name: "Deleted User", slug: "deleted-user", is_deleted: true }),
});
const NO_MUTATION_CLEANUP = Object.freeze({ public_absence_verified: true, mutation_count: 0 });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function loopbackRpc(value) {
  const url = new URL(requireNonEmptyString(value, "private input deepwell_rpc_url"));
  const address = url.hostname.replace(/^\[(.*)\]$/u, "$1");
  const family = net.isIP(address);
  if (url.protocol !== "http:" || url.pathname !== "/jsonrpc" || url.search || url.hash || !url.port || !((family === 4 && address.startsWith("127.")) || (family === 6 && address === "::1"))) {
    throw new Error("private input deepwell_rpc_url must be one loopback HTTP JSON-RPC endpoint");
  }
  return { url, address };
}

function userFixture(value, name, deleted) {
  const user = requirePlainObject(value, `private input fixture ${name}`);
  if (!Number.isSafeInteger(user.user_id) || typeof user.name !== "string" || !user.name || typeof user.slug !== "string" || !user.slug || user.is_deleted !== deleted) throw new Error(`private input fixture ${name} is invalid`);
  return Object.freeze({ user_id: user.user_id, name: user.name, slug: user.slug, is_deleted: user.is_deleted });
}

export function buildQ1026UserIdentitySource(visible, deleted) {
  return [
    `NAME=[[user ${visible.name}]]`,
    `ID=[[*user ${visible.user_id}]]`,
    `DELETED=[[user ${deleted.name}]]`,
    'A=[[user v7ws="alpha\tbeta\u00a0gamma"]]',
    'B=[[user v7ser="serialized body"]]',
    'C=[[user v7text="visible text"]]',
    'D=[[user v7arg="one" v7arg="two"]]',
    'E=[[user v7arg=""]]',
    'F=[[user v7UnknownArgument="x"]]',
    "G=[[user v7arg='single quoted' data-v7=unquoted]]",
  ].join("\n");
}

function fixtureIdentity(value) {
  const input = requirePlainObject(value, "private input fixture identity");
  const page = requirePlainObject(input.page, "private input fixture page");
  const visible = userFixture(input.visible_user, "visible_user", false);
  const deleted = userFixture(input.deleted_user, "deleted_user", true);
  if (!Number.isSafeInteger(input.site_id) || input.site_id <= 0 || !Number.isSafeInteger(page.page_id) || !Number.isSafeInteger(page.revision_id) || typeof page.slug !== "string" || !page.slug || visible.user_id === deleted.user_id || visible.slug === deleted.slug) throw new Error("private input #1026 fixture identity is invalid");
  if (JSON.stringify(visible) !== JSON.stringify(EXISTING_USER_FIXTURES.visible_user) || JSON.stringify(deleted) !== JSON.stringify(EXISTING_USER_FIXTURES.deleted_user)) throw new Error("private input #1026 users are not the existing identity fixtures");
  const source = buildQ1026UserIdentitySource(visible, deleted);
  const sourceSha256 = requireSha256(input.source_sha256, "private input #1026 source SHA-256");
  if (sourceSha256 !== FIXTURE_SOURCE_SHA256 || sha256(source) !== FIXTURE_SOURCE_SHA256) throw new Error("private input #1026 source hash does not match the fixed identity matrix");
  const provenance = requirePlainObject(input.provenance, "private input #1026 fixture provenance");
  if (provenance.path !== FIXTURE_PROVENANCE.path || provenance.source_file !== FIXTURE_PROVENANCE.source_file) throw new Error("private input #1026 fixture provenance is not the existing user identity fixture");
  if (provenance.sha256 !== FIXTURE_PROVENANCE.sha256) throw new Error("private input #1026 fixture source SHA-256 is not the existing identity fixture");
  return Object.freeze({
    site_id: input.site_id,
    page_id: page.page_id,
    revision_id: page.revision_id,
    page_slug: page.slug,
    source_sha256: sourceSha256,
    provenance: Object.freeze({ path: provenance.path, source_file: provenance.source_file, sha256: provenance.sha256 }),
    visible_user: visible,
    deleted_user: deleted,
    source,
  });
}

export class Open43Q1026UserIdentityCandidateSession {
  #rpc;
  #rpcAuthorization;
  #rpcToken;
  #tlsCa;
  #fixture;
  #request;
  #signal;
  #rpcId = 1;
  #events = [];

  constructor({ privateInput: rawInput, requestImpl = requestCandidateCaseHttp, signal = null }) {
    const input = requirePlainObject(rawInput, "private #1026 candidate input");
    this.#rpc = loopbackRpc(input.deepwell_rpc_url);
    this.#rpcToken = requireNonEmptyString(input.deepwell_rpc_token, "private input deepwell_rpc_token");
    this.#rpcAuthorization = deepwellRpcAuthorization(this.#rpcToken);
    this.#tlsCa = requireNonEmptyString(input.tls_ca_pem, "private input tls_ca_pem");
    this.#fixture = fixtureIdentity(input.fixture);
    this.#request = requestImpl;
    this.#signal = signal;
  }

  get fixtureIdentity() { return this.#fixture; }
  get events() { return structuredClone(this.#events); }
  get privateInputIdentity() {
    const fixtureIdentity = {
      site_id: this.#fixture.site_id,
      page_id: this.#fixture.page_id,
      revision_id: this.#fixture.revision_id,
      page_slug: this.#fixture.page_slug,
      source_sha256: this.#fixture.source_sha256,
      provenance: this.#fixture.provenance,
      visible_user: this.#fixture.visible_user,
      deleted_user: this.#fixture.deleted_user,
    };
    return {
      deepwell_rpc_url: this.#rpc.url.href,
      deepwell_rpc_token_sha256: sha256(this.#rpcToken),
      tls_ca_sha256: sha256(this.#tlsCa),
      fixture_identity_sha256: sha256Value(fixtureIdentity),
      fixture_provenance: this.#fixture.provenance,
      site_id: this.#fixture.site_id,
      page_id: this.#fixture.page_id,
      revision_id: this.#fixture.revision_id,
      page_slug: this.#fixture.page_slug,
      visible_user_id: this.#fixture.visible_user.user_id,
      deleted_user_id: this.#fixture.deleted_user.user_id,
    };
  }
  get requiredServiceBindings() {
    return [{ role: "deepwell", container_port: "2747/tcp", host_address: this.#rpc.address, host_port: Number(this.#rpc.url.port) }];
  }

  async rpc(method, params) {
    const response = await this.#request({
      url: this.#rpc.url,
      method: "POST",
      headers: { authorization: this.#rpcAuthorization, "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: this.#rpcId++, method, params })),
      connectAddress: this.#rpc.address,
      tlsCa: this.#tlsCa,
      signal: this.#signal,
    });
    this.#events.push({ method, response_status: response.status });
    let payload;
    try { payload = JSON.parse(response.body); } catch { throw new Error(`${method} returned non-JSON at the public Deepwell seam`); }
    if (response.status !== 200 || payload?.error !== undefined) throw new Error(`${method} failed at the public Deepwell seam`);
    return payload.result;
  }

  async pageGet() {
    return await this.rpc("page_get", { site_id: this.#fixture.site_id, page: this.#fixture.page_slug, details: { wikitext: true, compiled: false } });
  }

  async preview() {
    return await this.rpc("wikidot_page_preview", { site_id: this.#fixture.site_id, title: "#1026 candidate user identity", wikitext: this.#fixture.source });
  }

  async savedPage() {
    return await this.rpc("page_view", { site_id: this.#fixture.site_id, session_token: null, route: { slug: this.#fixture.page_slug, extra: "" }, locales: ["en-US", "en"] });
  }
}

const SOURCE_FILES = Object.freeze([
  "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
  "install/local/wikidot-verification/src/candidate-case-command.mjs",
  "install/local/wikidot-verification/src/candidate-case-http.mjs",
  "install/local/wikidot-verification/src/candidate-case-runner.mjs",
  "install/local/wikidot-verification/src/candidate-source-execution-identity.mjs",
  "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
  "install/local/wikidot-verification/src/open43-q1026-user-identity-candidate-case-set.mjs",
  "install/local/wikidot-verification/src/open43-q1026-user-identity-candidate-contract.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
  "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
  "install/local/wikidot-verification/package.json",
  "install/local/wikidot-verification/pnpm-lock.yaml",
  FIXTURE_PROVENANCE.source_file,
]);

export function createOpen43Q1026UserIdentityCandidateCaseSet({ sessionFactory = (options) => new Open43Q1026UserIdentityCandidateSession(options) } = {}) {
  return Object.freeze({
    id: "open43-q1026-user-identity",
    caseIds: OPEN43_Q1026_USER_IDENTITY_CASE_IDS,
    prepareRun({ privateInput, signal }) {
      const session = sessionFactory({ privateInput, signal });
      const fixture = session.fixtureIdentity;
      const privateInputIdentity = session.privateInputIdentity;
      const execute = async () => {
        const page = await session.pageGet();
        if (page?.page_id !== fixture.page_id || page?.revision_id !== fixture.revision_id || page?.slug !== fixture.page_slug || page?.wikitext !== fixture.source) throw new Error("#1026 candidate saved fixture does not match the exact existing source identity");
        const preview = await session.preview();
        const saved = await session.savedPage();
        const savedData = saved?.type === "found" ? saved.data : null;
        const previewBody = requireNonEmptyString(preview?.body, "#1026 candidate preview body");
        const savedBody = requireNonEmptyString(savedData?.compiled_body_html, "#1026 candidate saved page body");
        const observations = {
          source_sha256: fixture.source_sha256,
          page_get: { site_id: fixture.site_id, page_id: page.page_id, revision_id: page.revision_id, slug: page.slug, wikitext_sha256: sha256(page.wikitext) },
          preview_body: previewBody,
          saved_body: savedBody,
          preview_surface_sha256: sha256Value(previewBody),
          saved_surface_sha256: sha256Value(savedBody),
          rpc_events: { methods: session.events.map(({ method }) => method), statuses: session.events.map(({ response_status }) => response_status) },
        };
        return [{ case_id: OPEN43_Q1026_USER_IDENTITY_CASE_IDS[0], observations }];
      };
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity,
        plan: {
          schema: "wikijump.open43_q1026_user_identity_candidate_plan.v1",
          case_ids: OPEN43_Q1026_USER_IDENTITY_CASE_IDS,
          site_id: fixture.site_id,
          page_id: fixture.page_id,
          revision_id: fixture.revision_id,
          page_slug: fixture.page_slug,
          source_sha256: fixture.source_sha256,
          fixture: { provenance: fixture.provenance, visible_user: fixture.visible_user, deleted_user: fixture.deleted_user },
          candidate_observation_scope: "anonymous-read-only-public-deepwell-rpc",
        },
        execute,
        cleanup: async () => structuredClone(NO_MUTATION_CLEANUP),
        verifyCase: (caseId, observations) => verifyOpen43Q1026UserIdentityCase(caseId, observations, {
          site_id: fixture.site_id,
          page_id: fixture.page_id,
          revision_id: fixture.revision_id,
          page_slug: fixture.page_slug,
          source_sha256: fixture.source_sha256,
          fixture: { visible_user: fixture.visible_user, deleted_user: fixture.deleted_user },
        }),
        verifyCleanup: verifyOpen43Q1026UserIdentityCleanup,
      });
    },
  });
}
