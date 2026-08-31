import { test } from "@playwright/test"

import { OPEN43_MEDIA_BROWSER_CASE_IDS } from "../../install/local/wikidot-verification/src/open43-media-browser-candidate.mjs"

test.describe("Open43 media browser candidate denominator", () => {
  for (const caseId of OPEN43_MEDIA_BROWSER_CASE_IDS) {
    test(caseId, async () => {
      test.skip(true, "executed by candidate-case-command through runCandidateCaseSet")
    })
  }
})
