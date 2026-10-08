import { expect, test } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

test("login fields keep persistent localized labels and autofill hints", async ({
  page
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  const loginResponse = await page.goto("/-/login")

  expect(loginResponse?.status()).toBe(200)
  const username = page.locator("#login-name-or-email")
  const password = page.locator("#login-password")
  await expect(username).toHaveAccessibleName("Email or Username")
  await expect(password).toHaveAccessibleName("Password")
  await expect(username).toHaveAttribute("autocomplete", "username")
  await expect(password).toHaveAttribute("autocomplete", "current-password")

  await username.fill("fixture-member")
  await password.fill("fixture-member-password")
  await expect(username).toHaveAccessibleName("Email or Username")
  await expect(password).toHaveAccessibleName("Password")
})

test("registration password labels are distinct and validation errors are associated", async ({
  page
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  const response = await page.goto("/-/register")

  expect(response?.status()).toBe(200)
  const password = page.locator("#password")
  const confirmation = page.locator("#confirm-password")
  await expect(password).toHaveAccessibleName("Password")
  await expect(confirmation).toHaveAccessibleName("Confirm Password")
  await expect(password).toHaveAttribute("autocomplete", "new-password")
  await expect(confirmation).toHaveAttribute("autocomplete", "new-password")

  await page.locator('label[for="password"]').click()
  await expect(password).toBeFocused()
  await page.locator('label[for="confirm-password"]').click()
  await expect(confirmation).toBeFocused()
})
