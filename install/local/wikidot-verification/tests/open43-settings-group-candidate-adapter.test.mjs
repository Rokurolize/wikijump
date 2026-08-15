import assert from "node:assert/strict";
import test from "node:test";

import { candidateCaseUsage } from "../src/candidate-case-command.mjs";
import {
  OPEN43_SETTINGS_ANALYTICS_CASE_IDS,
  OPEN43_SETTINGS_THEME_CASE_IDS,
  OPEN43_SETTINGS_TOOLBAR_CASE_IDS,
  OPEN43_SETTINGS_UNAVAILABLE_CASE_IDS,
} from "../src/open43-settings-browser-candidate-contract.mjs";

test("settings candidate group denominator keeps unavailable rows blocked", () => {
  const groupedCaseIds = [
    ...OPEN43_SETTINGS_ANALYTICS_CASE_IDS,
    ...OPEN43_SETTINGS_THEME_CASE_IDS,
    ...OPEN43_SETTINGS_TOOLBAR_CASE_IDS,
  ];
  assert.deepEqual([...new Set(groupedCaseIds)], [
    ...OPEN43_SETTINGS_ANALYTICS_CASE_IDS,
    ...OPEN43_SETTINGS_THEME_CASE_IDS,
    ...OPEN43_SETTINGS_TOOLBAR_CASE_IDS,
  ]);
  assert.equal(OPEN43_SETTINGS_UNAVAILABLE_CASE_IDS.some((caseId) => groupedCaseIds.includes(caseId)), false);
  assert.match(candidateCaseUsage(), /open43-settings-analytics\|open43-settings-theme\|open43-settings-toolbar/u);
});
