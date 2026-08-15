import { createHash } from "node:crypto";

import { requirePlainObject } from "./standing-browser-parity-util.mjs";

export const OPEN43_A1038_ADMIN_BOUNDARY_CASE_IDS = Object.freeze([
  "A1038_AUTHENTICATED_NON_ADMIN_DENIAL",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const SOURCE = "[[module ManageSite]]";
const TITLE = "A1038 authenticated non-admin boundary";
const ADMIN_HOST = `${SITE_SLUG}.wikijump.localhost`;

const MANAGE_SITE_ANONYMOUS_HTML = [
  '<div class="row-fluid">',
  "\n\t",
  '<div class="span3 offset1">',
  "\n\t\t",
  '<div class="homer">',
  "\n\t\t",
  '<img src="/common--images/404_homer.png">',
  "\n\t\t</div>\n\t</div>\n\t",
  '<div class="span7">',
  "\n\t\t<h1>Doh!</h1>\n",
  "\t\t<h3>You\'re not signed in or you are not an administrator of this Wiki.</h3>\n",
  "\t\t\t\t",
  '<div class="form-actions">',
  "\n\t\t\t",
  '<a href="javascript:;" class="btn btn-primary btn-large" onclick="WIKIDOT.page.listeners.loginClick(event)">Sign in</a>',
  "\n\t\t</div>\n\t\t\t</div>\n</div>",
].join("");

const MANAGE_SITE_NON_ADMIN_HTML = [
  '<div class="row-fluid">',
  "\n\t",
  '<div class="span3 offset1">',
  "\n\t\t",
  '<div class="homer">',
  "\n\t\t",
  '<img src="/common--images/404_homer.png">',
  "\n\t\t</div>\n\t</div>\n\t",
  '<div class="span7">',
  "\n\t\t<h1>Doh!</h1>\n",
  "\t\t<h3>You\'re not signed in or you are not an administrator of this Wiki.</h3>\n",
  "\t\t\t</div>\n</div>",
].join("");

const SOURCE_FILES = Object.freeze([
  "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
  "install/local/wikidot-verification/src/candidate-case-runner.mjs",
  "install/local/wikidot-verification/src/candidate-case-command.mjs",
  "install/local/wikidot-verification/src/candidate-case-http.mjs",
  "install/local/wikidot-verification/src/candidate-source-execution-identity.mjs",
  "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
  "install/local/wikidot-verification/src/open43-a1038-admin-boundary-candidate-case-set.mjs",
  "install/local/wikidot-verification/src/open43-settings-candidate-http.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
  "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
  "install/local/wikidot-verification/package.json",
  "install/local/wikidot-verification/pnpm-lock.yaml",
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function responseBody(value, name) {
  const response = requirePlainObject(value, name);
  if (typeof response.body !== "string") throw new Error(`${name}.body must be a string`);
  return response.body.trim();
}

function verifyCleanup(proof, resources) {
  if (proof?.public_absence_verified !== true || !Array.isArray(resources) || resources.length !== 0) {
    throw new Error("A1038 candidate cleanup did not prove the read-only run was empty");
  }
  return { public_absence_verified: true, resource_count: 0 };
}

class Open43A1038Run {
  #session;
  #resources;
  #operations = [];

  constructor({ session, resources }) {
    this.#session = session;
    this.#resources = resources;
  }

  async #rpc(method, params, options) {
    this.#operations.push({ method, actor: options.actor });
    return await this.#session.rpc(method, params, options);
  }

  async execute() {
    const actorSessions = await this.#session.verifyActorSessions();
    if (!Number.isSafeInteger(actorSessions.administrator_user_id) || !Number.isSafeInteger(actorSessions.non_admin_user_id) || actorSessions.administrator_user_id === actorSessions.non_admin_user_id || actorSessions.expired_session !== null) {
      throw new Error("candidate actor session identity is not a live administrator boundary");
    }

    const site = await this.#rpc("site_get", { site: SITE_SLUG }, { actor: "anonymous" });
    if (!Number.isSafeInteger(site?.site_id) || site.slug !== SITE_SLUG) {
      throw new Error("candidate site identity does not match the sealed fixture");
    }
    const params = { site_id: site.site_id, title: TITLE, wikitext: SOURCE };
    const authenticatedNonAdmin = await this.#rpc(
      "wikidot_page_preview",
      params,
      { actor: "non_admin", siteId: site.site_id },
    );
    const anonymous = await this.#rpc(
      "wikidot_page_preview",
      params,
      { actor: "anonymous", siteId: site.site_id },
    );
    return [
      {
        case_id: "A1038_AUTHENTICATED_NON_ADMIN_DENIAL",
        observations: {
          actor_sessions: actorSessions,
          site: { site_id: site.site_id, slug: site.slug },
          operation_sequence: this.#operations,
          authenticated_non_admin: {
            body: responseBody(authenticatedNonAdmin, "authenticated non-admin preview"),
          },
          anonymous_boundary: {
            body: responseBody(anonymous, "anonymous preview"),
          },
        },
      },
    ];
  }

  async cleanup() {
    return { public_absence_verified: true, run_owned_resources: this.#resources.snapshot() };
  }
}

function verifyCase(caseId, observations) {
  if (caseId !== "A1038_AUTHENTICATED_NON_ADMIN_DENIAL") throw new Error(`unsupported #1038 candidate case: ${caseId}`);
  const value = requirePlainObject(observations, `${caseId} observations`);
  if (!Number.isSafeInteger(value.site?.site_id) || value.site.slug !== SITE_SLUG) throw new Error("candidate observation site identity drifted");
  if (JSON.stringify(value.operation_sequence) !== JSON.stringify([
    { method: "site_get", actor: "anonymous" },
    { method: "wikidot_page_preview", actor: "non_admin" },
    { method: "wikidot_page_preview", actor: "anonymous" },
  ])) throw new Error("candidate public operation sequence is not the fixed boundary");
  const authenticatedNonAdmin = responseBody(value.authenticated_non_admin, "authenticated non-admin observation");
  const anonymous = responseBody(value.anonymous_boundary, "anonymous boundary observation");
  if (authenticatedNonAdmin !== MANAGE_SITE_NON_ADMIN_HTML) throw new Error("authenticated non-admin ManageSite output drifted");
  if (anonymous !== MANAGE_SITE_ANONYMOUS_HTML) throw new Error("anonymous ManageSite boundary output drifted");
  return {
    verified: true,
    authenticated_non_admin_body_sha256: sha256(authenticatedNonAdmin),
    anonymous_boundary_body_sha256: sha256(anonymous),
    negative_boundary: "anonymous_actor_retains_login_capable_manage_site_dom",
  };
}

async function defaultSessionFactory(options) {
  const { Open43SettingsCandidateSession } = await import("./open43-settings-candidate-http.mjs");
  return new Open43SettingsCandidateSession(options);
}

export function createOpen43A1038AdminBoundaryCandidateCaseSet({ sessionFactory = defaultSessionFactory } = {}) {
  return Object.freeze({
    id: "open43-a1038-admin-boundary",
    caseIds: OPEN43_A1038_ADMIN_BOUNDARY_CASE_IDS,
    async prepareRun({ candidateIdentity, privateInput, signal, resources }) {
      if (candidateIdentity.candidate.endpoint.host !== ADMIN_HOST) throw new Error(`#1038 candidate requires ${ADMIN_HOST}`);
      const session = await sessionFactory({ candidateIdentity, privateInput, signal });
      const run = new Open43A1038Run({ session, resources });
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: session.privateInputIdentity,
        plan: {
          schema: "wikijump.open43_a1038_admin_boundary_candidate_plan.v1",
          site_slug: SITE_SLUG,
          source: SOURCE,
          title: TITLE,
          actor: "non_admin",
          negative_boundary: "anonymous",
        },
        execute: () => run.execute(),
        cleanup: () => run.cleanup(),
        verifyCase,
        verifyCleanup,
      });
    },
  });
}
