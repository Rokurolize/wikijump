import { expect, test } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}
const APP_URL = `http://127.0.0.1:${process.env.PLAYWRIGHT_APP_PORT ?? "4173"}`
const FIXTURE_URL = `http://127.0.0.1:${process.env.PLAYWRIGHT_FIXTURE_PORT ?? "42747"}`

test("ForumStart suffixes preserve Wikidot hidden mode across routes and history", async ({
  page,
  request
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)

  const cases = [
    ["/forum/start", false],
    ["/forum/start/hidden/show", true],
    ["/forum/start/hidden/hide", true],
    ["/forum/start/hidden/false", true],
    ["/forum/start/hidden/show/extra", true],
    ["/forum/start/garbage", false],
    ["/forum/start/garbage/extra", false]
  ] as const

  for (const [path, hidden] of cases) {
    const response = await page.goto(`${APP_URL}${path}`)
    expect(response?.status(), path).toBe(200)
    if (hidden) {
      await expect(page.locator('[data-forum-mode="hidden"] h2')).toHaveText("Hidden")
      await expect(
        page.getByRole("heading", { name: "Per page discussions" })
      ).toBeVisible()
      await expect(page.getByRole("heading", { name: "Deleted threads" })).toBeVisible()
    } else {
      await expect(page.locator('[data-forum-mode="ordinary"] h2')).toHaveText(
        "Changelog"
      )
      await expect(page.locator('[data-forum-mode="hidden"]')).toHaveCount(0)
    }
  }

  await page.goto(`${APP_URL}/forum/start`)
  const showHidden = page.getByRole("link", { name: "Show hidden" })
  expect(await showHidden.getAttribute("href")).toBe("/forum/start/hidden/show")
  await page.goto(`${APP_URL}${await showHidden.getAttribute("href")}`)
  await expect(page).toHaveURL(/\/forum\/start\/hidden\/show$/u)
  await expect(page.locator('[data-forum-mode="hidden"]')).toBeVisible()
  await page.goBack()
  await expect(page.locator('[data-forum-mode="ordinary"]')).toBeVisible()
  await page.goForward()
  await expect(page.locator('[data-forum-mode="hidden"]')).toBeVisible()
  const reloaded = await page.reload()
  expect(reloaded?.status()).toBe(200)
  await expect(page.locator('[data-forum-mode="hidden"]')).toBeVisible()

  const forumRequests = await request
    .get(`${FIXTURE_URL}/last-forum-module-requests`)
    .then((response) => response.json())
  expect(forumRequests.length).toBeGreaterThanOrEqual(cases.length + 5)
  expect(
    forumRequests.every(
      (entry: {
        params: {
          site_id: number
          module_name: string
          parameters: Record<string, string>
        }
      }) =>
        entry.params.site_id === 6000005 &&
        entry.params.module_name === "forum/ForumStartModule" &&
        (JSON.stringify(entry.params.parameters) === "{}" ||
          JSON.stringify(entry.params.parameters) === '{"hidden":"true"}')
    )
  ).toBe(true)
  expect(
    forumRequests.some(
      (entry: { params: { parameters: Record<string, string> } }) =>
        entry.params.parameters.hidden === "true"
    )
  ).toBe(true)
})
