import { expect, test } from "@playwright/test"

const headers = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

test("Wikidot header extension hooks exist at the initial no-script paint", async ({
  browser
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders: headers,
    javaScriptEnabled: false
  })
  const page = await context.newPage()
  try {
    await page.goto(
      `http://localhost:${process.env.PLAYWRIGHT_APP_PORT ?? "4173"}/wikidot-tabview`,
      { waitUntil: "domcontentloaded" }
    )
    await expect
      .poll(() =>
        page
          .locator("#header")
          .evaluate((header) =>
            [...header.children]
              .map((child) => child.id)
              .filter((id) => id.startsWith("header-extra-div-"))
          )
      )
      .toEqual(["header-extra-div-1", "header-extra-div-2", "header-extra-div-3"])
    await expect(page.locator("#header > [id^='header-extra-div-'] > span")).toHaveCount(
      3
    )
  } finally {
    await context.close()
  }
})

test("Wikidot-compatible search chrome preserves its two inputs and focus behavior", async ({
  page
}) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  await page.setExtraHTTPHeaders(headers)

  await page.goto("/wikidot-tabview")

  const searchBox = page.locator("#search-top-box")
  const form = page.locator("#search-top-box-form")
  const query = form.locator('input[type="text"]')
  const submit = form.locator('input[type="submit"]')
  // Retained live DOM evidence: install/local/wikidot-verification/artifacts/
  // listpages-campaign-live-fixtures.json, case lp-live-parent-selectors,
  // raw_page_html_sha256 246ac8385251557163536aef081026d3751425c13e85d49e74ff56b527354290.
  await expect(searchBox).toHaveClass("form-search")
  await expect(form).toHaveCount(1)
  await expect(form).toHaveClass("input-append")
  await expect(query).toHaveValue("Search this site")
  await expect(query).toHaveClass("text empty search-query")
  await expect(submit).toHaveValue("Search")
  await expect(submit).toHaveClass("button btn")

  // Sigma intentionally hides the text field, so exercise the listener without
  // requiring an element that the imported theme makes non-focusable.
  await query.dispatchEvent("focus")
  expect(pageErrors).toEqual([])
  await expect(query).toHaveValue("")
  await expect(query).toHaveClass("text search-query")

  await query.evaluate((input: HTMLInputElement) => {
    input.value = "codex search probe"
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await expect(query).toHaveValue("codex search probe")
  await form.locator('input[type="submit"]').click({ force: true })
  await expect(page).toHaveURL(/\/search:site\/q\/codex%20search%20probe$/u)
  await expect(page.locator("#page-content")).toContainText(
    "Search is temporarily unavailable, we are working to bring it online!"
  )
})

test("SearchAll module submits the selected live area route", async ({ page }) => {
  await page.setExtraHTTPHeaders(headers)

  await page.goto("/search:all")

  const form = page.locator("#search-form-all")
  await expect(form).toHaveCount(1)
  await expect(form.locator('input[name="area"]:checked')).toHaveValue("pf")
  await form.locator("#search-form-all-input").fill("  a/b? c  ")
  await form.locator("#search-all-f").check()
  await form.locator('input[type="submit"]').click()

  await expect(page).toHaveURL(/\/search:all\/a\/f\/q\/%20%20a%2Fb%3F%20c%20%20$/u)
})
