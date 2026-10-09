import { expect, test } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}
const APP_URL = `http://localhost:${process.env.PLAYWRIGHT_APP_PORT ?? "4173"}`

test("native account and wiki pages fit a 375px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 })
  await page.setExtraHTTPHeaders(SITE_HEADERS)

  for (const path of ["/-/register", "/-/login", "/page-workflow-probe"]) {
    const response = await page.goto(`${APP_URL}${path}`)
    expect(response?.status(), `${path} response`).toBe(200)
    await expect
      .poll(() =>
        page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth
        }))
      )
      .toMatchObject({ viewport: 375, document: 375 })
  }
})
