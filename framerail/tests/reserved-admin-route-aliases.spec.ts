import { expect, test } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}
test("anonymous canonical and alternate admin routes share the denied response", async ({
  page
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)

  const canonical = await page.goto("/_admin")
  expect(canonical?.status()).toBe(401)
  const canonicalBody = await page.locator("body").innerText()
  expect(canonicalBody).not.toContain("Admin Panel")
  expect(canonicalBody).not.toContain("[[module Redirect")

  for (const path of [
    "/_admin/norender/true",
    "/_admin?norender=true",
    "/printer--friendly//_admin"
  ]) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(canonical?.status())
    expect(new URL(page.url()).pathname, path).toBe("/_admin")

    const body = await page.locator("body").innerText()
    expect(body, path).toBe(canonicalBody)
    expect(body, path).not.toContain("Admin Panel")
    expect(body, path).not.toContain("[[module Redirect")
  }

  const fixturePort = process.env.PLAYWRIGHT_FIXTURE_PORT
  expect(fixturePort).toBeTruthy()
  const articleReads = await page.request.get(
    `http://127.0.0.1:${fixturePort}/last-article-read-requests`
  )
  expect(articleReads.ok()).toBe(true)
  expect((await articleReads.json()).articleView).toEqual([])
})

test("authorized admin retains the canonical route after both aliases", async ({
  page
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  const appPort = process.env.PLAYWRIGHT_APP_PORT
  expect(appPort).toBeTruthy()
  await page.context().addCookies([
    {
      name: "wikijump_token",
      value: "fixture-session-token",
      url: `http://localhost:${appPort}/`
    }
  ])

  for (const path of ["/_admin/norender/true", "/printer--friendly//_admin"]) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(200)
    expect(new URL(page.url()).pathname, path).toBe("/_admin")
    await expect(page.locator("#sm-general-name"), path).toBeVisible()
  }
})
