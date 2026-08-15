import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";

export const ISSUE1373_AMC_NEW_PAGE_CASE_ID = "M1373_AMC_NEW_PAGE_AUTOSAVE";

const SITE_SLUG = "scpaiueouiuiuiui";
const AMC_PATH = "/ajax-module-connector.php";
const EXPECTED_RESPONSES = Object.freeze([
  ["success", "ok"],
  ["denial", "no_permission"],
  ["malformed", "no_name"],
  ["not_ok", "not_ok"],
]);

const sourceFiles = Object.freeze([
  "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
  "install/local/wikidot-verification/src/atomic-no-replace.mjs",
  "install/local/wikidot-verification/src/candidate-source-execution-identity.mjs",
  "install/local/wikidot-verification/src/candidate-case-runner.mjs",
  "install/local/wikidot-verification/src/candidate-case-command.mjs",
  "install/local/wikidot-verification/src/candidate-case-http.mjs",
  "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
  "install/local/wikidot-verification/src/issue1373-amc-new-page-candidate-case-set.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
  "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
  "install/local/wikidot-verification/package.json",
  "install/local/wikidot-verification/pnpm-lock.yaml",
]);

function runPageSlug(runId) {
  return `run-owned:amc-${runId.slice("candidate-case-".length)}`;
}

function requireCandidateSite(candidateIdentity) {
  const expectedHost = `${SITE_SLUG}.wikijump.localhost`;
  if (candidateIdentity.candidate.endpoint.host !== expectedHost) {
    throw new Error(`issue 1373 AMC cases require ${expectedHost}`);
  }
}

function requiredBindings(candidateIdentity, session) {
  return [
    {
      role: "caddy",
      container_port: "443/tcp",
      host_address: candidateIdentity.candidate.endpoint.local_connect_address,
      host_port: candidateIdentity.candidate.endpoint.port,
    },
    ...session.requiredServiceBindings,
  ];
}

class Issue1373AmcRun {
  #session;
  #resources;
  #pageSlug;
  #siteId = null;
  #page = null;
  #pageResource = null;

  constructor({ session, resources, pageSlug }) {
    this.#session = session;
    this.#resources = resources;
    this.#pageSlug = pageSlug;
  }

  async #rpc(method, params = {}, options = {}) {
    return await this.#session.rpc(method, params, {
      siteId: this.#siteId ?? undefined,
      page: this.#pageSlug,
      ...options,
    });
  }

  async #pageGet({ actor = "editor", cleanup = false } = {}) {
    return await this.#rpc(
      "page_get",
      {
        site_id: this.#siteId,
        page: this.#pageSlug,
        details: { wikitext: false, compiled: false },
      },
      { actor, cleanup },
    );
  }

  async #amc(fields, options = {}) {
    const response = await this.#session.ajaxModuleConnector(fields, options);
    if (response.http_status !== 200 || typeof response.json?.status !== "string") {
      throw new Error("AMC response was not a JSON status envelope");
    }
    return {
      http_status: response.http_status,
      status: response.json.status,
      body_sha256: response.response_body_sha256,
      ...(response.json.goToUrl === undefined ? {} : { go_to_url: response.json.goToUrl }),
    };
  }

  async execute() {
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG });
    if (!Number.isSafeInteger(site?.site_id)) {
      throw new Error(`editable candidate site ${SITE_SLUG} is missing`);
    }
    this.#siteId = site.site_id;
    if ((await this.#pageGet({ actor: "anonymous" })) !== null) {
      throw new Error("issue 1373 AMC run-owned page already exists");
    }

    const pageName = this.#pageSlug;
    const success = await this.#amc({
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      pageName,
      mode: "save-and-go",
    });
    if (success.status !== "ok" || success.go_to_url !== pageName) {
      throw new Error("NewPage autosave did not create the expected run-owned page");
    }

    const created = await this.#pageGet();
    if (
      !created ||
      !Number.isSafeInteger(created.page_id) ||
      created.slug !== pageName
    ) {
      throw new Error("NewPage autosave did not expose the created public page identity");
    }
    this.#page = {
      page_id: created.page_id,
      slug: created.slug,
    };
    this.#pageResource = this.#resources.register("page", this.#page);

    const denial = await this.#amc(
      {
        action: "misc/NewPageHelperAction",
        event: "createNewPage",
        moduleName: "Empty",
        pageName: `${pageName}-denied`,
        mode: "save-and-go",
      },
      { actor: "anonymous" },
    );
    const malformed = await this.#amc({
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      mode: "save-and-go",
    });
    const notOk = await this.#amc({
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      pageName: `${pageName}-invalid`,
      mode: "save-and-refresh",
      template: "1469068213",
      tags: "unexpected",
    });

    return [
      {
        case_id: ISSUE1373_AMC_NEW_PAGE_CASE_ID,
        observations: {
          boundary: AMC_PATH,
          candidate_page_origin: this.#session.pageOrigin,
          page_id: this.#page.page_id,
          page_slug: this.#page.slug,
          responses: [
            { label: "success", ...success },
            { label: "denial", ...denial },
            { label: "malformed", ...malformed },
            { label: "not_ok", ...notOk },
          ],
        },
      },
    ];
  }

  async cleanup() {
    if (this.#page === null) {
      return {
        public_absence_verified: true,
        page_get: null,
        delete_status: null,
      };
    }

    const deleted = await this.#amc(
      {
        action: "WikiPageAction",
        event: "deletePage",
        page_id: String(this.#page.page_id),
        moduleName: "Empty",
        wikidot_token7: "candidate-case",
      },
      { cleanup: true },
    );
    if (deleted.status !== "ok") {
      throw new Error("run-owned AMC page cleanup did not report success");
    }
    const pageAfterDelete = await this.#pageGet({
      actor: "anonymous",
      cleanup: true,
    });
    if (pageAfterDelete !== null) {
      throw new Error("run-owned AMC page remains publicly visible after cleanup");
    }
    this.#resources.release(this.#pageResource, {
      page_get: null,
      delete_status: deleted.status,
    });
    return {
      public_absence_verified: true,
      page_get: null,
      delete_status: deleted.status,
    };
  }
}

export function createIssue1373AmcNewPageCandidateCaseSet(options) {
  if (options !== undefined) {
    throw new Error("issue 1373 AMC candidate cases do not accept checkout or in-process injection");
  }
  return Object.freeze({
    id: "issue1373-amc-new-page",
    caseIds: [ISSUE1373_AMC_NEW_PAGE_CASE_ID],
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources }) {
      requireCandidateSite(candidateIdentity);
      const session = new CandidateHttpSession({
        candidateIdentity,
        privateInput,
        signal,
      });
      if (session.pageOrigin !== candidatePageOrigin(candidateIdentity)) {
        throw new Error("AMC session did not bind the sealed candidate page origin");
      }
      const pageSlug = runPageSlug(runId);
      const execution = new Issue1373AmcRun({
        session,
        resources,
        pageSlug,
      });
      return Object.freeze({
        sourceFiles,
        runtimeBindings: requiredBindings(candidateIdentity, session),
        privateInputIdentity: session.privateInputIdentity,
        plan: {
          schema: "wikijump.issue1373.amc_new_page_candidate_plan.v1",
          site_slug: SITE_SLUG,
          page_slug: pageSlug,
          public_boundary: AMC_PATH,
          candidate_page_origin: session.pageOrigin,
          expected_responses: EXPECTED_RESPONSES,
          cleanup: "public WikiPageAction/deletePage followed by anonymous page_get absence",
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase(caseId, observations) {
          if (caseId !== ISSUE1373_AMC_NEW_PAGE_CASE_ID) {
            throw new Error(`unexpected issue 1373 candidate case: ${caseId}`);
          }
          const actual = observations.responses.map(({ label, status }) => [label, status]);
          if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_RESPONSES)) {
            throw new Error("issue 1373 AMC response observations are incorrect");
          }
          if (
            observations.boundary !== AMC_PATH ||
            observations.candidate_page_origin !== session.pageOrigin ||
            observations.responses.some(({ http_status }) => http_status !== 200)
          ) {
            throw new Error("issue 1373 candidate did not use the public AMC boundary");
          }
          return { verified: true, expected_responses: EXPECTED_RESPONSES };
        },
        verifyCleanup(proof) {
          if (
            proof?.public_absence_verified !== true ||
            proof.page_get !== null ||
            proof.delete_status !== "ok"
          ) {
            throw new Error("issue 1373 AMC cleanup did not prove public absence");
          }
          return { public_absence_verified: true };
        },
      });
    },
  });
}
