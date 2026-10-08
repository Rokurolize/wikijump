import { expect, test } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

const expected404Routes = [
  "/forum/bogus-e2e-20261008",
  "/forum/c-invalid/foobar",
  "/forum/t-invalid/foobar",
  "/forum/recent-posts"
]

test("route-owned 404s render safely on direct load, reload, and navigation", async ({
  page
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  for (const path of expected404Routes) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(404)
    await expect(page.locator("#route-error")).toHaveAttribute("data-status", "404")
    await expect(page).toHaveTitle("Not Found")
    await expect(page.locator("#route-error")).toContainText(
      "The requested resource could not be found."
    )
    await expect(page.locator("#editor, #page-restore, .debug")).toHaveCount(0)
    await expect(page.locator("body")).not.toContainText("Internal Error")
    await expect(page.locator("body")).not.toContainText("pageEditForm")

    const reloaded = await page.reload()
    expect(reloaded?.status(), `reload ${path}`).toBe(404)
    await expect(page.locator("#route-error")).toHaveAttribute("data-status", "404")
  }

  await page.goto("/main")
  await page.evaluate((path) => {
    const link = document.createElement("a")
    link.id = "route-error-navigation-probe"
    link.href = path
    link.textContent = "Open invalid forum route"
    document.body.append(link)
  }, expected404Routes[0])
  await page.locator("#route-error-navigation-probe").click()
  await expect(page).toHaveURL(new RegExp(`${expected404Routes[0]}$`, "u"))
  await expect(page.locator("#route-error")).toHaveAttribute("data-status", "404")
  await page.goBack()
  await expect(page).toHaveURL(/\/main$/u)
  await page.goForward()
  await expect(page.locator("#route-error")).toHaveAttribute("data-status", "404")
})
