import { createHash } from "node:crypto";

import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import { sha256Value } from "./standing-browser-parity-util.mjs";
import {
  FEED_MISSING_ERROR,
  OPEN43_Q1036_CASE_IDS,
  OPEN43_Q1036_EVIDENCE,
  PREVIEW_CASES,
  SAVED_SOURCE,
  SEARCH_ERROR,
  validateOpen43Q1036PrivateInput,
  verifyOpen43Q1036Case,
  verifyOpen43Q1036Cleanup,
} from "./open43-q1036-search-feed-candidate-contract.mjs";

export { OPEN43_Q1036_CASE_IDS } from "./open43-q1036-search-feed-candidate-contract.mjs";

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireCandidateSite(candidateIdentity) {
  const endpoint = candidateIdentity.candidate.endpoint;
  if (endpoint.host !== SITE_HOST || endpoint.port === 443 || candidateIdentity.candidate.port_443_published !== false) throw new Error(`Q1036 cases require exact non-standing ${SITE_HOST}`);
}

function previewObservation(caseSpec, result) {
  if (typeof result?.body !== "string") throw new Error(`${caseSpec.case_id} returned a malformed PagePreview response`);
  return {
    case_id: caseSpec.case_id,
    body_sha256: hash(result.body),
    body_length: Buffer.byteLength(result.body),
    expected_fragment_present: result.body.includes(caseSpec.expected),
    module_consumed: !result.body.includes("[[module"),
  };
}

function savedPageObservation(page, view) {
  const body = view?.type === "found" ? view.data?.compiled_body_html : null;
  if (typeof page?.wikitext !== "string" || typeof body !== "string") throw new Error("Q1036 saved page public read returned a malformed result");
  return {
    page_get: { page_id: page.page_id, revision_id: page.revision_id, slug: page.slug, wikitext_sha256: hash(page.wikitext) },
    page_view: {
      type: view.type,
      wikitext_sha256: hash(view.data?.wikitext ?? ""),
      body_sha256: hash(body),
      search_error: body.includes(SEARCH_ERROR),
      feed_error: body.includes(FEED_MISSING_ERROR),
      markers_preserved: body.includes("SEARCH_START") && body.includes("SEARCH_END") && body.includes("FEED_START") && body.includes("FEED_END"),
      module_consumed: !body.includes("[[module"),
    },
  };
}

class Open43Q1036Run {
  #session;
  #input;

  constructor(session, input) {
    this.#session = session;
    this.#input = input;
  }

  async execute() {
    const previews = [];
    for (const caseSpec of PREVIEW_CASES) {
      const result = await this.#session.rpc(
        "wikidot_page_preview",
        { site_id: this.#input.site_id, title: caseSpec.case_id, wikitext: caseSpec.source },
        { actor: "anonymous", siteId: this.#input.site_id },
      );
      previews.push(previewObservation(caseSpec, result));
    }
    const page = await this.#session.rpc(
      "page_get",
      { site_id: this.#input.site_id, page: this.#input.saved_page_slug, details: { wikitext: true, compiled: false } },
      { actor: "anonymous", siteId: this.#input.site_id, page: this.#input.saved_page_slug },
    );
    const view = await this.#session.rpc(
      "page_view",
      { site_id: this.#input.site_id, session_token: null, route: { slug: this.#input.saved_page_slug, extra: "" }, locales: ["en-US", "en"] },
      { actor: "anonymous", siteId: this.#input.site_id, page: this.#input.saved_page_slug },
    );
    return [{ case_id: OPEN43_Q1036_CASE_IDS[0], observations: { previews, saved: savedPageObservation(page, view) } }];
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
  "install/local/wikidot-verification/src/open43-q1036-search-feed-candidate-case-set.mjs",
  "install/local/wikidot-verification/src/open43-q1036-search-feed-candidate-contract.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
  "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
  OPEN43_Q1036_EVIDENCE.path,
  "install/local/wikidot-verification/package.json",
  "install/local/wikidot-verification/pnpm-lock.yaml",
]);

export function createOpen43Q1036CandidateCaseSet({ sessionFactory = (options) => new CandidateHttpSession(options) } = {}) {
  return Object.freeze({
    id: "open43-q1036-search-feed",
    caseIds: OPEN43_Q1036_CASE_IDS,
    prepareRun({ candidateIdentity, privateInput, signal }) {
      requireCandidateSite(candidateIdentity);
      const input = validateOpen43Q1036PrivateInput(privateInput);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      if (session.pageOrigin !== candidatePageOrigin(candidateIdentity)) throw new Error("Q1036 session did not bind the sealed candidate origin");
      const privateInputIdentity = {
        ...session.privateInputIdentity,
        site_id: input.site_id,
        saved_page_id: input.saved_page_id,
        saved_revision_id: input.saved_revision_id,
        saved_page_slug: input.saved_page_slug,
        evidence_sha256: sha256Value(OPEN43_Q1036_EVIDENCE),
      };
      const execution = new Open43Q1036Run(session, input);
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity,
        browserCredentialPolicy: "none",
        plan: {
          schema: "wikijump.open43_q1036_search_feed_candidate_plan.v1",
          site_slug: SITE_SLUG,
          case_ids: OPEN43_Q1036_CASE_IDS,
          evidence: OPEN43_Q1036_EVIDENCE,
          preview_case_ids: PREVIEW_CASES.map(({ case_id }) => case_id),
          saved_page_identity: { site_id: input.site_id, page_id: input.saved_page_id, revision_id: input.saved_revision_id, slug: input.saved_page_slug, source_sha256: hash(SAVED_SOURCE) },
          public_reads: ["wikidot_page_preview", "page_get", "page_view"],
          mutation_policy: "read-only",
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => verifyOpen43Q1036Case(caseId, observations, input),
        verifyCleanup: verifyOpen43Q1036Cleanup,
      });
    },
  });
}
