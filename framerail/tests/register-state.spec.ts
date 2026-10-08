import {
  expect,
  installNativeEventListenerProbe,
  test,
  waitForNativeEventListener
} from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}
const APP_URL = `http://localhost:${process.env.PLAYWRIGHT_APP_PORT ?? "4173"}`
const FIXTURE_URL = `http://127.0.0.1:${process.env.PLAYWRIGHT_FIXTURE_PORT ?? "42747"}`

async function userCreateRequests(request: import("@playwright/test").APIRequestContext) {
  const response = await request.get(`${FIXTURE_URL}/last-user-create-requests`)
  expect(response.ok()).toBeTruthy()
  return response.json()
}

test("registration confirmation is only shown after one successful create", async ({
  page,
  request
}) => {
  await installNativeEventListenerProbe(page)
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.goto(`${APP_URL}/-/register`)
  await expect(page.locator("#register")).toBeVisible()
  await expect(page.getByRole("status")).toHaveCount(0)

  await page.locator("#username").fill("fixture-registration")
  await page.locator("#register .email").fill("fixture-registration@example.invalid")
  await page.locator("#register .auth-password").fill("Good-fixture-password-2026")
  await page.locator(".confirm-password").fill("Good-fixture-password-2026")
  await page.locator("#locale").selectOption(["en"])
  await waitForNativeEventListener(page, "#register", "submit")
  await page.locator("#register button[type=submit]").click()

  const success = page.getByRole("status")
  await expect(success).toContainText("register.toast")
  await expect(success.getByRole("link", { name: "login" })).toHaveAttribute(
    "href",
    "/-/login"
  )
  expect(await userCreateRequests(request)).toEqual([
    {
      user_type: "regular",
      name: "fixture-registration",
      email: "fixture-registration@example.invalid",
      locales: ["en"],
      hasPassword: true,
      ip_address: "127.0.0.1",
      bypass_filter: false,
      bypass_email_verification: false
    }
  ])

  await page.reload()
  await expect(page.locator("#register")).toBeVisible()
  await expect(page.getByRole("status")).toHaveCount(0)
  await page.goto(`${APP_URL}/`)
  await page.goBack()
  await page.goForward()
  expect(await userCreateRequests(request)).toEqual([])

  await page.goto(`${APP_URL}/-/register`)
  await page.locator("#username").fill("fixture-registration-failure")
  await page.locator("#register .email").fill("failure@example.invalid")
  await page.locator("#register .auth-password").fill("Good-fixture-password-2026")
  await page.locator(".confirm-password").fill("Good-fixture-password-2026")
  await page.locator("#locale").selectOption(["en"])
  await waitForNativeEventListener(page, "#register", "submit")
  await page.locator("#register button[type=submit]").click()
  await expect(page.locator("#modal-message")).toHaveText("Fixture registration rejected")
  await expect(page.getByRole("status")).toHaveCount(0)
  expect(await userCreateRequests(request)).toEqual([
    {
      user_type: "regular",
      name: "fixture-registration-failure",
      email: "failure@example.invalid",
      locales: ["en"],
      hasPassword: true,
      ip_address: "127.0.0.1",
      bypass_filter: false,
      bypass_email_verification: false
    }
  ])
})

test("an authenticated visitor is redirected without a registration confirmation", async ({
  page
}) => {
  await installNativeEventListenerProbe(page)
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.goto(`${APP_URL}/-/login`)
  await waitForNativeEventListener(page, "#login", "submit")
  await page.locator(".auth-name-or-email").fill("fixture-member")
  await page.locator(".auth-password").fill("fixture-member-password")
  await page.locator("#login button[type=submit]").click()
  await expect(page.getByText("login.toast")).toBeVisible()

  const response = await page.goto(`${APP_URL}/-/register`)
  expect(response?.status()).toBe(200)
  await expect(page).toHaveURL(`${APP_URL}/`)
  await expect(page.getByRole("status")).toHaveCount(0)
})

test("registration validation errors stay inline and never open an empty dialog", async ({
  page,
  request
}) => {
  await installNativeEventListenerProbe(page)
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.goto(`${APP_URL}/-/register`)
  await expect(page.locator("#register")).toBeVisible()

  await page.locator("#username").fill("fixture-short-password")
  await page.locator("#register .email").fill("short@example.invalid")
  await page.locator("#register .auth-password").fill("too-short")
  await page.locator(".confirm-password").fill("too-short")
  await page.locator("#locale").selectOption(["en"])
  await waitForNativeEventListener(page, "#register", "submit")
  await page.locator("#register button[type=submit]").click()

  await expect(
    page
      .locator("#register .auth-password")
      .locator("xpath=following-sibling::p[contains(@class, 'error')]")
  ).toContainText("error-form.password-too-short")
  await expect(page.locator("#modal-message")).toHaveCount(0)
  expect(
    (await userCreateRequests(request)).some(
      (create: { name: string }) => create.name === "fixture-short-password"
    )
  ).toBe(false)

  await page.locator("#register .auth-password").fill("Good-fixture-password-2026")
  await page.locator(".confirm-password").fill("Good-fixture-password-2027")
  await waitForNativeEventListener(page, "#register", "submit")
  await page.locator("#register button[type=submit]").click()

  await expect(
    page
      .locator(".confirm-password")
      .locator("xpath=following-sibling::p[contains(@class, 'error')]")
  ).toContainText("error-form.password-mismatch")
  await expect(page.locator("#modal-message")).toHaveCount(0)
})
