import { Open43Issue775EditBrowserAdapter } from "./open43-issue775-edit-browser-adapter.mjs";
import {
  OPEN43_ISSUE775_CASE_IDS,
  verifyOpen43Issue775Case,
  verifyOpen43Issue775Cleanup,
} from "./open43-issue775-edit-candidate-contract.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import { sha256Text, sha256Value } from "./standing-browser-parity-util.mjs";

export { OPEN43_ISSUE775_CASE_IDS } from "./open43-issue775-edit-candidate-contract.mjs";

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const PAGE_SOURCE = '[[button edit text="Edit here"]]\n';

class Open43Issue775EditRun {
  #session;
  #browser;
  #resources;
  #runId;
  #pageSlug;
  #pageOrigin;
  #siteId = null;
  #ownedPage = null;
  #pageResource = null;
  #verificationPlan = null;

  constructor({ session, browser, resources, runId }) {
    this.#session = session;
    this.#browser = browser;
    this.#resources = resources;
    this.#runId = runId;
    this.#pageOrigin = session.pageOrigin;
    this.#pageSlug = `open43-issue775-${runId.slice("candidate-run-".length)}`;
  }

  async #rpc(method, params = {}, { actor = "administrator", cleanup = false } = {}) {
    return await this.#session.rpc(method, params, { actor, siteId: this.#siteId ?? undefined, page: this.#pageSlug, cleanup });
  }

  async #page(cleanup = false) {
    return await this.#rpc("page_get", { site_id: this.#siteId, page: this.#pageSlug, details: { wikitext: true, compiled: false } }, { cleanup });
  }

  #matchesOwnedPage(page) {
    return page?.site_id === this.#siteId && page.page_id === this.#ownedPage?.page_id && page.slug === this.#pageSlug && page.title === this.#ownedPage?.title && page.wikitext === PAGE_SOURCE;
  }

  async execute() {
    const sessions = await this.#session.verifyActorSessions();
    const privateIdentity = this.#session.privateInputIdentity;
    if (sessions.administrator_user_id !== privateIdentity.administrator_user_id || sessions.non_admin_user_id !== privateIdentity.non_admin_user_id || sessions.expired_session !== null) throw new Error("issue 775 actor session identity drifted");
    const site = await this.#rpc("site_get", { site: SITE_SLUG });
    if (!Number.isSafeInteger(site?.site_id) || site.slug !== SITE_SLUG) throw new Error("issue 775 editable candidate site is missing");
    this.#siteId = site.site_id;
    if (await this.#page() !== null) throw new Error("issue 775 run-owned page namespace already exists");
    const title = `candidate-case-owner:${this.#pageSlug}`;
    const page = await this.#rpc("page_create", {
      site_id: this.#siteId,
      slug: this.#pageSlug,
      title,
      alt_title: null,
      wikitext: PAGE_SOURCE,
      layout: "wikidot",
      user_id: privateIdentity.administrator_user_id,
      ip_address: "127.0.0.1",
      tags: [],
      revision_comments: "Open43 issue 775 candidate fixture",
    });
    if (!Number.isSafeInteger(page?.page_id) || !Number.isSafeInteger(page.revision_id) || page.slug !== this.#pageSlug) throw new Error("issue 775 page_create did not return the owned page identity");
    this.#ownedPage = { page_id: page.page_id, revision_id: page.revision_id, slug: page.slug, title };
    this.#pageResource = this.#resources.register("page", this.#ownedPage);
    if (!this.#matchesOwnedPage(await this.#page())) throw new Error("issue 775 created page failed its public ownership proof");
    const permissionRows = await Promise.all([
      ["anonymous", "anonymous", false],
      ["editable_member", "administrator", true],
      ["non_editable_member", "non_admin", false],
    ].map(async ([label, actor, expected]) => {
      const result = await this.#rpc("page_edit_permission", {}, { actor });
      if (result?.can_edit !== expected) throw new Error(`issue 775 ${label} permission preflight did not match the fixture contract`);
      return [label, result.can_edit];
    }));
    const permissions = Object.fromEntries(permissionRows);
    const pageUrl = new URL(`/${encodeURIComponent(this.#pageSlug)}`, this.#pageOrigin).href;
    const actors = await this.#browser.run({ pageUrl, pagePath: `/${encodeURIComponent(this.#pageSlug)}`, permissions });
    const sourceSha256 = sha256Text(PAGE_SOURCE);
    this.#verificationPlan = {
      page_id: page.page_id,
      page_slug: this.#pageSlug,
      page_path: `/${encodeURIComponent(this.#pageSlug)}`,
      page_url: pageUrl,
      source_sha256: sourceSha256,
      permissions,
    };
    return [{ case_id: OPEN43_ISSUE775_CASE_IDS[0], observations: { page: { page_id: page.page_id, slug: this.#pageSlug, source_sha256: sourceSha256 }, permissions, actors } }];
  }

  async cleanup() {
    let pageAfter = null;
    const failures = [];
    try {
      if (this.#siteId !== null && this.#ownedPage !== null) {
        const page = await this.#page(true);
        if (!this.#matchesOwnedPage(page)) throw new Error("issue 775 owned page identity drifted during cleanup");
        await this.#rpc("page_delete", { site_id: this.#siteId, page: page.page_id, last_revision_id: page.revision_id, revision_comments: "Open43 issue 775 candidate cleanup", user_id: this.#session.privateInputIdentity.administrator_user_id, ip_address: "127.0.0.1" }, { cleanup: true });
        pageAfter = await this.#page(true);
        if (pageAfter !== null) throw new Error("issue 775 run-owned page remained after cleanup");
        this.#resources.release(this.#pageResource, { page_get_after_delete: null, public_absence_verified: true });
      }
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw new AggregateError(failures, "issue 775 public cleanup failed");
    return { page_after: pageAfter, public_absence_verified: pageAfter === null };
  }

  verifyCase(caseId, observations) {
    if (this.#verificationPlan === null) throw new Error("issue 775 case was not executed");
    return verifyOpen43Issue775Case(caseId, observations, this.#verificationPlan);
  }
}

const SOURCE_FILES = Object.freeze([...new Set([
  ...STANDING_BROWSER_EXECUTION_MODULES,
  "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
  "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
  "install/local/wikidot-verification/src/candidate-case-command.mjs",
  "install/local/wikidot-verification/src/candidate-case-http.mjs",
  "install/local/wikidot-verification/src/candidate-case-runner.mjs",
  "install/local/wikidot-verification/src/open43-issue775-edit-browser-adapter.mjs",
  "install/local/wikidot-verification/src/open43-issue775-edit-candidate-case-set.mjs",
  "install/local/wikidot-verification/src/open43-issue775-edit-candidate-contract.mjs",
  "install/local/wikidot-verification/src/open43-settings-candidate-http.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
  "framerail/src/lib/wikidot/wikidot-legacy-actions.js",
  "framerail/src/routes/[slug]/[...extra]/page.svelte",
  "framerail/src/routes/[slug]/[...extra]/EditorPane.svelte",
  "deepwell/src/endpoints/page.rs",
  "deepwell/src/services/render/legacy_actions.rs",
  "install/local/wikidot-verification/package.json",
  "install/local/wikidot-verification/pnpm-lock.yaml",
])]);

export function createOpen43Issue775EditCandidateCaseSet({
  sessionFactory = async (options) => {
    const { Open43SettingsCandidateSession } = await import("./open43-settings-candidate-http.mjs");
    return new Open43SettingsCandidateSession(options);
  },
  browserAdapterFactory = (options) => new Open43Issue775EditBrowserAdapter(options),
} = {}) {
  return Object.freeze({
    id: "open43-issue775-edit",
    caseIds: OPEN43_ISSUE775_CASE_IDS,
    async prepareRun({ runId, candidateIdentity, privateInput, signal, resources, candidateBrowserContexts }) {
      if (candidateIdentity.candidate.endpoint.host !== SITE_HOST || candidateIdentity.candidate.endpoint.port === 443 || candidateIdentity.candidate.port_443_published !== false) throw new Error(`issue 775 requires exact non-standing ${SITE_HOST}`);
      const session = await sessionFactory({ candidateIdentity, privateInput, signal });
      if (session.pageOrigin !== candidatePageOrigin(candidateIdentity)) throw new Error("issue 775 session did not bind the sealed candidate origin");
      const privateInputIdentity = session.privateInputIdentity;
      const browser = browserAdapterFactory({ browserContexts: candidateBrowserContexts, pageOrigin: session.pageOrigin, storageState: (actor) => session.storageState(actor) });
      const execution = new Open43Issue775EditRun({ session, browser, resources, runId });
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity,
        browserCredentialPolicy: { mode: "private-actor-storage-states", storage_state_count: 2, private_input_identity_sha256: sha256Value(privateInputIdentity) },
        plan: { schema: "wikijump.open43_issue775_edit_candidate_plan.v1", site_slug: SITE_SLUG, page_origin: session.pageOrigin, case_ids: OPEN43_ISSUE775_CASE_IDS, actor_order: ["anonymous", "editable_member", "non_editable_member"], source_sha256: sha256Text(PAGE_SOURCE) },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => execution.verifyCase(caseId, observations),
        verifyCleanup: verifyOpen43Issue775Cleanup,
      });
    },
  });
}
