import {
  OPEN43_SETTINGS_LIFECYCLE_CASE_IDS,
  OPEN43_SETTINGS_LIFECYCLE_CASE_MANIFEST,
  settingsLifecycleManifestSha256,
  verifyOpen43SettingsLifecycleCleanup,
} from "./open43-settings-lifecycle-candidate-contract.mjs";
import {
  OPEN43_SETTINGS_LIFECYCLE_SOURCE_FILES,
  Open43SettingsLifecycleCandidateAdapter,
} from "./open43-settings-lifecycle-candidate-adapter.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import { sha256Value } from "./standing-browser-parity-util.mjs";

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;

function assignedSlug(categorySlug, next) {
  return categorySlug === "_default" ? String(next) : `${categorySlug}:${next}`;
}

class CandidateLifecycleOwner {
  #session;
  #plan;
  #before = null;

  constructor({ candidateIdentity, session, plan }) {
    if (candidateIdentity?.candidate?.compose_project === undefined) throw new Error("S758 candidate lifecycle requires a sealed candidate project");
    this.#candidateProject = candidateIdentity.candidate.compose_project;
    this.#session = session;
    this.#plan = plan;
  }

  async prepare({ site_id: siteId, category_id: categoryId, category_slug: categorySlug, requested_slugs: requestedSlugs }) {
    const category = await this.#session.rpc("category_get", { site: siteId, category: categoryId }, { actor: "administrator", siteId });
    if (category?.category_id !== categoryId || category.slug !== categorySlug || typeof category.autonumber_enabled !== "boolean" || !Number.isSafeInteger(category.autonumber_next) || !Number.isSafeInteger(category.settings_revision)) {
      throw new Error("S758 candidate lifecycle could not snapshot the category allocator");
    }
    this.#before = {
      enabled: category.autonumber_enabled,
      next: category.autonumber_next,
      settings_revision: category.settings_revision,
    };
    const assignedSlugs = [
      assignedSlug(categorySlug, category.autonumber_next),
      assignedSlug(categorySlug, category.autonumber_next + 1),
    ];
    for (const slug of [...new Set([...requestedSlugs, ...assignedSlugs])]) {
      const page = await this.#session.rpc("page_get", { site_id: siteId, page: slug, details: { wikitext: false, compiled: false } }, { actor: "administrator", siteId });
      if (page !== null) throw new Error("S758 requested candidate namespace is not vacant");
    }
  }

  async cleanup({ site_id: siteId, run_owned_page_ids: pageIds }) {
    if (this.#before === null) throw new Error("S758 candidate lifecycle was not prepared");
    const assignedSlugs = [
      assignedSlug(this.#plan.category_slug, this.#before.next),
      assignedSlug(this.#plan.category_slug, this.#before.next + 1),
    ];
    const requestedSlugs = [this.#plan.first_requested_slug, this.#plan.second_requested_slug, this.#plan.disabled_requested_slug];
    const allowedSlugs = new Set([...assignedSlugs, ...requestedSlugs]);
    const discovered = [];
    for (const slug of allowedSlugs) {
      const page = await this.#session.rpc("page_get", { site_id: siteId, page: slug, details: { wikitext: false, compiled: false } }, { actor: "administrator", siteId, cleanup: true });
      if (page !== null) {
        if (!Number.isSafeInteger(page.page_id) || page.page_id <= 0 || page.slug !== slug) throw new Error("S758 candidate lifecycle discovered an invalid run-owned page");
        discovered.push(page.page_id);
      }
    }
    const ownedPageIds = [...new Set([...pageIds, ...discovered])];
    for (const pageId of [...ownedPageIds].reverse()) {
      const page = await this.#session.rpc("page_get", { site_id: siteId, page: pageId, details: { wikitext: false, compiled: false } }, { actor: "administrator", siteId, cleanup: true });
      if (page !== null) {
        if (!allowedSlugs.has(page.slug)) throw new Error("S758 candidate lifecycle cleanup refused an unowned page");
        await this.#session.rpc("page_delete", {
          site_id: siteId,
          page: page.page_id,
          last_revision_id: page.revision_id,
          revision_comments: "S758 candidate lifecycle cleanup",
          user_id: this.#session.privateInputIdentity.administrator_user_id,
          ip_address: "127.0.0.1",
        }, { actor: "administrator", siteId, cleanup: true });
      }
    }
    const residual = [];
    for (const slug of allowedSlugs) {
      const page = await this.#session.rpc("page_get", { site_id: siteId, page: slug, details: { wikitext: false, compiled: false } }, { actor: "administrator", siteId, cleanup: true });
      if (page !== null) residual.push(slug);
    }
    return {
      public_absence_verified: residual.length === 0,
      run_owned_state_absent: residual.length === 0,
      run_owned_page_ids: residual,
      allocator_restored: false,
      candidate_stack_disposal: {
        status: "deferred_to_parent_run",
        compose_project: this.#candidateProject,
        command: "stop-promotion-candidate",
        reason: "the monotonic allocator is restored only by discarding the disposable candidate stack",
      },
    };
  }

  #candidateProject;
}

async function defaultBrowserAdapterFactory(options) {
  const { Open43SettingsBrowserAdapter } = await import("./open43-settings-browser-adapter.mjs");
  return new Open43SettingsBrowserAdapter(options);
}

async function defaultSessionFactory(options) {
  const { Open43SettingsCandidateSession } = await import("./open43-settings-candidate-http.mjs");
  return new Open43SettingsCandidateSession(options);
}

export { OPEN43_SETTINGS_LIFECYCLE_CASE_IDS, OPEN43_SETTINGS_LIFECYCLE_CASE_MANIFEST };

export function createOpen43SettingsLifecycleCandidateCaseSet({
  sessionFactory = defaultSessionFactory,
  browserAdapterFactory = defaultBrowserAdapterFactory,
  candidateLifecycleFactory = (options) => new CandidateLifecycleOwner(options),
} = {}) {
  return Object.freeze({
    id: "open43-settings-lifecycle",
    caseIds: OPEN43_SETTINGS_LIFECYCLE_CASE_IDS,
    async prepareRun({ runId, candidateIdentity, privateInput, signal, resources, candidateBrowserContexts }) {
      if (candidateIdentity.candidate.endpoint.host !== SITE_HOST || candidateIdentity.candidate.endpoint.port === 443 || candidateIdentity.candidate.port_443_published !== false) throw new Error(`Open43 S758 cases require exact non-standing ${SITE_HOST}`);
      const session = await sessionFactory({ candidateIdentity, privateInput, signal });
      if (session.pageOrigin !== candidatePageOrigin(candidateIdentity)) throw new Error("S758 session did not bind the sealed editable candidate origin");
      const suffix = runId.slice("candidate-run-".length);
      const fixture = session.fixtureIdentity;
      const category = fixture.autonumber_category ?? fixture.transition_category;
      const plan = Object.freeze({
        schema: "wikijump.open43_settings_lifecycle_candidate_plan.v1",
        issue: 758,
        run_id: runId,
        site_slug: SITE_SLUG,
        page_origin: session.pageOrigin,
        category_id: category.category_id,
        category_slug: category.slug,
        first_requested_slug: `${category.slug}:open43-autonumber-first-${suffix}`,
        second_requested_slug: `${category.slug}:open43-autonumber-second-${suffix}`,
        disabled_requested_slug: `${category.slug}:open43-autonumber-disabled-${suffix}`,
        first_title: `Open43 autonumber first ${suffix}`,
        second_title: `Open43 autonumber second ${suffix}`,
        disabled_title: `Open43 autonumber disabled ${suffix}`,
        first_body: `Open43 autonumber first body ${suffix}`,
        second_body: `Open43 autonumber second body ${suffix}`,
        disabled_body: `Open43 autonumber disabled body ${suffix}`,
        case_manifest_sha256: settingsLifecycleManifestSha256(),
        case_manifest: OPEN43_SETTINGS_LIFECYCLE_CASE_MANIFEST,
        fixture_identity_sha256: sha256Value(fixture),
      });
      const lifecycle = candidateLifecycleFactory({ candidateIdentity, privateInput, runId, plan, session });
      const browser = await browserAdapterFactory({ browserContexts: candidateBrowserContexts, pageOrigin: session.pageOrigin, storageState: (actor) => session.storageState(actor) });
      const execution = new Open43SettingsLifecycleCandidateAdapter({ session, browser, lifecycle, resources, plan });
      return Object.freeze({
        sourceFiles: Object.freeze([...new Set([...OPEN43_SETTINGS_LIFECYCLE_SOURCE_FILES, "install/local/wikidot-verification/src/open43-candidate-denominator-registry.mjs"])]),
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: session.privateInputIdentity,
        browserCredentialPolicy: { mode: "private-actor-storage-states", storage_state_count: 1, private_input_identity_sha256: sha256Value(session.privateInputIdentity) },
        plan,
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => execution.verifyCase(caseId, observations),
        verifyCleanup: verifyOpen43SettingsLifecycleCleanup,
      });
    },
  });
}
