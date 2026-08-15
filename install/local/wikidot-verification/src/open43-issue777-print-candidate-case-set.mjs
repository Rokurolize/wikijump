import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import {
  requirePlainObject,
  requireSha256,
  sha256Text,
} from "./standing-browser-parity-util.mjs";
import { Open43Issue777PrintBrowserAdapter } from "./open43-issue777-print-browser-adapter.mjs";

export const OPEN43_ISSUE777_CASE_IDS = Object.freeze([
  "A777_BROWSER_PRINT_LIFECYCLE",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const PAGE_SOURCE = '[[button print text="Print this page"]]\n';
const OPERATIONS = Object.freeze(["click", "enter", "space", "repeated"]);

function requireCapture(value, plan) {
  const capture = requirePlainObject(value, "issue 777 initial capture");
  if (
    capture.capture_error !== undefined ||
    capture.navigation_status !== 200 ||
    capture.input_url !== plan.page_url ||
    capture.final_url !== plan.page_url
  ) {
    throw new Error("issue 777 did not capture the exact public page");
  }
  const first = requirePlainObject(
    capture.first_paint,
    "issue 777 first paint",
  );
  const documents = [
    [
      first.document,
      "domcontentloaded_immediate_observation",
      first.screenshot,
    ],
    [capture.document, "settled", capture.settled_viewport_screenshot],
  ];
  for (const [documentValue, phase, screenshotValue] of documents) {
    const document = requirePlainObject(
      documentValue,
      `issue 777 ${phase} document`,
    );
    const probe = document.presence_probes?.find(
      ({ id }) => id === "standalone-print",
    );
    if (
      document.phase !== phase ||
      probe?.count !== 1 ||
      probe.rendered_count !== 1
    ) {
      throw new Error(`issue 777 ${phase} print control drifted`);
    }
    const screenshot = requirePlainObject(
      screenshotValue,
      `issue 777 ${phase} screenshot`,
    );
    if (typeof screenshot.path !== "string" || screenshot.path.length === 0) {
      throw new Error(`issue 777 ${phase} screenshot path is missing`);
    }
    requireSha256(
      screenshot.sha256,
      `issue 777 ${phase} screenshot SHA-256`,
    );
  }
  const full = requirePlainObject(
    capture.screenshot,
    "issue 777 full-page screenshot",
  );
  requireSha256(full.sha256, "issue 777 full-page screenshot SHA-256");
  const resource = capture.document.resource_completion;
  if (
    resource?.status !== "complete" ||
    resource.load_ready_state !== "complete" ||
    resource.font_status !== "loaded" ||
    resource.incomplete_image_count !== 0
  ) {
    throw new Error("issue 777 initial resources did not settle");
  }
}

function requireState(value, plan, expected, label) {
  const state = requirePlainObject(value, `${label} state`);
  if (
    state.url !== plan.page_url ||
    state.path !== plan.page_path ||
    !Number.isSafeInteger(state.history_length) ||
    state.history_length < 1 ||
    state.standalone_print_count !== 1 ||
    state.focused_control !== expected.focused ||
    state.aria_busy !== expected.busy ||
    state.print_call_count !== expected.calls ||
    state.pending_print_count !== expected.pending ||
    state.source_disclosure !== false
  ) {
    throw new Error(`${label} public print state drifted`);
  }
  return state;
}

function requireOperation(value, plan, label) {
  const operation = requirePlainObject(value, `issue 777 ${label}`);
  const before = requireState(
    operation.before,
    plan,
    { focused: true, busy: false, calls: 0, pending: 0 },
    `issue 777 ${label} before`,
  );
  const during = requireState(
    operation.during,
    plan,
    { focused: true, busy: true, calls: 1, pending: 1 },
    `issue 777 ${label} during`,
  );
  const after = requireState(
    operation.after,
    plan,
    { focused: true, busy: false, calls: 1, pending: 0 },
    `issue 777 ${label} after`,
  );
  if (
    before.history_length !== during.history_length ||
    before.history_length !== after.history_length ||
    operation.mutation_request_count !== 0 ||
    !Array.isArray(operation.print_calls) ||
    operation.print_calls.length !== 1
  ) {
    throw new Error(`issue 777 ${label} navigation or request state drifted`);
  }
  const call = requirePlainObject(
    operation.print_calls[0],
    `issue 777 ${label} print call`,
  );
  if (
    call.url !== plan.page_url ||
    call.history_length !== before.history_length ||
    call.focused_control !== true
  ) {
    throw new Error(`issue 777 ${label} print call drifted`);
  }
}

export function verifyOpen43Issue777PrintCase(caseId, observations, plan) {
  if (caseId !== OPEN43_ISSUE777_CASE_IDS[0]) {
    throw new Error(`unknown issue 777 case: ${caseId}`);
  }
  const value = requirePlainObject(observations, `${caseId} observations`);
  const page = requirePlainObject(value.page, `${caseId} page`);
  if (
    page.page_id !== plan.page_id ||
    page.slug !== plan.page_slug ||
    page.source_sha256 !== plan.source_sha256
  ) {
    throw new Error(`${caseId} page identity drifted`);
  }
  const lifecycle = requirePlainObject(value.lifecycle, `${caseId} lifecycle`);
  const initial = requirePlainObject(lifecycle.initial, `${caseId} initial`);
  requireCapture(initial.capture, plan);
  requireState(
    initial.state,
    plan,
    { focused: false, busy: false, calls: 0, pending: 0 },
    `${caseId} initial`,
  );
  const operations = requirePlainObject(
    lifecycle.operations,
    `${caseId} operations`,
  );
  if (JSON.stringify(Object.keys(operations)) !== JSON.stringify(OPERATIONS)) {
    throw new Error(`${caseId} operation denominator drifted`);
  }
  for (const name of OPERATIONS) {
    requireOperation(operations[name], plan, name);
  }
  return {
    verified: true,
    page_id: plan.page_id,
    operation_count: OPERATIONS.length,
    source_sha256: plan.source_sha256,
  };
}

export function verifyOpen43Issue777PrintCleanup(proof) {
  const value = requirePlainObject(proof, "issue 777 cleanup proof");
  if (value.public_absence_verified !== true || value.page_after !== null) {
    throw new Error("issue 777 cleanup did not prove public page absence");
  }
  return { verified: true, public_absence_verified: true };
}

class Open43Issue777PrintRun {
  #session;
  #browser;
  #resources;
  #pageSlug;
  #siteId = null;
  #ownedPage = null;
  #pageResource = null;
  #verificationPlan = null;

  constructor({ session, browser, resources, runId }) {
    this.#session = session;
    this.#browser = browser;
    this.#resources = resources;
    this.#pageSlug = `open43-issue777-${runId.slice("candidate-case-".length)}`;
  }

  async #rpc(method, params = {}, { cleanup = false } = {}) {
    return await this.#session.rpc(method, params, {
      actor: "editor",
      siteId: this.#siteId ?? undefined,
      page: this.#pageSlug,
      cleanup,
    });
  }

  async #page(cleanup = false) {
    return await this.#rpc(
      "page_get",
      {
        site_id: this.#siteId,
        page: this.#pageSlug,
        details: { wikitext: true, compiled: false },
      },
      { cleanup },
    );
  }

  #matchesOwnedPage(page) {
    return (
      page?.site_id === this.#siteId &&
      page.page_id === this.#ownedPage?.page_id &&
      page.slug === this.#pageSlug &&
      page.title === this.#ownedPage?.title &&
      page.wikitext === PAGE_SOURCE
    );
  }

  async execute() {
    const site = await this.#rpc("site_get", { site: SITE_SLUG });
    if (!Number.isSafeInteger(site?.site_id) || site.slug !== SITE_SLUG) {
      throw new Error("issue 777 editable candidate site is missing");
    }
    this.#siteId = site.site_id;
    if ((await this.#page()) !== null) {
      throw new Error("issue 777 run-owned page namespace already exists");
    }
    const title = `candidate-case-owner:${this.#pageSlug}`;
    const page = await this.#rpc("page_create", {
      site_id: this.#siteId,
      slug: this.#pageSlug,
      title,
      alt_title: null,
      wikitext: PAGE_SOURCE,
      layout: "wikidot",
      user_id: this.#session.editorUserId,
      ip_address: "127.0.0.1",
      tags: [],
      revision_comments: "Open43 issue 777 candidate fixture",
    });
    if (
      !Number.isSafeInteger(page?.page_id) ||
      !Number.isSafeInteger(page.revision_id) ||
      page.slug !== this.#pageSlug
    ) {
      throw new Error("issue 777 page_create did not return the owned page");
    }
    this.#ownedPage = {
      page_id: page.page_id,
      revision_id: page.revision_id,
      slug: page.slug,
      title,
    };
    this.#pageResource = this.#resources.register("page", this.#ownedPage);
    if (!this.#matchesOwnedPage(await this.#page())) {
      throw new Error("issue 777 created page failed its public ownership proof");
    }
    const pagePath = `/${encodeURIComponent(this.#pageSlug)}`;
    const pageUrl = new URL(pagePath, this.#session.pageOrigin).href;
    const sourceSha256 = sha256Text(PAGE_SOURCE);
    const lifecycle = await this.#browser.run({ pageUrl, pagePath });
    this.#verificationPlan = {
      page_id: page.page_id,
      page_slug: this.#pageSlug,
      page_path: pagePath,
      page_url: pageUrl,
      source_sha256: sourceSha256,
    };
    return [
      {
        case_id: OPEN43_ISSUE777_CASE_IDS[0],
        observations: {
          page: {
            page_id: page.page_id,
            slug: this.#pageSlug,
            source_sha256: sourceSha256,
          },
          lifecycle,
        },
      },
    ];
  }

  async cleanup() {
    let pageAfter = null;
    if (this.#siteId !== null && this.#ownedPage !== null) {
      const page = await this.#page(true);
      if (!this.#matchesOwnedPage(page)) {
        throw new Error("issue 777 owned page identity drifted during cleanup");
      }
      await this.#rpc(
        "page_delete",
        {
          site_id: this.#siteId,
          page: page.page_id,
          last_revision_id: page.revision_id,
          revision_comments: "Open43 issue 777 candidate cleanup",
          user_id: this.#session.editorUserId,
          ip_address: "127.0.0.1",
        },
        { cleanup: true },
      );
      pageAfter = await this.#page(true);
      if (pageAfter !== null) {
        throw new Error("issue 777 run-owned page remained after cleanup");
      }
      this.#resources.release(this.#pageResource, {
        page_get_after_delete: null,
        public_absence_verified: true,
      });
    }
    return {
      page_after: pageAfter,
      public_absence_verified: pageAfter === null,
    };
  }

  verifyCase(caseId, observations) {
    if (this.#verificationPlan === null) {
      throw new Error("issue 777 case was not executed");
    }
    return verifyOpen43Issue777PrintCase(
      caseId,
      observations,
      this.#verificationPlan,
    );
  }
}

const SOURCE_FILES = Object.freeze([
  ...new Set([
    ...STANDING_BROWSER_EXECUTION_MODULES,
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-http.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/open43-issue777-print-browser-adapter.mjs",
    "install/local/wikidot-verification/src/open43-issue777-print-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "framerail/src/lib/wikidot/wikidot-legacy-actions.js",
    "framerail/src/lib/wikidot/wikidot-page-actions.js",
    "framerail/src/routes/[slug]/[...extra]/page.svelte",
    "deepwell/src/services/render/legacy_actions.rs",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]),
]);

export function createOpen43Issue777PrintCandidateCaseSet({
  sessionFactory = (options) => new CandidateHttpSession(options),
  browserAdapterFactory = (options) =>
    new Open43Issue777PrintBrowserAdapter(options),
} = {}) {
  return Object.freeze({
    id: "open43-issue777-print",
    caseIds: OPEN43_ISSUE777_CASE_IDS,
    async prepareRun({
      runId,
      candidateIdentity,
      privateInput,
      signal,
      resources,
      candidateBrowserContexts,
    }) {
      if (
        candidateIdentity.candidate.endpoint.host !== SITE_HOST ||
        candidateIdentity.candidate.endpoint.port === 443 ||
        candidateIdentity.candidate.port_443_published !== false
      ) {
        throw new Error(
          `issue 777 requires exact non-standing ${SITE_HOST}`,
        );
      }
      const session = await sessionFactory({
        candidateIdentity,
        privateInput,
        signal,
      });
      if (session.pageOrigin !== candidatePageOrigin(candidateIdentity)) {
        throw new Error("issue 777 session did not bind the candidate origin");
      }
      const browser = browserAdapterFactory({
        browserContexts: candidateBrowserContexts,
      });
      const execution = new Open43Issue777PrintRun({
        session,
        browser,
        resources,
        runId,
      });
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: session.privateInputIdentity,
        browserCredentialPolicy: "none",
        plan: {
          schema: "wikijump.open43_issue777_print_candidate_plan.v1",
          site_slug: SITE_SLUG,
          page_origin: session.pageOrigin,
          case_ids: OPEN43_ISSUE777_CASE_IDS,
          operations: OPERATIONS,
          source_sha256: sha256Text(PAGE_SOURCE),
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) =>
          execution.verifyCase(caseId, observations),
        verifyCleanup: verifyOpen43Issue777PrintCleanup,
      });
    },
  });
}
