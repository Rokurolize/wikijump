import { OPEN43_SETTINGS_BROWSER_CASE_IDS } from "./open43-settings-browser-candidate-contract.mjs";
import { OPEN43_ISSUE775_CASE_IDS } from "./open43-issue775-edit-candidate-contract.mjs";
import { OPEN43_ISSUE777_CASE_IDS } from "./open43-issue777-print-candidate-case-set.mjs";
import { OPEN43_ISSUE1029_CASE_IDS } from "./open43-issue1029-join-candidate-case-set.mjs";
import { OPEN43_ISSUE1041_CASE_IDS } from "./open43-issue1041-lifecycle-candidate-case-set.mjs";
import { OPEN43_SETTINGS_LIFECYCLE_CASE_IDS } from "./open43-settings-lifecycle-candidate-contract.mjs";

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

export const OPEN43_SETTINGS_LIFECYCLE_CANDIDATE_CASE_IDS = OPEN43_SETTINGS_LIFECYCLE_CASE_IDS;

export const OPEN43_PAGE_QUERY_CANDIDATE_CASE_IDS = Object.freeze([
  "Q779_EXPLICIT_ROOT_ACTOR_AND_LIFECYCLE_CANDIDATE",
  "Q809_PERMISSION_BEFORE_LIMIT_CANDIDATE",
  "Q809_SERVED_MUTATION_AND_BROWSER_CANDIDATE",
  "Q811_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE",
  "Q1027_RENAME_DELETE_RESTORE_CACHE_AND_SERVED_CANDIDATE",
  "Q1028_CATEGORY_LIFECYCLE_AND_CACHE",
  "Q1040_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE",
]);

export const OPEN43_CANDIDATE_DENOMINATORS = Object.freeze({
  settings: Object.freeze({ id: "open43-settings-browser", caseIds: OPEN43_SETTINGS_BROWSER_CASE_IDS }),
  issue775_edit: Object.freeze({ id: "open43-issue775-edit", caseIds: OPEN43_ISSUE775_CASE_IDS }),
  issue777_print: Object.freeze({ id: "open43-issue777-print", caseIds: OPEN43_ISSUE777_CASE_IDS }),
  issue1029_join: Object.freeze({ id: "open43-issue1029-join", caseIds: OPEN43_ISSUE1029_CASE_IDS }),
  issue1041_lifecycle: Object.freeze({ id: "open43-issue1041-action-lifecycle", caseIds: OPEN43_ISSUE1041_CASE_IDS }),
  browser: Object.freeze({ id: "open43-browser-surfaces", caseIds: OPEN43_BROWSER_CANDIDATE_CASE_IDS }),
  settings_lifecycle: Object.freeze({ id: "open43-settings-lifecycle", caseIds: OPEN43_SETTINGS_LIFECYCLE_CANDIDATE_CASE_IDS }),
  page_query: Object.freeze({ id: "open43-page-query-surfaces", caseIds: OPEN43_PAGE_QUERY_CANDIDATE_CASE_IDS }),
});

const allCaseIds = Object.values(OPEN43_CANDIDATE_DENOMINATORS).flatMap(({ caseIds }) => caseIds);
if (new Set(allCaseIds).size !== allCaseIds.length) throw new Error("Open43 candidate denominators overlap");
