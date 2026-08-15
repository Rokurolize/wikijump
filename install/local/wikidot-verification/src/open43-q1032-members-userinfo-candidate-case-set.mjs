import { createHash } from "node:crypto";

import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import { sha256Value } from "./standing-browser-parity-util.mjs";
import {
  MEMBERS_PARAMETERS,
  OPEN43_Q1032_CASE_IDS,
  OPEN43_Q1032_EVIDENCE,
  SEARCHUSERS_DISABLED_SHA256,
  USERINFO_NO_TARGET_SHA256,
  validateOpen43Q1032PrivateInput,
  verifyOpen43Q1032Case,
  verifyOpen43Q1032Cleanup,
} from "./open43-q1032-members-userinfo-candidate-contract.mjs";

export { OPEN43_Q1032_CASE_IDS } from "./open43-q1032-members-userinfo-candidate-contract.mjs";

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;

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

class Open43Q1032Run {
  #session;
  #input;

  constructor(session, input) {
    this.#session = session;
    this.#input = input;
  }

  async execute() {
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
    prepareRun({ candidateIdentity, privateInput, signal }) {
      requireCandidateSite(candidateIdentity);
      const input = validateOpen43Q1032PrivateInput(privateInput);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      if (session.pageOrigin !== candidatePageOrigin(candidateIdentity)) throw new Error("Q1032 session did not bind the sealed candidate origin");
      const privateInputIdentity = {
        ...session.privateInputIdentity,
        site_id: input.site_id,
        preview_title: input.preview_title,
        evidence_sha256: sha256Value(OPEN43_Q1032_EVIDENCE),
      };
      const execution = new Open43Q1032Run(session, input);
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity,
        browserCredentialPolicy: "none",
        plan: {
          schema: "wikijump.open43_q1032_members_userinfo_candidate_plan.v1",
          site_slug: SITE_SLUG,
          case_ids: OPEN43_Q1032_CASE_IDS,
          site_id: input.site_id,
          preview_title: input.preview_title,
          evidence: OPEN43_Q1032_EVIDENCE,
          members: { actor: "anonymous", parameters: MEMBERS_PARAMETERS, public_contract: "status-ok-table-page-one-pager-members-list-script" },
          userinfo: { source: "[[module UserInfo]]", actors: ["anonymous", "editor"], expected_no_target_sha256: USERINFO_NO_TARGET_SHA256 },
          searchusers: { source: "[[module SearchUsers]]", actors: ["anonymous", "editor"], expected_disabled_sha256: SEARCHUSERS_DISABLED_SHA256 },
          mutation_policy: "read-only",
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => verifyOpen43Q1032Case(caseId, observations),
        verifyCleanup: verifyOpen43Q1032Cleanup,
      });
    },
  });
}
