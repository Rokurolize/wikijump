import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import {
  requirePlainObject,
  requireSha256,
  sha256Text,
} from "./standing-browser-parity-util.mjs";
import {
  OPEN43_ISSUE777_PRINT_OPERATIONS,
  Open43Issue777PrintBrowserAdapter,
} from "./open43-issue777-print-browser-adapter.mjs";

export const OPEN43_ISSUE777_CASE_IDS = Object.freeze([
  "A777_BROWSER_PRINT_LIFECYCLE",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const PAGE_SOURCE = '[[button print text="Print this page"]]\n';
const OPERATIONS = OPEN43_ISSUE777_PRINT_OPERATIONS;

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

function requireOpenerState(value, plan, expected, label) {
  const state = requirePlainObject(value, `${label} state`);
  if (
    state.url !== plan.page_url ||
    state.path !== plan.page_path ||
    !Number.isSafeInteger(state.history_length) ||
    state.history_length < 1 ||
    state.standalone_print_count !== 1 ||
    state.focused_control !== expected.focused ||
    state.aria_busy !== expected.busy ||
    state.open_count !== expected.opens ||
    state.print_call_count !== 0 ||
    state.source_disclosure !== false
  ) {
    throw new Error(`${label} public print state drifted`);
  }
  const opens = state.opens;
  if (!Array.isArray(opens) || opens.length !== expected.opens) {
    throw new Error(`${label} child-window count drifted`);
  }
  const expectedUrl = `/printer--friendly/${plan.page_path}`;
  for (const open of opens) {
    const call = requirePlainObject(open, `${label} child window`);
    if (call.url !== expectedUrl || call.target !== "_blank") {
      throw new Error(`${label} child-window request drifted`);
    }
  }
  return state;
}

const EXPECTED_OPENS = Object.freeze({
  click: 1,
  enter: 1,
  space: 0,
  rapid_repeated_click: 2,
  sequential_repeated_click: 2,
});
const POPUP_CONTROL_OUTER_HTML =
  '<a href="javascript:;" onclick="window.print()">PRINT THE PAGE</a>';
const POPUP_CONTROL_PARENT_OUTER_HTML = `<b>${POPUP_CONTROL_OUTER_HTML}</b>`;

function requirePopup(value, plan, openerHistoryLength, label) {
  const popup = requirePlainObject(value, `${label} printer-friendly window`);
  const expectedUrl = new URL(
    `/printer--friendly/${plan.page_path}`,
    plan.page_url,
  ).href;
  const phases = ["before", "focused", "after"].map((phase) => [
    phase,
    requirePlainObject(popup[phase], `${label} ${phase} state`),
  ]);
  for (const [phase, state] of phases) {
    const drift = [];
    if (state.url !== expectedUrl) drift.push(`url=${JSON.stringify(state.url)}`);
    if (state.history_length !== openerHistoryLength) {
      drift.push(
        `history_length=${JSON.stringify(state.history_length)} expected=${JSON.stringify(openerHistoryLength)}`,
      );
    }
    if (state.body_id !== "html-body") drift.push(`body_id=${JSON.stringify(state.body_id)}`);
    if (!String(state.body_class ?? "").split(/\s+/u).includes("print-body")) {
      drift.push(`body_class=${JSON.stringify(state.body_class)}`);
    }
    if (state.print_control_count !== 1) {
      drift.push(`print_control_count=${JSON.stringify(state.print_control_count)}`);
    }
    if (state.rendered !== true) drift.push(`rendered=${JSON.stringify(state.rendered)}`);
    if (state.control_href !== "javascript:;") {
      drift.push(`control_href=${JSON.stringify(state.control_href)}`);
    }
    if (state.control_onclick !== "window.print()") {
      drift.push(`control_onclick=${JSON.stringify(state.control_onclick)}`);
    }
    if (state.control_outer_html !== POPUP_CONTROL_OUTER_HTML) {
      drift.push(`control_outer_html=${JSON.stringify(state.control_outer_html)}`);
    }
    if (state.parent_outer_html !== POPUP_CONTROL_PARENT_OUTER_HTML) {
      drift.push(`parent_outer_html=${JSON.stringify(state.parent_outer_html)}`);
    }
    if (drift.length > 0) {
      throw new Error(
        `${label} ${phase} printer-friendly DOM drifted: ${drift.join("; ")}`,
      );
    }
  }
  const before = phases[0][1];
  const focused = phases[1][1];
  const after = phases[2][1];
  if (
    before.focused_control !== false ||
    focused.focused_control !== true ||
    after.focused_control !== true
  ) {
    throw new Error(`${label} printer-friendly focus drifted`);
  }
  for (const state of [before, focused, after]) {
    if (state.aria_busy !== null) {
      throw new Error(`${label} printer-friendly control acquired aria-busy`);
    }
  }
  if (
    after.print_call_count !== 1 ||
    !Array.isArray(after.prints) ||
    after.prints.length !== 1
  ) {
    throw new Error(`${label} printer-friendly native print count drifted`);
  }
  const call = requirePlainObject(after.prints[0], `${label} print call`);
  if (
    call.url !== expectedUrl ||
    call.history_length !== openerHistoryLength ||
    call.focused_control !== true ||
    call.argument_count !== 0
  ) {
    throw new Error(`${label} printer-friendly print call identity drifted`);
  }
  return popup;
}

function requireOperation(value, plan, label) {
  const operation = requirePlainObject(value, `issue 777 ${label}`);
  const expectedOpens = EXPECTED_OPENS[label];
  const before = requireOpenerState(
    operation.before,
    plan,
    { focused: true, busy: false, opens: 0 },
    `issue 777 ${label} before`,
  );
  const during = requireOpenerState(
    operation.during,
    plan,
    { focused: true, busy: false, opens: expectedOpens },
    `issue 777 ${label} during`,
  );
  const after = requireOpenerState(
    operation.after,
    plan,
    { focused: true, busy: false, opens: expectedOpens },
    `issue 777 ${label} after`,
  );
  if (
    before.history_length !== during.history_length ||
    before.history_length !== after.history_length ||
    operation.mutation_request_count !== 0 ||
    operation.popup_count !== expectedOpens
  ) {
    throw new Error(`issue 777 ${label} navigation or request state drifted`);
  }
  const popups = operation.popup_observations;
  if (!Array.isArray(popups) || popups.length !== expectedOpens) {
    throw new Error(`issue 777 ${label} printer-friendly observations drifted`);
  }
  for (const [index, popup] of popups.entries()) {
    requirePopup(popup, plan, before.history_length, `${label} popup ${index + 1}`);
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
  requireOpenerState(
    initial.state,
    plan,
    { focused: false, busy: false, opens: 0 },
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
    this.#pageSlug = `open43-issue777-${runId.slice("candidate-run-".length)}`;
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
    "framerail/src/hooks.server.ts",
    "framerail/src/hooks.ts",
    "framerail/src/lib/wikidot/wikidot-legacy-actions.js",
    "framerail/src/lib/wikidot/wikidot-page-actions.js",
    "framerail/src/lib/wikidot/wikidot-print-view.js",
    "framerail/src/routes/+layout.svelte",
    "framerail/src/routes/[slug]/[...extra]/page.svelte",
    "framerail/src/routes/printer--friendly/[...path]/+page.server.ts",
    "framerail/src/routes/printer--friendly/[...path]/+page.svelte",
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
