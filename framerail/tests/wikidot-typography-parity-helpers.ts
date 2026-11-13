export const QUANTIZATION_TOLERANCE_PX = 0.02

const PX_VALUE = /^(-?\d+(?:\.\d+)?)px$/

export type TypographyProperties = Readonly<Record<string, string>>

export type TypographySnapshot = Readonly<Record<string, Readonly<TypographyProperties>>>

export const parsePx = (value: string | undefined): number | null => {
  if (value === undefined) return null
  const match = PX_VALUE.exec(value)
  return match ? Number(match[1]) : null
}

export const typographyMismatches = (
  actual: TypographySnapshot,
  expected: TypographySnapshot
): string[] => {
  const mismatches: string[] = []
  for (const [element, properties] of Object.entries(expected)) {
    for (const [property, expectedValue] of Object.entries(properties)) {
      const actualValue = actual[element]?.[property]
      const expectedPx = PX_VALUE.exec(expectedValue)
      const actualPx = actualValue === undefined ? null : PX_VALUE.exec(actualValue)
      if (expectedPx && actualPx) {
        const difference = Math.abs(Number(actualPx[1]) - Number(expectedPx[1]))
        if (difference > QUANTIZATION_TOLERANCE_PX) {
          mismatches.push(
            `${element}.${property}: expected ${expectedValue}, got ${actualValue}`
          )
        }
      } else if (actualValue !== expectedValue) {
        mismatches.push(
          `${element}.${property}: expected ${expectedValue}, got ${actualValue}`
        )
      }
    }
  }
  return mismatches
}

export type TypographyRelationExpectations = Readonly<{
  titlePerBody: number
  contentPerBody: number
  leadingPerContent: number
}>

export const typographyRelationMismatches = (
  actual: TypographySnapshot,
  expected: TypographyRelationExpectations,
  mobile: boolean,
  mobileContentPerBody?: number
): string[] => {
  const bodyPx = parsePx(actual.body?.fontSize)
  const contentPx = parsePx(actual.content?.fontSize)
  const titlePx = parsePx(actual.title?.fontSize)
  const leadingPx = parsePx(actual.content?.lineHeight)
  if (bodyPx === null || contentPx === null || titlePx === null || leadingPx === null) {
    return ["typography snapshot is missing px-valued font sizes"]
  }

  const mismatches: string[] = []
  const relationTolerance = 0.02
  const contentPerBody = mobile
    ? (mobileContentPerBody ?? 0.9)
    : expected.contentPerBody
  if (Math.abs(titlePx / bodyPx - expected.titlePerBody) > relationTolerance) {
    mismatches.push(
      `title/body: expected ${expected.titlePerBody}, got ${titlePx / bodyPx}`
    )
  }
  if (Math.abs(contentPx / bodyPx - contentPerBody) > relationTolerance) {
    mismatches.push(
      `content/body: expected ${contentPerBody}, got ${contentPx / bodyPx}`
    )
  }
  if (Math.abs(leadingPx / contentPx - expected.leadingPerContent) > relationTolerance) {
    mismatches.push(
      `leading/content: expected ${expected.leadingPerContent}, got ${leadingPx / contentPx}`
    )
  }
  return mismatches
}

export const readTypographySnapshot = async (
  page: import("@playwright/test").Page
): Promise<TypographySnapshot> =>
  page.evaluate(() => {
    const typography = (element: Element | null) => {
      if (!element) throw new Error("typography probe target is missing")
      const style = getComputedStyle(element)
      const properties = [
        ["fontFamily", "font-family"],
        ["fontSize", "font-size"],
        ["fontWeight", "font-weight"],
        ["lineHeight", "line-height"],
        ["textRendering", "text-rendering"]
      ] as const
      return Object.fromEntries(
        properties.map(([key, property]) => [key, style.getPropertyValue(property)])
      )
    }

    return {
      body: typography(document.body),
      content: typography(document.querySelector("#page-content p")),
      title: typography(document.querySelector("#page-title"))
    }
  })
