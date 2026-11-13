import { expect, test } from "./hermetic-playwright"

import {
  HISTORIC_YOSSISTYLE_TYPOGRAPHY_DESKTOP,
  YOSSISTYLE_RELATIONS
} from "./wikidot-typography-recapture-historic"

import {
  readTypographySnapshot,
  typographyMismatches,
  typographyRelationMismatches,
  type TypographyRelationExpectations,
  type TypographySnapshot
} from "./wikidot-typography-parity-helpers"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

type TypographyParityCase = Readonly<{
  slug: string
  bodyText: string
  generatedStyleCount: number
  relations: TypographyRelationExpectations
  desktopSnapshot?: TypographySnapshot
}>

const TYPOGRAPHY_PARITY_CASES: readonly TypographyParityCase[] = [
  {
    slug: "theme:yossistyle",
    bodyText: "XML-RPC theme body marker.",
    generatedStyleCount: 2,
    relations: YOSSISTYLE_RELATIONS,
    desktopSnapshot: HISTORIC_YOSSISTYLE_TYPOGRAPHY_DESKTOP
  },
  {
    slug: "theme:wikidot-default",
    bodyText: "Vendored shell typography body marker.",
    generatedStyleCount: 0,
    relations: {
      titlePerBody: 2,
      contentPerBody: 1,
      leadingPerContent: 1.5
    }
  },
  {
    slug: "theme:content-scaled",
    bodyText: "Content-scaled typography body marker.",
    generatedStyleCount: 1,
    relations: {
      titlePerBody: 2,
      contentPerBody: 0.9,
      leadingPerContent: 1.5
    }
  }
]

for (const typographyCase of TYPOGRAPHY_PARITY_CASES) {
  test(`imported ${typographyCase.slug} typography matches recorded references`, async ({
    page
  }, testInfo) => {
    test.skip(
      !process.env.PLAYWRIGHT_HTTPS_APP_PORT,
      "requires the hermetic HTTPS Vite fixture"
    )
    const mobile = testInfo.project.name.startsWith("mobile-")
    const host = `https://localhost:${process.env.PLAYWRIGHT_HTTPS_APP_PORT}`
    await page.setExtraHTTPHeaders(SITE_HEADERS)
    const response = await page.goto(`${host}/${typographyCase.slug}`, {
      waitUntil: "networkidle"
    })
    expect(response?.status()).toBe(200)
    await expect(page.locator("#page-content p")).toHaveText(typographyCase.bodyText)
    await expect(page.locator("head style[data-wikidot-generated-css]")).toHaveCount(
      typographyCase.generatedStyleCount
    )

    const actual = await readTypographySnapshot(page)
    const relationMismatches = typographyRelationMismatches(
      actual,
      typographyCase.relations,
      mobile
    )
    expect(relationMismatches).toEqual([])

    if (!mobile && typographyCase.desktopSnapshot) {
      expect(typographyMismatches(actual, typographyCase.desktopSnapshot)).toEqual([])
    }
  })
}
