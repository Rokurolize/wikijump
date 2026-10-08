import { expect, test } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}
const APP_URL = `http://localhost:${process.env.PLAYWRIGHT_APP_PORT ?? "4173"}`

test.use({ viewport: { width: 375, height: 812 } })

test("/-/about diagnostics stay inside a 375px viewport", async ({ page }) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.goto(`${APP_URL}/-/about`)
  await expect(page.locator("table.platform-info")).toBeVisible()

  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }))
  expect(widths.scrollWidth, JSON.stringify(widths)).toBeLessThanOrEqual(
    widths.clientWidth
  )
})
