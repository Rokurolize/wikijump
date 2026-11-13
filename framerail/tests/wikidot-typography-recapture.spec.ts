import liveRecapture from "./fixtures/wikidot-typography-recapture/yossistyle-live-wikidot-20261113.json" with { type: "json" }

import {
  HISTORIC_YOSSISTYLE_TYPOGRAPHY_DESKTOP,
  YOSSISTYLE_RELATIONS
} from "./wikidot-typography-recapture-historic"

import {
  typographyMismatches,
  typographyRelationMismatches,
  type TypographySnapshot
} from "./wikidot-typography-parity-helpers"

import { expect, test } from "./hermetic-playwright"

const ENGINE_RECAPTURE_KEYS: Readonly<Record<string, string>> = {
  chromium: "desktop-chromium",
  firefox: "desktop-chromium",
  webkit: "desktop-chromium",
  "mobile-chromium": "mobile-chromium-pixel-7"
}

test("retained live Wikidot recapture stays separate from the historic fixture reference", () => {
  expect(liveRecapture.same_source_as_historic_fixture).toBe(false)
  const desktopTypography = liveRecapture.engines["desktop-chromium"].typography
  expect(
    typographyMismatches(
      desktopTypography as TypographySnapshot,
      HISTORIC_YOSSISTYLE_TYPOGRAPHY_DESKTOP
    )
  ).not.toEqual([])
})

test("live Wikidot recapture satisfies its own typography relationships", ({
  page
}, testInfo) => {
  void page
  const engineKey = ENGINE_RECAPTURE_KEYS[testInfo.project.name]
  test.skip(!engineKey, "recapture reference does not cover this engine")
  const mobile = testInfo.project.name.startsWith("mobile-")
  const typography = liveRecapture.engines[
    engineKey as keyof typeof liveRecapture.engines
  ].typography as TypographySnapshot
  expect(typographyRelationMismatches(typography, YOSSISTYLE_RELATIONS, mobile)).toEqual(
    []
  )
})
