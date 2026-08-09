import { expect, test } from "@playwright/test"

test("Wikidot-compatible search chrome preserves its two inputs and focus behavior", async ({
  page
}) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  await page.setExtraHTTPHeaders({
    "X-Wikijump-Site-Id": "6000005",
    "X-Wikijump-Site-Slug": "scp-wiki"
  })

  await page.goto("/wikidot-tabview")

  const form = page.locator("#search-top-box-form")
  const query = form.locator('input[type="text"]')
  const submit = form.locator('input[type="submit"]')
  await expect(form).toHaveCount(1)
  await expect(query).toHaveValue("Search this site")
  await expect(query).toHaveClass(/\bempty\b/u)
  await expect(submit).toHaveValue("Search")

  // Sigma intentionally hides the text field, so exercise the listener without
  // requiring an element that the imported theme makes non-focusable.
  await query.dispatchEvent("focus")
  expect(pageErrors).toEqual([])
  await expect(query).toHaveValue("")
  await expect(query).not.toHaveClass(/\bempty\b/u)

  await query.fill("codex search probe")
  await form.locator('input[type="submit"]').click({ force: true })
  await expect(page).toHaveURL(/\/search:site\/q\/codex%20search%20probe$/u)
})

test("SearchAll module submits the selected live area route", async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "X-Wikijump-Site-Id": "6000005",
    "X-Wikijump-Site-Slug": "scp-wiki"
  })

  await page.goto("/search:all")

  const form = page.locator("#search-form-all")
  await expect(form).toHaveCount(1)
  await expect(form.locator('input[name="area"]:checked')).toHaveValue("pf")
  await form.locator("#search-form-all-input").fill("  a/b? c  ")
  await form.locator("#search-all-f").check()
  await form.locator('input[type="submit"]').click()

  await expect(page).toHaveURL(/\/search:all\/a\/f\/q\/%20%20a%2Fb%3F%20c%20%20$/u)
})
