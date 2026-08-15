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
  candidateLifecycleFactory = () => Open43SettingsLifecycleCandidateAdapter.missingLifecycle(),
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
      const lifecycle = candidateLifecycleFactory({ candidateIdentity, privateInput, runId, plan });
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
