import { expect, test } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

test("ListPages pagination shows a spinner while the next page loads", async ({
  page,
  context
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await context.addCookies([
    { name: "wikidot_token7", value: "spec-token", domain: "localhost", path: "/" },
    { name: "wikidot_token7", value: "spec-token", domain: "127.0.0.1", path: "/" }
  ])

  await page.goto("/listpages-spinner")
  const box = page.locator(".list-pages-box[data-lp-id]")
  await expect(box).toBeAttached()

  await expect(page.locator(".list-pages-spinner")).toHaveCount(0)
  await expect(page.locator(".list-pages-status.list-pages-status-hidden")).toBeAttached()

  const nextLink = page.locator("#listpages-spinner-page-two")
  await expect(nextLink).toHaveAttribute("data-lp-link-key", "p")
  await expect(nextLink).toHaveAttribute("data-lp-link-value", "2")

  await page.route("**/listpages-spinner/p/2", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    await route.continue()
  })

  await nextLink.click()

  await expect(page.locator(".pager .list-pages-spinner")).toBeAttached()
  await expect(page.locator(".list-pages-spinner")).toHaveAttribute("aria-hidden", "true")
  await expect(box).toHaveAttribute("aria-busy", "true")
  await expect(page.locator(".list-pages-status")).toHaveText("Loading page…")

  await expect(page.locator("#listpages-spinner-row-two")).toBeAttached()
  await expect(page).toHaveURL(/\/listpages-spinner\/p\/2$/u)
  await expect(page.locator(".pager .current")).toHaveText("2")
  await expect(page.locator(".list-pages-spinner")).toHaveCount(0)
  await expect(box).not.toHaveAttribute("aria-busy", "true")
  await expect(page.locator(".list-pages-status")).toHaveText("Page loaded.")

  await page.unroute("**/listpages-spinner/p/2")
  await Promise.all([page.waitForURL(/\/listpages-spinner$/u), page.goBack()])
  await expect(page.locator("#listpages-spinner-row-one")).toBeAttached()
})
