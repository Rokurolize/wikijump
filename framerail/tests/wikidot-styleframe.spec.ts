import { expect, test } from "@playwright/test"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

test("Wikidot styleFrame remains inert relative to its parent", async ({ page }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.goto("/wikidot-tabview")

  const css = ".styleframe-browser-marker { color: rgb(1, 2, 3); }"
  const source = `/-/wikidot-interwiki/styleFrame.html?priority=2&css=${encodeURIComponent(css)}`
  await page.evaluate((iframeSource) => {
    const marker = document.createElement("div")
    marker.id = "styleframe-parent-marker"
    marker.className = "styleframe-browser-marker"
    document.body.appendChild(marker)
    const iframe = document.createElement("iframe")
    iframe.id = "styleframe-browser-fixture"
    iframe.src = iframeSource
    document.body.appendChild(iframe)
  }, source)

  const parentInjection = page.locator(
    'head style[data-wikidot-style-frame="wikidot-style-frame"]'
  )
  await expect(parentInjection).toHaveCount(0)

  const frame = page.frameLocator("#styleframe-browser-fixture")
  await expect
    .poll(() => frame.locator("head style").evaluate((style) => style.textContent))
    .toBe(css)
  await expect(frame.locator("script")).toHaveCount(0)
  expect(
    await page
      .locator("#styleframe-parent-marker")
      .evaluate((element) => getComputedStyle(element).color)
  ).not.toBe("rgb(1, 2, 3)")

  await page.locator("#styleframe-browser-fixture").evaluate((iframe) => iframe.remove())
  await expect(parentInjection).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
