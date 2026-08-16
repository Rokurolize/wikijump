import { createHash } from "node:crypto";

import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import {
  requirePlainObject,
  sha256Value,
} from "./standing-browser-parity-util.mjs";
import {
  MEMBERS_AJAX_FORM,
  MEMBERS_PARAMETERS,
  OPEN43_Q1032_CASE_IDS,
  OPEN43_Q1032_EVIDENCE,
  SEARCHUSERS_DISABLED_SHA256,
  USERINFO_NO_TARGET_SHA256,
  validateOpen43Q1032PrivateInput,
  verifyOpen43Q1032AjaxCase,
  verifyOpen43Q1032BrowserDirectoryCase,
  verifyOpen43Q1032Case,
  verifyOpen43Q1032Cleanup,
} from "./open43-q1032-members-userinfo-candidate-contract.mjs";

export { OPEN43_Q1032_CASE_IDS } from "./open43-q1032-members-userinfo-candidate-contract.mjs";

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const DIRECTORY_CAPTURE = Object.freeze({
  slug: "q1032-browser-directory",
  theme_family: "candidate",
  presence_probes: Object.freeze([
    Object.freeze({ id: "members-table", selector: "#page-content table", minimum_count: 1, require_rendered: true }),
    Object.freeze({ id: "members-pager", selector: "#page-content .pager-no", minimum_count: 1, require_rendered: true }),
    Object.freeze({ id: "whoinvited-form", selector: "form#who-invited-form", minimum_count: 1, require_rendered: true }),
  ]),
});
const VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const TIMEOUT_MS = 300_000;

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireCandidateSite(candidateIdentity) {
  const endpoint = candidateIdentity.candidate.endpoint;
  if (endpoint.host !== SITE_HOST || endpoint.port === 443 || candidateIdentity.candidate.port_443_published !== false) {
    throw new Error(`Q1032 cases require exact non-standing ${SITE_HOST}`);
  }
}

function membersObservation(result) {
  if (result?.status !== "ok" || typeof result.body !== "string") throw new Error("Members public RPC returned a malformed response");
  return {
    rpc_status: result.status,
    body_sha256: sha256Text(result.body),
    body_length: Buffer.byteLength(result.body),
    row_count: (result.body.match(/<tr\b/gu) ?? []).length,
    markers: {
      table: result.body.includes("<table>"),
      pager: result.body.includes('<span class="pager-no">page 1 of '),
      module_script: result.body.includes('OZONE.ajax.requestModule("membership/MembersListModule"'),
    },
  };
}

function previewObservation(result) {
  if (typeof result?.body !== "string") throw new Error("Q1032 public preview RPC returned a malformed response");
  return {
    rpc_status: "ok",
    body_sha256: sha256Text(result.body),
    body_length: Buffer.byteLength(result.body),
  };
}

function ajaxObservation(value) {
  if (typeof value?.http_status !== "number" || typeof value.content_type !== "string" || typeof value.response_body_sha256 !== "string") {
    throw new Error("Q1032 AJAX connector returned a malformed observation");
  }
  return {
    http_status: value.http_status,
    content_type: value.content_type,
    response_body_sha256: value.response_body_sha256,
    json: value.json,
  };
}

function directoryState(page) {
  return page.evaluate(() => {
    const membersScript = Array.from(document.querySelectorAll("script"))
      .some((script) => script.textContent?.includes('OZONE.ajax.requestModule("membership/MembersListModule"') === true);
    const bodyText = document.body?.innerText ?? "";
    const printusers = Array.from(document.querySelectorAll("#page-content .printuser.avatarhover a"));
    return {
      members_table: document.querySelectorAll("#page-content table").length > 0,
      members_pager: document.querySelectorAll("#page-content .pager-no").length > 0,
      members_script: membersScript,
      searchusers_disabled: bodyText.includes("User search has been (temporarily) disabled. Sorry!") === true,
      whoinvited_form: document.querySelectorAll("form#who-invited-form, input#user-lookup").length === 2,
      printuser_count: printusers.length,
      printuser_listener: printusers.some((anchor) => anchor.getAttribute("onclick")?.includes("WIKIDOT.page.listeners.userInfo(") === true),
    };
  });
}

class Open43Q1032Run {
  #session;
  #administratorSession;
  #input;
  #pageOrigin;
  #browserContexts;

  constructor(session, input, pageOrigin, browserContexts, administratorSession) {
    this.#session = session;
    this.#administratorSession = administratorSession;
    this.#input = input;
    this.#pageOrigin = pageOrigin;
    this.#browserContexts = browserContexts;
  }

  async #ajax(actor, fields) {
    if (actor === "administrator") {
      return await this.#administratorSession.ajaxModuleConnector(fields, { actor: "editor" });
    }
    return await this.#session.ajaxModuleConnector(fields, { actor });
  }

  async #directoryMatrix() {
    const members = await this.#session.rpc(
      "wikidot_members_list_module",
      { site_id: this.#input.site_id, parameters: MEMBERS_PARAMETERS },
      { actor: "anonymous", siteId: this.#input.site_id },
    );
    const [anonymous, editor, searchAnonymous, searchEditor] = await Promise.all([
      this.#session.rpc(
        "wikidot_page_preview",
        { site_id: this.#input.site_id, title: this.#input.preview_title, wikitext: "[[module UserInfo]]" },
        { actor: "anonymous", siteId: this.#input.site_id },
      ),
      this.#session.rpc(
        "wikidot_page_preview",
        { site_id: this.#input.site_id, title: this.#input.preview_title, wikitext: "[[module UserInfo]]" },
        { actor: "editor", siteId: this.#input.site_id },
      ),
      this.#session.rpc(
        "wikidot_page_preview",
        { site_id: this.#input.site_id, title: this.#input.preview_title, wikitext: "[[module SearchUsers]]" },
        { actor: "anonymous", siteId: this.#input.site_id },
      ),
      this.#session.rpc(
        "wikidot_page_preview",
        { site_id: this.#input.site_id, title: this.#input.preview_title, wikitext: "[[module SearchUsers]]" },
        { actor: "editor", siteId: this.#input.site_id },
      ),
    ]);
    return [{
      case_id: OPEN43_Q1032_CASE_IDS[0],
      observations: {
        members: membersObservation(members),
        userinfo: { anonymous: previewObservation(anonymous), editor: previewObservation(editor) },
        searchusers: { anonymous: previewObservation(searchAnonymous), editor: previewObservation(searchEditor) },
      },
    }];
  }

  async #membersAjax() {
    const response = await this.#ajax("anonymous", MEMBERS_AJAX_FORM);
    const pages = [];
    for (const page of [0, 1, 2, 3]) {
      pages.push({
        page,
        response: await this.#ajax("anonymous", { ...MEMBERS_AJAX_FORM, page: String(page) }),
      });
    }
    const outOfRange = {
      page: 1468,
      response: await this.#ajax("anonymous", { ...MEMBERS_AJAX_FORM, page: "1468" }),
    };
    const actor_matrix = [];
    for (const actor of ["anonymous", "editor", "administrator"]) {
      actor_matrix.push({
        actor,
        response: await this.#ajax(actor, { ...MEMBERS_AJAX_FORM, page: "2" }),
      });
    }
    const missing_identity = {
      envelope: await this.#ajax("anonymous", { moduleName: "profile/UserInfoModule", user_id: "", callbackIndex: "1" }),
    };
    return [{
      case_id: OPEN43_Q1032_CASE_IDS[1],
      observations: {
        request_form: MEMBERS_AJAX_FORM,
        response: ajaxObservation(response),
        pages: pages.map(({ page, response: pageResponse }) => ({ page, response: ajaxObservation(pageResponse) })),
        out_of_range: { page: outOfRange.page, response: ajaxObservation(outOfRange.response) },
        actor_matrix: actor_matrix.map(({ actor, response: actorResponse }) => ({ actor, response: ajaxObservation(actorResponse) })),
        missing_identity: { envelope: ajaxObservation(missing_identity.envelope) },
      },
    }];
  }

  async #browserDirectory() {
    const savedPage = await this.#session.pageRequest(this.#input.saved_page.slug, { actor: "anonymous" });
    if (typeof savedPage?.status !== "number") throw new Error("Q1032 browser saved page returned a malformed response");
    await this.#browserContexts.setActiveFixture("Q1032_BROWSER_DIRECTORY_ACTIONS");
    const { context } = await this.#browserContexts.newCandidateContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const requestMethods = new Set();
    const failedRequests = [];
    const mutations = [];
    const onRequest = (request) => requestMethods.add(request.method());
    const onRequestFailed = (request) => failedRequests.push({ url: request.url(), failure: request.failure()?.errorText ?? null });
    const onResponse = (response) => {
      if (["POST", "PUT", "DELETE", "PATCH"].includes(response.request().method())) {
        mutations.push({ url: response.url(), method: response.request().method(), status: response.status() });
      }
    };
    page.on("request", onRequest);
    page.on("requestfailed", onRequestFailed);
    page.on("response", onResponse);
    let initial = null;
    let settled = null;
    try {
      const url = `${this.#pageOrigin}/${encodeURIComponent(this.#input.saved_page.slug)}`;
      const capture = await this.#browserContexts.captureCandidateObservation({
        context,
        page,
        url,
        label: "Q1032_BROWSER_DIRECTORY_ACTIONS",
        index: 0,
        contract: DIRECTORY_CAPTURE,
        viewport: VIEWPORT,
        timeoutMs: TIMEOUT_MS,
        settleMs: 0,
        onPhase: async (phase) => {
          if (phase === "domcontentloaded_immediate_observation") initial = await directoryState(page);
          if (phase === "settled") settled = await directoryState(page);
        },
      });
      if (capture?.capture_error !== undefined || capture?.navigation_status !== 200) {
        throw new Error(`Q1032 browser directory capture failed: ${capture?.capture_error?.message ?? `status ${capture?.navigation_status}`}`);
      }
      if (initial === null || settled === null) throw new Error("Q1032 browser directory phases were not both observed");
      const state = await directoryState(page);
      return [{
        case_id: OPEN43_Q1032_CASE_IDS[2],
        observations: {
          saved_page: {
            slug: this.#input.saved_page.slug,
            status: savedPage.status,
            url: `${this.#pageOrigin}/${this.#input.saved_page.slug}`,
          },
          initial,
          settled: state,
          request_methods: [...requestMethods].sort(),
          failed_requests: failedRequests,
          mutation_detected: mutations.length > 0,
        },
      }];
    } finally {
      page.off("request", onRequest);
      page.off("requestfailed", onRequestFailed);
      page.off("response", onResponse);
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }

  async execute() {
    return [
      ...(await this.#directoryMatrix()),
      ...(await this.#membersAjax()),
      ...(await this.#browserDirectory()),
    ];
  }

  async cleanup() {
    return { public_absence_verified: true, mutation_count: 0, cleanup_required: false };
  }
}

const SOURCE_FILES = Object.freeze([
  "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
  "install/local/wikidot-verification/src/atomic-no-replace.mjs",
  "install/local/wikidot-verification/src/candidate-source-execution-identity.mjs",
  "install/local/wikidot-verification/src/candidate-case-runner.mjs",
  "install/local/wikidot-verification/src/candidate-case-command.mjs",
  "install/local/wikidot-verification/src/candidate-case-http.mjs",
  "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
  "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
  "install/local/wikidot-verification/src/open43-q1032-members-userinfo-candidate-case-set.mjs",
  "install/local/wikidot-verification/src/open43-q1032-members-userinfo-candidate-contract.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
  "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
  OPEN43_Q1032_EVIDENCE.members.path,
  OPEN43_Q1032_EVIDENCE.userinfo.path,
  "install/local/wikidot-verification/package.json",
  "install/local/wikidot-verification/pnpm-lock.yaml",
]);

export function createOpen43Q1032CandidateCaseSet({
  sessionFactory = (options) => new CandidateHttpSession(options),
} = {}) {
  return Object.freeze({
    id: "open43-q1032-members-userinfo",
    caseIds: OPEN43_Q1032_CASE_IDS,
    prepareRun({ candidateIdentity, privateInput, signal, candidateBrowserContexts }) {
      requireCandidateSite(candidateIdentity);
      const input = validateOpen43Q1032PrivateInput(privateInput);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      if (session.pageOrigin !== candidatePageOrigin(candidateIdentity)) throw new Error("Q1032 session did not bind the sealed candidate origin");
      const rawInput = requirePlainObject(privateInput, "Q1032 private input");
      const administrator = requirePlainObject(rawInput.actors?.administrator, "Q1032 administrator actor");
      const administratorSession = sessionFactory({
        candidateIdentity,
        privateInput: { ...rawInput, actors: { editor: administrator } },
        signal,
      });
      if (administratorSession.pageOrigin !== candidatePageOrigin(candidateIdentity)) throw new Error("Q1032 administrator session did not bind the sealed candidate origin");
      const pageOrigin = session.pageOrigin;
      const privateInputIdentity = {
        ...session.privateInputIdentity,
        site_id: input.site_id,
        preview_title: input.preview_title,
        saved_page: input.saved_page,
        saved_page_source_sha256: input.saved_page_source_sha256,
        administrator_session_sha256: sha256Value(administratorSession.privateInputIdentity),
        evidence_sha256: sha256Value(OPEN43_Q1032_EVIDENCE),
      };
      const execution = new Open43Q1032Run(session, input, pageOrigin, candidateBrowserContexts, administratorSession);
      const plan = {
        schema: "wikijump.open43_q1032_members_userinfo_candidate_plan.v1",
        site_slug: SITE_SLUG,
        case_ids: OPEN43_Q1032_CASE_IDS,
        site_id: input.site_id,
        preview_title: input.preview_title,
        page_origin: pageOrigin,
        saved_page: input.saved_page,
        evidence: OPEN43_Q1032_EVIDENCE,
        members: { actor: "anonymous", parameters: MEMBERS_PARAMETERS, public_contract: "status-ok-table-page-one-pager-members-list-script" },
        userinfo: { source: "[[module UserInfo]]", actors: ["anonymous", "editor"], expected_no_target_sha256: USERINFO_NO_TARGET_SHA256 },
        searchusers: { source: "[[module SearchUsers]]", actors: ["anonymous", "editor"], expected_disabled_sha256: SEARCHUSERS_DISABLED_SHA256 },
        members_ajax: { form: MEMBERS_AJAX_FORM, pages: [0, 1, 2, 3], out_of_range_page: 1468, actors: ["anonymous", "editor", "administrator"], envelope: "text-plain-ok-table-page-one-pager-members-list-script-no-includes-null-callback" },
        browser_directory: { saved_slug: input.saved_page.slug, capture_slug: DIRECTORY_CAPTURE.slug, mutation_policy: "read-only" },
        mutation_policy: "read-only",
      };
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity,
        browserCredentialPolicy: "none",
        plan,
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => {
          if (caseId === OPEN43_Q1032_CASE_IDS[1]) return verifyOpen43Q1032AjaxCase(caseId, observations);
          if (caseId === OPEN43_Q1032_CASE_IDS[2]) return verifyOpen43Q1032BrowserDirectoryCase(caseId, observations, plan);
          return verifyOpen43Q1032Case(caseId, observations);
        },
        verifyCleanup: verifyOpen43Q1032Cleanup,
      });
    },
  });
}
