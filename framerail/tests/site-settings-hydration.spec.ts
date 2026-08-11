import { expect, test } from "@playwright/test"

const AUTHENTICATED_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki",
  cookie: "wikijump_token=fixture-session-token"
}
const STALE_MESSAGE = "Site settings changed since this form was loaded"
const INITIAL_GENERAL_SETTINGS = {
  appendedInput: "scp-wiki",
  "sm-general-name": "SCP Foundation",
  "sm-general-subtitle": "Secure, Contain, Protect",
  "sm-general-language": "en",
  "site-description-field": "Fixture site",
  "sm-general-start": "main",
  "sm-general-welcome": "main"
}
const STALE_FAILURE = JSON.stringify({
  type: "failure",
  status: 500,
  data: JSON.stringify([
    { message: 1, code: 2, data: 3 },
    STALE_MESSAGE,
    4000,
    { current_settings_revision: 5 }
  ])
})

test("site settings hydrate without a reactive update loop", async ({ page }) => {
  const pageErrors: string[] = []
  const staleActions: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.addInitScript(() => {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        const controlIds = [
          "appendedInput",
          "sm-general-name",
          "sm-general-subtitle",
          "sm-general-language",
          "site-description-field",
          "sm-general-start",
          "sm-general-welcome"
        ]
        const values = Object.fromEntries(
          controlIds.map((id) => {
            const control = document.getElementById(id) as
              HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
            return [id, control?.value ?? null]
          })
        )
        document.documentElement.dataset.initialGeneralSettings = JSON.stringify(values)
      },
      { once: true }
    )
  })
  await page.route(/\/_admin\?\/(analytics|site)$/u, async (route) => {
    staleActions.push(new URL(route.request().url()).search.slice(2))
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: STALE_FAILURE
    })
  })

  const response = await page.goto("/_admin")
  expect(response?.status()).toBe(200)
  const initialGeneralSettings = await page.evaluate(() =>
    JSON.parse(document.documentElement.dataset.initialGeneralSettings ?? "null")
  )
  expect(initialGeneralSettings).toEqual(INITIAL_GENERAL_SETTINGS)
  await expect(page.locator("#sm-ganalytics-form")).toBeVisible()
  await expect(page.locator("#sm-appearance-cats")).toHaveValue("100")
  await expect(page.locator("#sm-autonumerate-add-catname1")).toHaveValue("100")

  const dialog = page.locator("#odialog-container")
  await page.locator("#sm-ganalytics-save").click()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator("#modal-title")).toHaveText(STALE_MESSAGE)
  await dialog.locator(".button-close-message").click()
  await expect(dialog).toHaveCount(0)

  await page.locator("#sm-general-save").click()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator("#modal-title")).toHaveText(STALE_MESSAGE)
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  )

  expect(staleActions).toEqual(["analytics", "site"])
  expect(pageErrors).toEqual([])
})
