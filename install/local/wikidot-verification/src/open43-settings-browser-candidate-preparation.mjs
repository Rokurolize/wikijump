import { requirePlainObject, sha256Value } from "./standing-browser-parity-util.mjs";

export const OPEN43_BROWSER_CANDIDATE_CASE_IDS = Object.freeze([
  "B610_CHROME_INITIAL",
  "B610_CHROME_SETTLED",
  "B610_FAVICON_ARTICLE_SIDEBAR_THEME_NETWORK",
  "B610_EXACT_SERVED_IDENTITIES",
  "B689_TABVIEW_INITIAL",
  "B689_TABVIEW_SETTLED",
  "B689_THEME_BASALT_GEOMETRY",
  "B689_SCP8980_AND_NAVIGATION_LIFECYCLE",
  "B690_GEOMETRY_INITIAL",
  "B690_GEOMETRY_SETTLED",
  "B690_FIXED_SIX_PAGE_DENOMINATOR",
  "B690_PILOT_SCALE_COMPARE",
  "B822_PAGE_TAGS_INITIAL",
  "B822_PAGE_TAGS_SETTLED",
]);

export const OPEN43_SETTINGS_LIFECYCLE_CANDIDATE_CASE_IDS = Object.freeze([
  "S758_CREATE_INITIAL",
  "S758_CREATE_SETTLED",
]);

export const OPEN43_PAGE_QUERY_CANDIDATE_CASE_IDS = Object.freeze([
  "Q779_EXPLICIT_ROOT_ACTOR_AND_LIFECYCLE_CANDIDATE",
  "Q809_PERMISSION_BEFORE_LIMIT_CANDIDATE",
  "Q809_SERVED_MUTATION_AND_BROWSER_CANDIDATE",
  "Q811_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE",
  "Q1027_RENAME_DELETE_RESTORE_CACHE_AND_SERVED_CANDIDATE",
  "Q1028_CATEGORY_LIFECYCLE_AND_CACHE",
  "Q1040_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE",
]);

const requiredIdentity = Object.freeze([
  "source_commit_sha256",
  "ftml_revision_sha256",
  "deepwell_cargo_lock_sha256",
  "framerail_pnpm_lock_sha256",
  "runtime_identity_sha256",
  "fixture_identity_sha256",
  "actor_identity_sha256",
  "browser_identity_sha256",
  "cleanup_proof_sha256",
]);

const contract = (caseId, surface, requiredObservations) => Object.freeze({
  case_id: caseId,
  surface,
  required_observations: Object.freeze(requiredObservations),
  required_identity: requiredIdentity,
});

export const OPEN43_CANDIDATE_BEHAVIOR_CONTRACTS = Object.freeze({
  B610_CHROME_INITIAL: contract("B610_CHROME_INITIAL", "browser", ["initial_paint", "chrome_version"]),
  B610_CHROME_SETTLED: contract("B610_CHROME_SETTLED", "browser", ["settled_paint", "chrome_version"]),
  B610_FAVICON_ARTICLE_SIDEBAR_THEME_NETWORK: contract("B610_FAVICON_ARTICLE_SIDEBAR_THEME_NETWORK", "browser", ["served_dom", "network"]),
  B610_EXACT_SERVED_IDENTITIES: contract("B610_EXACT_SERVED_IDENTITIES", "browser", ["served_identity", "runtime"]),
  B689_TABVIEW_INITIAL: contract("B689_TABVIEW_INITIAL", "browser", ["initial_paint", "tabview_dom"]),
  B689_TABVIEW_SETTLED: contract("B689_TABVIEW_SETTLED", "browser", ["settled_paint", "tabview_dom"]),
  B689_THEME_BASALT_GEOMETRY: contract("B689_THEME_BASALT_GEOMETRY", "browser", ["theme", "geometry"]),
  B689_SCP8980_AND_NAVIGATION_LIFECYCLE: contract("B689_SCP8980_AND_NAVIGATION_LIFECYCLE", "browser", ["navigation", "lifecycle"]),
  B690_GEOMETRY_INITIAL: contract("B690_GEOMETRY_INITIAL", "browser", ["initial_paint", "geometry"]),
  B690_GEOMETRY_SETTLED: contract("B690_GEOMETRY_SETTLED", "browser", ["settled_paint", "geometry"]),
  B690_FIXED_SIX_PAGE_DENOMINATOR: contract("B690_FIXED_SIX_PAGE_DENOMINATOR", "browser", ["page_denominator", "served_output"]),
  B690_PILOT_SCALE_COMPARE: contract("B690_PILOT_SCALE_COMPARE", "browser", ["scale_comparison", "served_output"]),
  B822_PAGE_TAGS_INITIAL: contract("B822_PAGE_TAGS_INITIAL", "browser", ["initial_paint", "page_tags"]),
  B822_PAGE_TAGS_SETTLED: contract("B822_PAGE_TAGS_SETTLED", "browser", ["settled_paint", "page_tags"]),
  S758_CREATE_INITIAL: contract("S758_CREATE_INITIAL", "settings-lifecycle", ["category_create", "allocator_before"]),
  S758_CREATE_SETTLED: contract("S758_CREATE_SETTLED", "settings-lifecycle", ["category_create", "allocator_after"]),
  Q779_EXPLICIT_ROOT_ACTOR_AND_LIFECYCLE_CANDIDATE: contract("Q779_EXPLICIT_ROOT_ACTOR_AND_LIFECYCLE_CANDIDATE", "page-query", ["explicit_root", "actor_views", "lifecycle"]),
  Q809_PERMISSION_BEFORE_LIMIT_CANDIDATE: contract("Q809_PERMISSION_BEFORE_LIMIT_CANDIDATE", "page-query", ["permission_order", "limit_boundary"]),
  Q809_SERVED_MUTATION_AND_BROWSER_CANDIDATE: contract("Q809_SERVED_MUTATION_AND_BROWSER_CANDIDATE", "page-query", ["served_mutation", "browser"]),
  Q811_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE: contract("Q811_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE", "page-query", ["default_author_date", "served_mutation"]),
  Q1027_RENAME_DELETE_RESTORE_CACHE_AND_SERVED_CANDIDATE: contract("Q1027_RENAME_DELETE_RESTORE_CACHE_AND_SERVED_CANDIDATE", "page-query", ["rename_delete_restore", "cache", "served_output"]),
  Q1028_CATEGORY_LIFECYCLE_AND_CACHE: contract("Q1028_CATEGORY_LIFECYCLE_AND_CACHE", "page-query", ["category_lifecycle", "cache"]),
  Q1040_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE: contract("Q1040_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE", "page-query", ["default_author_date", "served_mutation"]),
});

const allCandidateIds = Object.freeze([
  ...OPEN43_BROWSER_CANDIDATE_CASE_IDS,
  ...OPEN43_SETTINGS_LIFECYCLE_CANDIDATE_CASE_IDS,
  ...OPEN43_PAGE_QUERY_CANDIDATE_CASE_IDS,
]);

for (const caseId of allCandidateIds) {
  if (!Object.hasOwn(OPEN43_CANDIDATE_BEHAVIOR_CONTRACTS, caseId)) throw new Error(`missing candidate behavior contract: ${caseId}`);
}

export function candidateBehaviorContract(caseId) {
  const value = OPEN43_CANDIDATE_BEHAVIOR_CONTRACTS[caseId];
  if (value === undefined) throw new Error(`unknown candidate behavior contract: ${caseId}`);
  return value;
}

export function verifyOpen43PreparedCandidateCase(caseId, rawObservations) {
  const observations = requirePlainObject(rawObservations, `${caseId} observations`);
  const expected = candidateBehaviorContract(caseId);
  if (JSON.stringify(observations.behavior_contract) !== JSON.stringify(expected)) throw new Error(`${caseId} behavior contract does not match the exact denominator contract`);
  const evidence = requirePlainObject(observations.evidence, `${caseId} evidence`);
  if (evidence.status !== "observed") throw new Error(`${caseId} candidate preparation is not executable evidence`);
  const identity = requirePlainObject(evidence.identity, `${caseId} evidence identity`);
  for (const field of requiredIdentity) if (typeof identity[field] !== "string" || !/^[0-9a-f]{64}$/u.test(identity[field])) throw new Error(`${caseId} is missing ${field}`);
  const observed = requirePlainObject(evidence.observations, `${caseId} observed behavior`);
  for (const field of expected.required_observations) if (!Object.hasOwn(observed, field)) throw new Error(`${caseId} is missing observed ${field}`);
  if (evidence.cleanup?.public_absence_verified !== true) throw new Error(`${caseId} is missing public cleanup proof`);
  return { verified: true, behavior_contract_sha256: sha256Value(expected), evidence_identity_sha256: sha256Value(identity) };
}

const SOURCE_FILES = Object.freeze([
  "install/local/wikidot-verification/src/candidate-case-command.mjs",
  "install/local/wikidot-verification/src/candidate-case-runner.mjs",
  "install/local/wikidot-verification/src/open43-settings-browser-candidate-preparation.mjs",
  "install/local/wikidot-verification/package.json",
  "install/local/wikidot-verification/pnpm-lock.yaml",
]);

export function createOpen43PreparationCaseSet({ id, caseIds }) {
  const fixedCaseIds = Object.freeze([...caseIds]);
  return Object.freeze({
    id,
    caseIds: fixedCaseIds,
    preparation_only: true,
    prepareRun({ candidateIdentity }) {
      if (candidateIdentity.candidate.endpoint.host !== "scpaiueouiuiuiui.wikijump.localhost" || candidateIdentity.candidate.endpoint.port === 443 || candidateIdentity.candidate.port_443_published !== false) throw new Error(`Open43 preparation cases require exact non-standing scpaiueouiuiuiui.wikijump.localhost`);
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: [],
        privateInputIdentity: { mode: "candidate-preparation" },
        browserCredentialPolicy: "none",
        plan: { schema: "wikijump.open43_candidate_preparation_plan.v1", case_ids: fixedCaseIds, behavior_contracts_sha256: sha256Value(fixedCaseIds.map(candidateBehaviorContract)) },
        execute: async () => { throw new Error(`${id} is preparation-only; bind its producer before candidate execution`); },
        cleanup: async () => ({ public_absence_verified: true, preparation_only: true }),
        verifyCase: (caseId, observations) => verifyOpen43PreparedCandidateCase(caseId, observations),
        verifyCleanup: (proof) => proof?.preparation_only === true && proof?.public_absence_verified === true ? proof : (() => { throw new Error(`${id} preparation cleanup proof is missing`); })(),
      });
    },
  });
}

export const OPEN43_BROWSER_CANDIDATE_CASE_SET = createOpen43PreparationCaseSet({ id: "open43-browser-surfaces", caseIds: OPEN43_BROWSER_CANDIDATE_CASE_IDS });
export const OPEN43_SETTINGS_LIFECYCLE_CANDIDATE_CASE_SET = createOpen43PreparationCaseSet({ id: "open43-settings-lifecycle", caseIds: OPEN43_SETTINGS_LIFECYCLE_CANDIDATE_CASE_IDS });
export const OPEN43_PAGE_QUERY_CANDIDATE_CASE_SET = createOpen43PreparationCaseSet({ id: "open43-page-query-surfaces", caseIds: OPEN43_PAGE_QUERY_CANDIDATE_CASE_IDS });

