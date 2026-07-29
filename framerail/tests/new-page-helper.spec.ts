import { expect, test } from "@playwright/test"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

const AUTHENTICATED_HEADERS = {
  ...SITE_HEADERS,
  cookie: "wikijump_token=fixture-session-token"
}

const FIXTURE_URL = `http://127.0.0.1:${process.env.PLAYWRIGHT_FIXTURE_PORT ?? "42747"}`
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

test("NewPage default submit posts Wikidot helper action and navigates to edit URL", async ({
  page
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.goto("/newpage-helper")
  await page.evaluate(() => {
    document.cookie = "wikijump_token=fixture-session-token; path=/"
    document.cookie = "wikidot_token7=fixture-wikidot-token7; path=/"
  })

  const submittedName =
    "run-owned:newpage-helper-default-name-that-is-intentionally-longer-than-sixty"
  const expectedSlug = submittedName.slice(0, 60)

  const ajaxRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/ajax-module-connector.php")
  )
  await page.locator("#default-newpage input[name='pageName']").fill(submittedName)
  await page.locator("#default-newpage input[type='submit']").click()
  const ajaxFields = new URLSearchParams((await ajaxRequestPromise).postData() ?? "")

  await expect(page).toHaveURL(
    new RegExp(
      `/${escapeRegExp(expectedSlug)}/edit/true/title/${escapeRegExp(encodeURIComponent(submittedName))}$`,
      "u"
    )
  )
  await expect(page.locator(".page-create-header")).toBeVisible()
  await expect(page.locator("input[name='title']")).toHaveValue("")
  expect(Object.fromEntries(ajaxFields)).toEqual(
    expect.objectContaining({
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      pageName: submittedName,
      wikidot_token7: "fixture-wikidot-token7"
    })
  )
})

test("NewPage save-and-go creates an empty page and navigates to it", async ({
  page,
  request
}) => {
  await request.get(`${FIXTURE_URL}/last-page-write-requests`)
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto("/newpage-helper")

  const submittedName = `run-owned:newpage-autosave-${Date.now()}`
  await page.locator("#autosave-newpage input[name='pageName']").fill(submittedName)
  await page.locator("#autosave-newpage input[type='submit']").click()

  await expect(page).toHaveURL(new RegExp(`/${submittedName}$`, "u"))
  await expect(page.locator("#page-title")).toHaveText(submittedName)

  const writeRequests = await request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())
  expect(writeRequests.pageCreate).toContainEqual(
    expect.objectContaining({
      headers: {
        page: "newpage-helper",
        sessionToken: "fixture-session-token",
        siteId: "6000005"
      },
      params: expect.objectContaining({
        slug: submittedName,
        title: submittedName,
        wikitext: "",
        tags: ["alpha", "beta"],
        user_id: 123
      })
    })
  )
  expect(writeRequests.parentUpdate).toContainEqual(
    expect.objectContaining({
      headers: {
        page: submittedName,
        sessionToken: "fixture-session-token",
        siteId: "6000005"
      },
      params: expect.objectContaining({
        add: ["main"],
        user_id: 123
      })
    })
  )
})
