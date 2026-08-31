import { verifyOpen43SettingsLifecycleCase } from "./open43-settings-lifecycle-candidate-contract.mjs";
import { sha256Value } from "./standing-browser-parity-util.mjs";

const SITE_SLUG = "scpaiueouiuiuiui";

function requiredMethod(value, name, method) {
  if (typeof value?.[method] !== "function") throw new Error(`${name}.${method} is required`);
}

function pageSlug(categorySlug, next) {
  return categorySlug === "_default" ? String(next) : `${categorySlug}:${next}`;
}

function allocator(category, label) {
  if (typeof category?.autonumber_enabled !== "boolean" || !Number.isSafeInteger(category.autonumber_next)) throw new Error(`${label} does not expose the public autonumber allocator state`);
  return { enabled: category.autonumber_enabled, next: category.autonumber_next, sha256: sha256Value({ enabled: category.autonumber_enabled, next: category.autonumber_next }) };
}

function ownedPageId(capture, label) {
  if (!Number.isSafeInteger(capture?.page?.page_id) || capture.page.page_id <= 0) throw new Error(`${label} did not expose a positive run-owned page identity`);
  return capture.page.page_id;
}

function urlFor(origin, slug) {
  return new URL(`/${slug}`, origin).href;
}

class MissingCandidateLifecycle {
  async prepare() { throw new Error("S758 requires a disposable candidate stack lifecycle owner"); }
  async cleanup() { throw new Error("S758 candidate lifecycle cleanup owner is missing"); }
}

export class Open43SettingsLifecycleCandidateAdapter {
  #session;
  #browser;
  #lifecycle;
  #resources;
  #plan;
  #fixture;
  #siteId = null;
  #locale = null;
  #categoryId = null;
  #resource = null;
  #ownedPageIds = [];
  #before = null;

  constructor({ session, browser, lifecycle, resources, plan }) {
    requiredMethod(session, "session", "rpc");
    requiredMethod(session, "session", "action");
    requiredMethod(browser, "browser", "captureAutonumberPage");
    requiredMethod(browser, "browser", "observeHistoryAndReload");
    requiredMethod(lifecycle, "candidate lifecycle", "prepare");
    requiredMethod(lifecycle, "candidate lifecycle", "cleanup");
    requiredMethod(resources, "run resources", "register");
    requiredMethod(resources, "run resources", "release");
    this.#session = session;
    this.#browser = browser;
    this.#lifecycle = lifecycle;
    this.#resources = resources;
    this.#plan = plan;
    this.#fixture = session.fixtureIdentity;
  }

  async #rpc(method, params = {}, options = {}) {
    return await this.#session.rpc(method, params, { actor: options.actor ?? "administrator", siteId: this.#siteId ?? undefined, cleanup: options.cleanup === true });
  }

  async #site(cleanup = false) {
    const site = await this.#rpc("site_get", { site: SITE_SLUG }, { cleanup });
    if (site?.site_id !== this.#fixture.site_id || site.slug !== SITE_SLUG) throw new Error("S758 candidate site identity is missing or changed");
    this.#siteId ??= site.site_id;
    this.#locale ??= site.locale;
    if (site.site_id !== this.#siteId) throw new Error("S758 candidate site identity drifted");
    return site;
  }

  async #category(cleanup = false) {
    const category = await this.#rpc("category_get", { site: this.#siteId, category: this.#fixture.transition_category.slug }, { cleanup });
    if (category?.category_id !== this.#fixture.transition_category.category_id || category.slug !== this.#fixture.transition_category.slug) throw new Error("S758 candidate category identity is missing or changed");
    this.#categoryId ??= category.category_id;
    return category;
  }

  async #cacheIdentity(slug) {
    const metadata = await this.#rpc("article_view_cache_metadata", { site_id: this.#siteId, locales: [this.#locale], session_token: null, route: { slug, extra: "" } }, { actor: "anonymous" });
    const observed = {
      article_page_cache_key: metadata?.article_page_cache_key ?? null,
      public_content_cache_fence: metadata?.public_content_cache_fence ?? null,
      anonymous_permission_cache_fence: metadata?.anonymous_permission_cache_fence ?? null,
    };
    if (Object.values(observed).some((value) => value !== null)) throw new Error("S758 locally authored page unexpectedly entered the anonymous article cache");
    return observed;
  }

  async #action(fields, options = {}) {
    const result = await this.#session.action("autonumber", fields, options);
    if (result.http_status !== 200) throw new Error(`S758 autonumber action returned ${result.http_status}`);
    return result;
  }

  async execute() {
    await this.#lifecycle.prepare({
      run_id: this.#plan.run_id,
      site_id: this.#fixture.site_id,
      category_id: this.#fixture.transition_category.category_id,
      category_slug: this.#fixture.transition_category.slug,
      requested_slugs: [this.#plan.first_requested_slug, this.#plan.second_requested_slug, this.#plan.disabled_requested_slug],
    });
    const site = await this.#site();
    const category = await this.#category();
    this.#before = allocator(category, "S758 candidate allocator before");
    if (this.#before.enabled) throw new Error("S758 candidate category must begin with autonumbering disabled");
    this.#resource = this.#resources.register("autonumber-candidate", {
      site_id: site.site_id,
      category_id: category.category_id,
      category_slug: category.slug,
      allocator_before_sha256: this.#before.sha256,
    });
    await this.#action({ siteId: site.site_id, categoryId: category.category_id, expectedSettingsRevision: category.settings_revision, enabled: true });
    const enabled = await this.#category();
    const enabledAllocator = allocator(enabled, "S758 candidate allocator after enable");
    const firstAssignedSlug = pageSlug(enabled.slug, enabled.autonumber_next);
    const firstRedirectUrl = urlFor(this.#session.pageOrigin, firstAssignedSlug);
    const first = await this.#browser.captureAutonumberPage({ requestedSlug: this.#plan.first_requested_slug, title: this.#plan.first_title, wikitext: this.#plan.first_body, expectedUrl: firstRedirectUrl, index: 0 });
    this.#ownedPageIds.push(ownedPageId(first, "S758 first create"));
    const afterFirst = await this.#category();
    const firstCache = await this.#cacheIdentity(firstAssignedSlug);
    const historyReload = await this.#browser.observeHistoryAndReload({ pageUrl: firstRedirectUrl });
    const reloadedFirstCache = await this.#cacheIdentity(firstAssignedSlug);
    const secondAssignedSlug = pageSlug(afterFirst.slug, afterFirst.autonumber_next);
    const secondRedirectUrl = urlFor(this.#session.pageOrigin, secondAssignedSlug);
    const second = await this.#browser.captureAutonumberPage({ requestedSlug: this.#plan.second_requested_slug, title: this.#plan.second_title, wikitext: this.#plan.second_body, expectedUrl: secondRedirectUrl, index: 1 });
    this.#ownedPageIds.push(ownedPageId(second, "S758 second create"));
    const afterSecond = await this.#category();
    const disableAction = await this.#action({ siteId: site.site_id, categoryId: category.category_id, expectedSettingsRevision: afterSecond.settings_revision, enabled: false });
    const disabledRequestedSlug = this.#plan.disabled_requested_slug;
    const disabled = await this.#browser.captureAutonumberPage({ requestedSlug: disabledRequestedSlug, title: this.#plan.disabled_title, wikitext: this.#plan.disabled_body, expectedUrl: urlFor(this.#session.pageOrigin, disabledRequestedSlug), index: 2 });
    this.#ownedPageIds.push(ownedPageId(disabled, "S758 disabled create"));
    const disabledCategory = await this.#category();
    const secondCache = await this.#cacheIdentity(secondAssignedSlug);
    const afterFirstAllocator = allocator(afterFirst, "S758 allocator after first create");
    const afterSecondAllocator = allocator(afterSecond, "S758 allocator after second create");
    const afterDisabledAllocator = allocator(disabledCategory, "S758 allocator after disabled create");
    return [
      { case_id: "S758_CREATE_INITIAL", observations: { allocator_before: enabledAllocator, allocator_after: afterFirstAllocator, first_create: { ...first, category_slug: category.slug } } },
      { case_id: "S758_CREATE_SETTLED", observations: { allocator_before: enabledAllocator, allocator_after_first: afterFirstAllocator, allocator_after_second: afterSecondAllocator, allocator_after_disabled: afterDisabledAllocator, first_create: { ...first, category_slug: category.slug }, history: historyReload.history, reload: historyReload.reload, next_create: { ...second, category_slug: category.slug }, disable: { action: disableAction, enabled: disabledCategory.autonumber_enabled, requested_slug: disabledRequestedSlug, create: { ...disabled, category_slug: category.slug } }, cache_identity: { first: firstCache, reload: reloadedFirstCache, second: secondCache } } },
    ];
  }

  async cleanup() {
    const proof = await this.#lifecycle.cleanup({ session: this.#session, run_id: this.#plan.run_id, site_id: this.#siteId, category_id: this.#categoryId, run_owned_page_ids: [...this.#ownedPageIds], allocator_before: this.#before, cleanup: true });
    if (this.#resource !== null) this.#resources.release(this.#resource, proof);
    return proof;
  }

  verifyCase(caseId, observations) {
    return verifyOpen43SettingsLifecycleCase(caseId, observations, this.#plan);
  }

  static missingLifecycle() {
    return new MissingCandidateLifecycle();
  }
}

export const OPEN43_SETTINGS_LIFECYCLE_SOURCE_FILES = Object.freeze([
  "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
  "install/local/wikidot-verification/src/candidate-case-command.mjs",
  "install/local/wikidot-verification/src/candidate-case-runner.mjs",
  "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
  "install/local/wikidot-verification/src/open43-settings-browser-adapter.mjs",
  "install/local/wikidot-verification/src/open43-settings-candidate-http.mjs",
  "install/local/wikidot-verification/src/open43-settings-lifecycle-candidate-adapter.mjs",
  "install/local/wikidot-verification/src/open43-settings-lifecycle-candidate-case-set.mjs",
  "install/local/wikidot-verification/src/open43-settings-lifecycle-candidate-contract.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-observation.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
  "install/local/wikidot-verification/package.json",
  "install/local/wikidot-verification/pnpm-lock.yaml",
]);

export function createOpen43SettingsLifecycleCandidateAdapter(options) {
  return new Open43SettingsLifecycleCandidateAdapter(options);
}

export { verifyOpen43SettingsLifecycleCleanup } from "./open43-settings-lifecycle-candidate-contract.mjs";
