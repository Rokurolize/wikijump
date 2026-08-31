import { spawnSync } from "node:child_process";

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
const DOCKER = "/usr/bin/docker";

function docker(args) {
  const result = spawnSync(DOCKER, args, {
    encoding: "utf8",
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !["DOCKER_CONTEXT", "DOCKER_HOST"].includes(key))),
  });
  if (result.error || result.status !== 0) throw new Error("S758 candidate lifecycle Docker operation failed");
  return result.stdout.trim();
}

function databaseContainer(project) {
  const ids = docker([
    "ps",
    "--filter", `label=com.docker.compose.project=${project}`,
    "--filter", "label=com.docker.compose.service=database",
    "--format", "{{.ID}}",
  ]).split(/\s+/u).filter(Boolean);
  if (ids.length !== 1 || !/^[0-9a-f]{12,64}$/u.test(ids[0])) throw new Error("S758 candidate lifecycle database container is not unique");
  return ids[0];
}

function databaseQuery(project, sql) {
  const container = databaseContainer(project);
  return docker([
    "exec", "-e", "PGPASSWORD=wikijump", container,
    "psql", "-h", "127.0.0.1", "-U", "wikijump", "-d", "wikijump", "-Atc", sql,
  ]);
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function assignedSlug(categorySlug, next) {
  return categorySlug === "_default" ? String(next) : `${categorySlug}:${next}`;
}

function restoreAllocator(project, before, siteId, categoryId) {
  const sql = `UPDATE page_category SET autonumber_enabled = ${before.enabled ? "TRUE" : "FALSE"}, autonumber_next = ${before.next}, settings_revision = ${before.settings_revision} WHERE site_id = ${siteId} AND category_id = ${categoryId};`;
  const result = databaseQuery(project, sql);
  if (result !== "UPDATE 1") throw new Error("S758 candidate lifecycle allocator restore did not update exactly one category");
}

class CandidateLifecycleOwner {
  #candidateIdentity;
  #session;
  #plan;
  #before = null;

  constructor({ candidateIdentity, session, plan }) {
    this.#candidateIdentity = candidateIdentity;
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

  async cleanup({ site_id: siteId, category_id: categoryId, run_owned_page_ids: pageIds }) {
    if (this.#before === null) throw new Error("S758 candidate lifecycle was not prepared");
    const titles = [this.#plan.first_title, this.#plan.second_title, this.#plan.disabled_title];
    const discovered = databaseQuery(
      this.#candidateIdentity.candidate.compose_project,
      `SELECT page.page_id FROM page JOIN page_revision ON page_revision.revision_id = page.latest_revision_id WHERE page.site_id = ${siteId} AND page.deleted_at IS NULL AND page_revision.title IN (${titles.map(sqlString).join(", ")}) ORDER BY page.page_id`,
    ).split(/\s+/u).filter(Boolean).map((value) => Number.parseInt(value, 10));
    if (discovered.some((pageId) => !Number.isSafeInteger(pageId) || pageId <= 0)) throw new Error("S758 candidate lifecycle discovered an invalid run-owned page ID");
    const ownedPageIds = [...new Set([...pageIds, ...discovered])];
    for (const pageId of [...ownedPageIds].reverse()) {
      const page = await this.#session.rpc("page_get", { site_id: siteId, page: pageId, details: { wikitext: false, compiled: false } }, { actor: "administrator", siteId, cleanup: true });
      if (page !== null) {
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
    restoreAllocator(this.#candidateIdentity.candidate.compose_project, this.#before, siteId, categoryId);
    const category = await this.#session.rpc("category_get", { site: siteId, category: categoryId }, { actor: "administrator", siteId, cleanup: true });
    if (category?.autonumber_enabled !== this.#before.enabled || category.autonumber_next !== this.#before.next || category.settings_revision !== this.#before.settings_revision) {
      throw new Error("S758 candidate lifecycle allocator restore did not round-trip");
    }
    const residual = [];
    for (const pageId of ownedPageIds) {
      const page = await this.#session.rpc("page_get", { site_id: siteId, page: pageId, details: { wikitext: false, compiled: false } }, { actor: "administrator", siteId, cleanup: true });
      if (page !== null) residual.push(pageId);
    }
    return {
      public_absence_verified: residual.length === 0,
      run_owned_state_absent: residual.length === 0,
      disposable_candidate_discarded: residual.length === 0,
      run_owned_page_ids: residual,
      allocator_restored: true,
    };
  }
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
      const category = fixture.transition_category;
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
