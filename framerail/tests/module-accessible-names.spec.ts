import { expect, test } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

test("NewPage page-name inputs keep accessible names in SSR and hydrated DOM", async ({
  page
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  const response = await page.goto("/newpage-helper")

  expect(response?.status()).toBe(200)
  const ssr = await response?.text()
  expect(ssr?.match(/aria-label="Name of the new page"/gu)).toHaveLength(3)

  const inputs = page.locator('input[name="pageName"]')
  await expect(inputs).toHaveCount(3)
  await expect(page.getByRole("textbox", { name: "Name of the new page" })).toHaveCount(3)
  expect(
    await inputs.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label"))
    )
  ).toEqual(Array(3).fill("Name of the new page"))
  await expect(page.locator("#default-newpage input[type=submit]")).toHaveValue(
    "Default create"
  )
})

test("SearchAll query input has a distinct accessible name and keeps radio labels", async ({
  page
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  const response = await page.goto("/search:all")

  expect(response?.status()).toBe(200)
  expect((await response?.text()) ?? "").toContain('aria-label="Search all Wikis"')

  const query = page.locator("#search-form-all-input")
  await expect(page.getByRole("textbox", { name: "Search all Wikis" })).toHaveCount(1)
  await expect(query).toHaveAttribute("aria-label", "Search all Wikis")
  await expect(page.getByRole("radio", { name: "pages and forums" })).toBeChecked()
  await expect(page.getByRole("radio", { name: "pages only" })).toBeAttached()
  await expect(page.getByRole("radio", { name: "forums only" })).toBeAttached()
})
