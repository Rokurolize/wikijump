import { expect, test } from "@playwright/test"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

test("supported browser families share the same core page and authority boundary", async ({
  page
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  const response = await page.goto("/theme:yossistyle")

  expect(response?.status()).toBe(200)
  await expect(page.locator("#page-content p")).toHaveText("XML-RPC theme body marker.")
  await expect(page.locator("#page-title")).toBeVisible()
  await expect(page.locator("#page-options-container")).toBeVisible()

  expect(response?.headers()["content-security-policy"]).toContain("default-src")
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff")
})
