import assert from "node:assert/strict";
import test from "node:test";

import { candidateCaseSet, candidateCaseUsage } from "../src/candidate-case-command.mjs";
import {
  OPEN43_BROWSER_CANDIDATE_CASE_IDS,
  OPEN43_CANDIDATE_DENOMINATORS,
  OPEN43_PAGE_QUERY_CANDIDATE_CASE_IDS,
  OPEN43_SETTINGS_LIFECYCLE_CANDIDATE_CASE_IDS,
} from "../src/open43-candidate-denominator-registry.mjs";
import { OPEN43_SETTINGS_BROWSER_CASE_IDS } from "../src/open43-settings-browser-candidate-contract.mjs";

test("Open43 candidate denominators are exact, disjoint, and handoff-only", () => {
  assert.deepEqual(OPEN43_SETTINGS_BROWSER_CASE_IDS, [
    "S754_ANALYTICS_INITIAL",
    "S754_ANALYTICS_SETTLED",
    "S755_THEME_INITIAL",
    "S755_THEME_SETTLED",
    "S757_TOOLBAR_INITIAL",
    "S757_TOOLBAR_SETTLED",
    "S1046_ADMIN_INITIAL",
    "S1046_ADMIN_SETTLED",
    "S1046_PUBLIC_PERMISSION_CSRF_REVISION_MATRIX",
  ]);
  assert.deepEqual(OPEN43_BROWSER_CANDIDATE_CASE_IDS, [
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
  assert.deepEqual(OPEN43_SETTINGS_LIFECYCLE_CANDIDATE_CASE_IDS, ["S758_CREATE_INITIAL", "S758_CREATE_SETTLED"]);
  assert.deepEqual(OPEN43_PAGE_QUERY_CANDIDATE_CASE_IDS, [
    "Q779_EXPLICIT_ROOT_ACTOR_AND_LIFECYCLE_CANDIDATE",
    "Q809_PERMISSION_BEFORE_LIMIT_CANDIDATE",
    "Q809_SERVED_MUTATION_AND_BROWSER_CANDIDATE",
    "Q811_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE",
    "Q1027_RENAME_DELETE_RESTORE_CACHE_AND_SERVED_CANDIDATE",
    "Q1028_CATEGORY_LIFECYCLE_AND_CACHE",
    "Q1040_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE",
  ]);

  assert.deepEqual(Object.keys(OPEN43_CANDIDATE_DENOMINATORS), ["settings", "browser", "settings_lifecycle", "page_query"]);
  assert.deepEqual(OPEN43_CANDIDATE_DENOMINATORS.settings.caseIds, OPEN43_SETTINGS_BROWSER_CASE_IDS);
  assert.equal(OPEN43_CANDIDATE_DENOMINATORS.settings_lifecycle.caseIds.includes("S758_CREATE_INITIAL"), true);
  assert.equal(OPEN43_CANDIDATE_DENOMINATORS.page_query.caseIds.includes("S758_CREATE_INITIAL"), false);
  assert.equal(OPEN43_SETTINGS_BROWSER_CASE_IDS.includes("S758_CREATE_INITIAL"), false);

  const all = [
    ...OPEN43_SETTINGS_BROWSER_CASE_IDS,
    ...OPEN43_BROWSER_CANDIDATE_CASE_IDS,
    ...OPEN43_SETTINGS_LIFECYCLE_CANDIDATE_CASE_IDS,
    ...OPEN43_PAGE_QUERY_CANDIDATE_CASE_IDS,
  ];
  assert.equal(new Set(all).size, all.length);
});

test("handoff denominators are not runnable candidate case sets", async () => {
  assert.doesNotMatch(candidateCaseUsage(), /open43-(browser-surfaces|settings-lifecycle|page-query-surfaces)/u);
  for (const name of ["open43-browser-surfaces", "open43-settings-lifecycle", "open43-page-query-surfaces"]) {
    await assert.rejects(candidateCaseSet(name), /unknown source-owned candidate case set/u);
  }
});
