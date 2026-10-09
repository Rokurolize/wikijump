import { expect, test, waitForSvelteDelegatedHandler } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}
const APP_URL = `http://localhost:${process.env.PLAYWRIGHT_APP_PORT ?? "4173"}`

test("login and registration Cancel leave safely without submitting or retaining passwords", async ({
  page
}) => {
  const postRequests: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST") postRequests.push(request.url())
  })
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.context().addCookies([
    {
      name: "wikijump_token",
      value: "fixture-session-token",
      url: APP_URL
    }
  ])

  const wikiResponse = await page.goto(`${APP_URL}/theme:yossistyle`)
  expect(wikiResponse?.status()).toBe(200)
  await expect(page.locator("#page-content")).toBeVisible()
  await page.goto(`${APP_URL}/-/login?returnUrl=https://attacker.example/collect`)
  await waitForSvelteDelegatedHandler(page, ".button-cancel")
  await page.locator(".auth-name-or-email").fill("dummy-account")
  await page.locator(".auth-password").fill("dummy-password")
  const loginCancel = page.getByRole("button", { name: "Cancel" })
  await loginCancel.focus()
  await loginCancel.press("Enter")
  await expect(page).toHaveURL(`${APP_URL}/`)
  expect(new URL(page.url()).search).toBe("")
  await page.goBack()
  expect(page.url()).not.toContain("/-/login")
  await page.goForward()
  expect(page.url()).not.toContain("/-/login")

  await page.goto(`${APP_URL}/`)
  await page.goto(`${APP_URL}/-/register?returnUrl=https://attacker.example/collect`)
  await waitForSvelteDelegatedHandler(page, ".button-cancel")
  await page.locator("#username").fill("dummy-registration")
  await page.locator("#register .email").fill("dummy@example.invalid")
  await page.locator("#register .auth-password").fill("dummy-password")
  await page.locator(".confirm-password").fill("dummy-password")
  await page.locator("#locale").selectOption(["en"])
  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(page).toHaveURL(`${APP_URL}/`)
  expect(new URL(page.url()).search).toBe("")
  await page.goBack()
  expect(page.url()).not.toContain("/-/register")
  await page.goForward()
  expect(page.url()).not.toContain("/-/register")

  expect(postRequests).toEqual([])
})
