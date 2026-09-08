import { createHash } from "node:crypto";
import net from "node:net";

import { requestCandidateCaseHttp } from "./candidate-case-http.mjs";
import { deepwellRpcAuthorization } from "./deepwell-rpc-auth.mjs";
import {
  verifyOpen43Q1026ActorMatrixCase,
  verifyOpen43Q1026PrintuserIntervalsCase,
  verifyOpen43Q1026UserIdentityCase,
  verifyOpen43Q1026UserIdentityCleanup,
} from "./open43-q1026-user-identity-candidate-contract.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import { isExpectedExternalAssetFailure } from "./standing-browser-parity-observation.mjs";
import {
  requireNonEmptyString,
  requirePlainObject,
  requireSha256,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_Q1026_USER_IDENTITY_CASE_IDS = Object.freeze([
  "Q1026_EXACT_CANDIDATE_PREVIEW_SAVED_IDENTITY",
  "Q1026_BROWSER_PRINTUSER_INTERVALS",
  "Q1026_ACTOR_SPECIAL_IDENTITY_MATRIX",
]);

const SITE_HOST = "scpaiueouiuiuiui.wikijump.localhost";
const FIXTURE_ID = "Q1026_PRINTUSER_INTERVALS";
const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const CAPTURE_TIMEOUT_MS = 300_000;

export const Q1026_FIXTURE_PROVENANCE = Object.freeze({
  path: "deepwell/tests/page.rs#wikidot_user_blocks_match_live_preview_and_saved_page_identity_boundaries",
  source_file: "deepwell/tests/page.rs",
  sha256: "b47242cdfd57e122367c43397527a576cf02df34aa7186ca4c11cb4675dd118b",
});
const FIXTURE_SOURCE_SHA256 = "201031ec502c99355498ef27533d2c10f15bf49c959116a3bfacba9ce2f0a92d";
export const Q1026_USER_FIXTURES = Object.freeze({
  visible_user: Object.freeze({ user_id: 19_102_600, name: "Extant User", slug: "extant-user", is_deleted: false }),
  deleted_user: Object.freeze({ user_id: 19_102_601, name: "Deleted User", slug: "deleted-user", is_deleted: true }),
  name_only_user: Object.freeze({ user_id: 19_102_602, name: "Name Only User", slug: "name-only-slug", is_deleted: false }),
  collision_first_user: Object.freeze({ user_id: 19_102_603, name: "Shared Person", slug: "shared-person-first", is_deleted: false }),
  collision_second_user: Object.freeze({ user_id: 19_102_604, name: "Shared_Person", slug: "shared-person-second", is_deleted: false }),
  unicode_user: Object.freeze({ user_id: 19_102_605, name: "Éclair\tName\u00a0JP", slug: "unicode-name", is_deleted: false }),
  numeric_target_user: Object.freeze({ user_id: 2, name: "Numeric Target", slug: "numeric-target", is_deleted: false }),
  display_numeric_name_user: Object.freeze({ user_id: 19_102_606, name: "2", slug: "display-two", is_deleted: false }),
  system_user: Object.freeze({ user_id: 122_357, name: "system", slug: "system", is_deleted: false }),
});
const ACTOR_NAMES = Object.freeze(["anonymous", "editor", "administrator", "other"]);
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

export function buildQ1026UserIdentitySource(users = Q1026_USER_FIXTURES) {
  const visible = users.visible_user;
  const deleted = users.deleted_user;
  return [
    `NAME=[[user ${visible.name}]]`,
    `NAME_STAR=[[*user ${visible.name}]]`,
    `NAME_ONLY=[[user ${users.name_only_user.name}]]`,
    `COLLISION=[[*user ${users.collision_first_user.name}]]`,
    "UNKNOWN_AVATAR=[[*user Unknown Avatar User]]",
    "UNICODE=[[user éCLAIR\u00a0name\tjp]]",
    "NUMERIC_DISPLAY=[[user 2]]",
    `ID=[[*user ${visible.user_id}]]`,
    `DELETED=[[user ${deleted.name}]]`,
    "SYSTEM=[[user system]]",
    "ANONYMOUS=[[user anonymous]]",
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
  const users = Object.fromEntries(Object.entries(Q1026_USER_FIXTURES).map(([name, expected]) => [name, userFixture(input[name], name, expected.is_deleted)]));
  if (!Number.isSafeInteger(input.site_id) || input.site_id <= 0 || !Number.isSafeInteger(page.page_id) || !Number.isSafeInteger(page.revision_id) || typeof page.slug !== "string" || !page.slug) throw new Error("private input #1026 fixture identity is invalid");
  for (const [name, expected] of Object.entries(Q1026_USER_FIXTURES)) {
    if (JSON.stringify(users[name]) !== JSON.stringify(expected)) throw new Error(`private input #1026 ${name} is not the existing identity fixture`);
  }
  const source = buildQ1026UserIdentitySource(users);
  const sourceSha256 = requireSha256(input.source_sha256, "private input #1026 source SHA-256");
  if (sourceSha256 !== FIXTURE_SOURCE_SHA256 || sha256(source) !== FIXTURE_SOURCE_SHA256) throw new Error("private input #1026 source hash does not match the fixed identity matrix");
  const provenance = requirePlainObject(input.provenance, "private input #1026 fixture provenance");
  if (provenance.path !== Q1026_FIXTURE_PROVENANCE.path || provenance.source_file !== Q1026_FIXTURE_PROVENANCE.source_file) throw new Error("private input #1026 fixture provenance is not the existing user identity fixture");
  if (provenance.sha256 !== Q1026_FIXTURE_PROVENANCE.sha256) throw new Error("private input #1026 fixture source SHA-256 is not the existing identity fixture");
  return Object.freeze({
    site_id: input.site_id,
    page_id: page.page_id,
    revision_id: page.revision_id,
    page_slug: page.slug,
    source_sha256: sourceSha256,
    provenance: Object.freeze({ path: provenance.path, source_file: provenance.source_file, sha256: provenance.sha256 }),
    ...users,
    source,
  });
}

function candidateActor(value, name) {
  const actor = requirePlainObject(value, `private input #1026 actor ${name}`);
  if (!Number.isSafeInteger(actor.user_id) || typeof actor.session_token !== "string" || !actor.session_token.startsWith("wj:")) throw new Error(`private input #1026 actor ${name} is invalid`);
  return Object.freeze({ user_id: actor.user_id, session_token: actor.session_token });
}

export class Open43Q1026UserIdentityCandidateSession {
  #rpc;
  #rpcAuthorization;
  #rpcToken;
  #tlsCa;
  #fixture;
  #actors;
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
    const actors = requirePlainObject(input.actors, "private input #1026 actors");
    this.#actors = Object.freeze(Object.fromEntries(ACTOR_NAMES.filter((name) => name !== "anonymous").map((name) => [name, candidateActor(actors[name], name)])));
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
      users: Object.fromEntries(Object.keys(Q1026_USER_FIXTURES).map((name) => [name, this.#fixture[name]])),
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
      actor_identities: Object.fromEntries(Object.entries(this.#actors).map(([name, actor]) => [name, { user_id: actor.user_id, session_token_sha256: sha256(actor.session_token) }])),
    };
  }
  get requiredServiceBindings() {
    return [{ role: "deepwell", container_port: "2747/tcp", host_address: this.#rpc.address, host_port: Number(this.#rpc.url.port) }];
  }

  async rpc(method, params, { sessionToken = null } = {}) {
    const response = await this.#request({
      url: this.#rpc.url,
      method: "POST",
      headers: { authorization: this.#rpcAuthorization, "content-type": "application/json", ...(sessionToken === null ? {} : { "x-deepwell-session-token": sessionToken }) },
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

  actorUserId(name) {
    if (name === "anonymous") return null;
    return this.#actors[name]?.user_id ?? null;
  }

  async preview(actor = "anonymous") {
    const sessionToken = actor === "anonymous" ? null : this.#actors[actor]?.session_token;
    if (actor !== "anonymous" && !sessionToken) throw new Error(`unknown #1026 candidate actor ${actor}`);
    return await this.rpc("wikidot_page_preview", { site_id: this.#fixture.site_id, title: "#1026 candidate user identity", wikitext: this.#fixture.source }, { sessionToken });
  }

  async savedPage(actor = "anonymous") {
    const sessionToken = actor === "anonymous" ? null : this.#actors[actor]?.session_token;
    if (actor !== "anonymous" && !sessionToken) throw new Error(`unknown #1026 candidate actor ${actor}`);
    return await this.rpc("page_view", { site_id: this.#fixture.site_id, session_token: sessionToken, route: { slug: this.#fixture.page_slug, extra: "" }, locales: ["en-US", "en"] }, { sessionToken });
  }
}

const SOURCE_FILES = Object.freeze([
  "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
  "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
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
  Q1026_FIXTURE_PROVENANCE.source_file,
]);

class Open43Q1026PrintuserBrowserAdapter {
  #browserContexts;
  #pageOrigin;
  #slug;

  constructor({ browserContexts, pageOrigin, slug }) {
    if (typeof browserContexts?.newCandidateContext !== "function" || typeof browserContexts?.setActiveFixture !== "function") {
      throw new Error("#1026 browser contexts are required");
    }
    this.#browserContexts = browserContexts;
    this.#pageOrigin = pageOrigin;
    this.#slug = slug;
  }

  async capturePrintuser() {
    await this.#browserContexts.setActiveFixture(FIXTURE_ID);
    const owned = await this.#browserContexts.newCandidateContext({ viewport: DEFAULT_VIEWPORT });
    const page = await owned.context.newPage();
    const requestMethods = [];
    const failedRequests = [];
    const expectedExternalFailures = [];
    const onRequest = (request) => requestMethods.push(request.method());
    const onFailed = (request) => {
      const event = { url: request.url(), method: request.method(), resource_type: request.resourceType?.() ?? "other", failure: request.failure()?.errorText ?? null };
      (isExpectedExternalAssetFailure({ ...event, error: event.failure }) ? expectedExternalFailures : failedRequests).push(event);
    };
    page.on("request", onRequest);
    page.on("requestfailed", onFailed);
    const url = new URL(`/${this.#slug}`, this.#pageOrigin).href;
    const readState = () => page.evaluate(() => {
      const printusers = [...document.querySelectorAll("span.printuser")];
      const errors = [...document.querySelectorAll("span.error-inline")];
      return {
        printuser_count: printusers.length,
        avatarhover_count: printusers.filter((span) => span.classList.contains("avatarhover")).length,
        anchors: printusers.flatMap((span) => [...span.querySelectorAll("a")].map((a) => ({ href: a.getAttribute("href"), onclick: a.getAttribute("onclick") }))),
        avatar_images: printusers.flatMap((span) => [...span.querySelectorAll("img")].map((img) => ({ class: img.getAttribute("class"), alt: img.getAttribute("alt"), style: img.getAttribute("style") }))),
        error_count: errors.length,
        error_em_html: errors.map((span) => span.querySelector("em")?.textContent ?? null),
        error_texts: errors.map((span) => span.textContent ?? ""),
        error_anchor_counts: errors.map((span) => span.querySelectorAll("a").length),
        anonymous_literal_present: document.body.textContent?.includes("ANONYMOUS=Anonymous") ?? false,
      };
    });
    try {
      const navigation = await page.goto(url, { waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS });
      const initial = await readState();
      const settled = await readState();
      return {
        saved_page: { slug: this.#slug, url, status: navigation?.status() ?? 0 },
        initial,
        settled,
        request_methods: requestMethods,
        failed_requests: failedRequests,
        expected_external_failures: expectedExternalFailures,
        mutation_detected: requestMethods.some((method) => !["GET", "HEAD", "OPTIONS"].includes(method)),
      };
    } finally {
      page.off("request", onRequest);
      page.off("requestfailed", onFailed);
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }
}

export function createOpen43Q1026UserIdentityCandidateCaseSet({ sessionFactory = (options) => new Open43Q1026UserIdentityCandidateSession(options) } = {}) {
  return Object.freeze({
    id: "open43-q1026-user-identity",
    caseIds: OPEN43_Q1026_USER_IDENTITY_CASE_IDS,
    prepareRun({ candidateIdentity, privateInput, signal, candidateBrowserContexts }) {
      const endpoint = candidateIdentity?.candidate?.endpoint;
      if (endpoint?.host !== SITE_HOST || endpoint.port === 443 || candidateIdentity.candidate.port_443_published !== false) {
        throw new Error(`#1026 requires exact non-standing ${SITE_HOST}`);
      }
      const pageOrigin = candidatePageOrigin(candidateIdentity);
      const session = sessionFactory({ privateInput, signal });
      const fixture = session.fixtureIdentity;
      const privateInputIdentity = session.privateInputIdentity;
      const browser = new Open43Q1026PrintuserBrowserAdapter({
        browserContexts: candidateBrowserContexts,
        pageOrigin,
        slug: fixture.page_slug,
      });
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
        const actorSurfaces = {
          anonymous: {
            user_id: null,
            preview_sha256: sha256Value(previewBody),
            saved_sha256: sha256Value(savedBody),
          },
        };
        for (const actor of ACTOR_NAMES.slice(1)) {
          const actorPreview = await session.preview(actor);
          const actorSaved = await session.savedPage(actor);
          const actorPreviewBody = requireNonEmptyString(actorPreview?.body, `#1026 ${actor} preview body`);
          const actorSavedData = actorSaved?.type === "found" ? actorSaved.data : null;
          const actorSavedBody = requireNonEmptyString(actorSavedData?.compiled_body_html, `#1026 ${actor} saved page body`);
          actorSurfaces[actor] = {
            user_id: session.actorUserId(actor),
            preview_sha256: sha256Value(actorPreviewBody),
            saved_sha256: sha256Value(actorSavedBody),
          };
        }
        const printuser = await browser.capturePrintuser();
        return [
          { case_id: OPEN43_Q1026_USER_IDENTITY_CASE_IDS[0], observations },
          { case_id: OPEN43_Q1026_USER_IDENTITY_CASE_IDS[1], observations: printuser },
          { case_id: OPEN43_Q1026_USER_IDENTITY_CASE_IDS[2], observations: { source_sha256: fixture.source_sha256, actor_surfaces: actorSurfaces } },
        ];
      };
      const verifyPlan = {
        site_id: fixture.site_id,
        page_id: fixture.page_id,
        revision_id: fixture.revision_id,
        page_slug: fixture.page_slug,
        source_sha256: fixture.source_sha256,
        fixture: Object.fromEntries(Object.keys(Q1026_USER_FIXTURES).map((name) => [name, fixture[name]])),
        actor_user_ids: Object.fromEntries(ACTOR_NAMES.map((name) => [name, session.actorUserId(name)])),
        page_origin: pageOrigin,
      };
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity,
        browserCredentialPolicy: "none",
        plan: {
          schema: "wikijump.open43_q1026_user_identity_candidate_plan.v1",
          case_ids: OPEN43_Q1026_USER_IDENTITY_CASE_IDS,
          site_id: fixture.site_id,
          page_id: fixture.page_id,
          revision_id: fixture.revision_id,
          page_slug: fixture.page_slug,
          source_sha256: fixture.source_sha256,
          page_origin: pageOrigin,
          fixture: { provenance: fixture.provenance, users: Object.fromEntries(Object.keys(Q1026_USER_FIXTURES).map((name) => [name, fixture[name]])) },
          actor_user_ids: verifyPlan.actor_user_ids,
          candidate_observation_scope: "read-only-public-deepwell-rpc-actor-matrix-and-anonymous-browser",
        },
        execute,
        cleanup: async () => structuredClone(NO_MUTATION_CLEANUP),
        verifyCase: (caseId, observations) => {
          if (caseId === OPEN43_Q1026_USER_IDENTITY_CASE_IDS[0]) return verifyOpen43Q1026UserIdentityCase(caseId, observations, verifyPlan);
          if (caseId === OPEN43_Q1026_USER_IDENTITY_CASE_IDS[1]) return verifyOpen43Q1026PrintuserIntervalsCase(caseId, observations, verifyPlan);
          return verifyOpen43Q1026ActorMatrixCase(caseId, observations, verifyPlan);
        },
        verifyCleanup: verifyOpen43Q1026UserIdentityCleanup,
      });
    },
  });
}
