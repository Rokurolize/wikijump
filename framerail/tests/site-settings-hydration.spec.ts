import { expect, test } from "@playwright/test"

const AUTHENTICATED_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki",
  cookie: "wikijump_token=fixture-session-token"
}

test("site settings hydrate without a reactive update loop", async ({ page }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)

  const response = await page.goto("/_admin")
  expect(response?.status()).toBe(200)
  await expect(page.locator("#sm-ganalytics-form")).toBeVisible()
  await expect(page.locator("#sm-appearance-cats")).toHaveValue("100")
  await expect(page.locator("#sm-autonumerate-add-catname1")).toHaveValue("100")
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  )

  expect(pageErrors).toEqual([])
})
