import { expect, test } from "@playwright/test"

const FIXTURE_URL = `http://127.0.0.1:${process.env.PLAYWRIGHT_FIXTURE_PORT ?? "42747"}`
const AUTHENTICATED_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki",
  cookie: "wikijump_token=fixture-session-token"
}

test("data-form create flow renders controls and stores Wikidot source", async ({
  page,
  request
}) => {
  await request.get(`${FIXTURE_URL}/last-page-write-requests`)
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  const missingResponse = await page.goto("/data-form-create-flow:example")
  expect(missingResponse?.status()).toBe(404)
  await expect(page.locator("[id='404-message']")).toContainText(
    "data-form-create-flow:example"
  )
  await expect(page.locator("#create-it-now-link")).toHaveText("Create page")
  await page.locator("#create-it-now-link a").click()
  await expect(page).toHaveURL(/data-form-create-flow:example\/edit\/true$/u)

  await expect(page.locator("#action-area h1")).toHaveText("Create Data-form-create-flow")
  await expect(page.locator("textarea.debug")).toHaveCount(0)
  await expect(page.locator("#page-content")).toHaveCount(0)
  await expect(page.getByText("UNTRANSLATED:Page not found")).toHaveCount(0)
  await expect(page.locator("#edit-page-form")).toHaveClass(/(?:^|\s)data-form(?:\s|$)/u)
  await expect(page.locator("input[name='form-use']")).toHaveValue("true")
  await expect(page.locator("input[name='form-fields']")).toHaveValue("name,choice")
  await expect(page.locator("#edit-page-title")).toHaveValue("Example")
  await expect(page.locator("input[name='field-name']")).toHaveValue("")
  await expect(page.locator("input[name='field-choice'][value='b']")).toBeChecked()

  await page.locator("input[name='field-name']").press("Enter")
  const writesAfterEnter = await request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())
  expect(
    writesAfterEnter.pageCreate.find(
      (entry: { params: { slug?: string } }) =>
        entry.params.slug === "data-form-create-flow:example"
    )
  ).toBeUndefined()

  await page.locator("input[name='field-name']").fill("Probe Name")
  await page.locator("input[name='field-choice'][value='a']").check()
  await page.locator("#edit-save-button").click()

  await expect
    .poll(async () => {
      const writes = await request
        .get(`${FIXTURE_URL}/last-page-write-requests`)
        .then((response) => response.json())
      return writes.pageCreate.find(
        (entry: { params: { slug?: string } }) =>
          entry.params.slug === "data-form-create-flow:example"
      )
    })
    .toMatchObject({
      params: {
        slug: "data-form-create-flow:example",
        title: "Example",
        wikitext: "name: 'Probe Name'\nchoice: a",
        tags: []
      }
    })
})

test("data-form edit flow restores and updates saved field values", async ({
  page,
  request
}) => {
  await request.get(`${FIXTURE_URL}/last-page-write-requests`)
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto("/data-form-edit-flow:example/edit")

  await expect(page.locator("#action-area h1")).toHaveText("Edit Data-form-edit-flow")
  await expect(page.locator("#page-content")).toBeHidden()
  await expect(page.locator("input[name='field-name']")).toHaveValue("Probe Name")
  await expect(page.locator("input[name='field-choice'][value='a']")).toBeChecked()

  await page.locator("input[name='field-name']").fill("Updated Name")
  await page.locator("input[name='field-choice'][value='b']").check()
  await page.locator("#edit-save-button").click()

  await expect
    .poll(async () => {
      const writes = await request
        .get(`${FIXTURE_URL}/last-page-write-requests`)
        .then((response) => response.json())
      return writes.pageEdit.find(
        (entry: { params: { page?: number } }) => entry.params.page === 3000420
      )
    })
    .toMatchObject({
      params: {
        page: 3000420,
        last_revision_id: 9000420,
        title: "Example",
        wikitext: "name: 'Updated Name'\nchoice: b",
        tags: []
      }
    })
})

test("data-form create rejects NewPage tags without creating a page", async ({
  page,
  request
}) => {
  await request.get(`${FIXTURE_URL}/last-page-write-requests`)
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto("/data-form-create-flow:example/edit/true/tags/rock%20live")

  await page.locator("input[name='field-name']").fill("Tagged Value")
  await page.locator("input[name='field-choice'][value='a']").check()
  await page.locator("#edit-save-button").click()

  await expect(
    page.getByText("An error occurred while processing the request.")
  ).toBeVisible()
  await expect(page.locator("#edit-page-form")).toBeVisible()
  const writes = await request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())
  expect(
    writes.pageCreate.find(
      (entry: { params: { slug?: string } }) =>
        entry.params.slug === "data-form-create-flow:example"
    )
  ).toBeUndefined()
})

test("data-form create applies the NewPage parent after saving", async ({
  page,
  request
}) => {
  await request.get(`${FIXTURE_URL}/last-page-write-requests`)
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto(
    "/data-form-create-flow:example/edit/true/parentPage/data-form-create-flow%3Aparent"
  )

  await page.locator("input[name='field-name']").fill("Parent Value")
  await page.locator("input[name='field-choice'][value='a']").check()
  await page.locator("#edit-save-button").click()

  await expect
    .poll(async () => {
      const writes = await request
        .get(`${FIXTURE_URL}/last-page-write-requests`)
        .then((response) => response.json())
      return writes.parentUpdate.find(
        (entry: { params: { child?: string } }) =>
          entry.params.child === "data-form-create-flow:example"
      )
    })
    .toMatchObject({
      params: {
        child: "data-form-create-flow:example",
        add: ["data-form-create-flow:parent"],
        remove: []
      }
    })
})
