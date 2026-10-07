import { expect, test } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}
const FIXTURE_URL = `http://127.0.0.1:${process.env.PLAYWRIGHT_FIXTURE_PORT ?? "42747"}`

test("registration shows the advertised locales and Cancel returns to the same origin", async ({
  page
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  const response = await page.goto("/-/register")

  expect(response?.status()).toBe(200)
  await expect(page.locator("#locale option")).toHaveText([
    "English",
    "日本語",
    "한국어",
    "Polski",
    "Tiếng Việt",
    "简体中文"
  ])

  await page.getByRole("link", { name: "cancel" }).click()
  await expect(page).toHaveURL(/\/$/u)
  await expect(page.locator("#page-title")).toHaveText("Main")
})

test("login Cancel leaves the form without submitting entered credentials", async ({
  page,
  request
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await request.get(`${FIXTURE_URL}/last-page-write-requests`)
  await page.goto("/-/login")
  await page.locator("input[name=nameOrEmail]").fill("not-a-real-account")
  await page.locator("input[name=password]").fill("not-a-real-password")
  await page.getByRole("link", { name: "cancel" }).click()
  await expect(page).toHaveURL(/\/$/u)
  await expect(page.locator("#page-title")).toHaveText("Main")

  const requests = await request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())
  expect(requests.login).toHaveLength(0)
})

test("successful registration confirms once on login and persists Japanese preferences", async ({
  page,
  request
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.goto("/-/register")

  await page.locator("#username").fill("japanese-registration-fixture")
  await page.locator("#email").fill("japanese-registration-fixture@example.invalid")
  await page.locator("input[name=password]").fill("browser-test-password")
  await page.locator("input[name=confirmPassword]").fill("browser-test-password")
  await page.locator("#locale").selectOption("ja")
  await page.getByRole("button", { name: "create-account" }).click()

  await expect(page).toHaveURL(/\/-\/login$/u)
  await expect(page.getByText("register.toast")).toBeVisible()
  await expect(page.locator("#login")).toBeVisible()

  const registrations = await request
    .get(`${FIXTURE_URL}/registration-results`)
    .then((response) => response.json())
  expect(registrations).toEqual([{ user_id: 9000000, locales: ["ja"] }])

  await page.reload()
  await expect(page.getByText("register.toast")).toHaveCount(0)
  await expect(page.locator("#login")).toBeVisible()
})
