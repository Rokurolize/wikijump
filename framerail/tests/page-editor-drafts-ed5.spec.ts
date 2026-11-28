import { expect, test } from "./hermetic-playwright"

import type { APIRequestContext, Page } from "./hermetic-playwright"

test.setTimeout(120_000)

const AUTHENTICATED_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki",
  cookie: "wikijump_token=fixture-session-token"
}
const FIXTURE_URL = `http://127.0.0.1:${process.env.PLAYWRIGHT_FIXTURE_PORT ?? "42747"}`
const SLUG = "editor-codemirror-probe"
const EDITOR_PATH = `/${SLUG}/edit`

const fixtureDraft = async (request: APIRequestContext, slug = SLUG) =>
  request
    .get(`${FIXTURE_URL}/fixture-page-draft?slug=${encodeURIComponent(slug)}`)
    .then((response) => response.json())

const openEditor = async (page: Page, path = EDITOR_PATH) => {
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto(path)
  await expect(page.locator(".wikitext-editor .cm-content")).toBeVisible({
    timeout: 30_000
  })
}

const typeEditorText = async (page: Page, text: string) => {
  await page.locator(".wikitext-editor .cm-content").click()
  await page.keyboard.press("Control+A")
  await page.keyboard.type(text)
}

const listDrafts = async (request: APIRequestContext) =>
  request
    .post(`${FIXTURE_URL}/jsonrpc`, {
      headers: {
        "content-type": "application/json",
        "x-deepwell-session-token": "fixture-session-token",
        "x-deepwell-site-id": "6000005"
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "site_tools_list_drafts",
        params: { site_id: 6000005 }
      }
    })
    .then((response) => response.json())
    .then((body) => body.result as { slug: string; title: string }[])

const expectDraftSynced = async (
  request: APIRequestContext,
  expected: { title?: string; wikitext: string; comments?: string },
  slug = SLUG
) => {
  await expect
    .poll(async () => fixtureDraft(request, slug), { timeout: 10_000 })
    .toEqual(expect.objectContaining(expected))
}

test.beforeEach(async ({ request }) => {
  await request.post(`${FIXTURE_URL}/clear-page-edit-locks`)
  await request.post(`${FIXTURE_URL}/clear-page-drafts`)
  await request.post(`${FIXTURE_URL}/reset-fixture-page?slug=${SLUG}`)
  await request.get(`${FIXTURE_URL}/last-page-write-requests`)
})

test.afterEach(async ({ request }) => {
  await request.post(`${FIXTURE_URL}/clear-page-edit-locks`)
  await request.post(`${FIXTURE_URL}/clear-page-drafts`)
  await request.post(`${FIXTURE_URL}/reset-fixture-page?slug=${SLUG}`)
})

test("a crash-time draft is offered on reopen and restore fills source title and comments", async ({
  page,
  context,
  request
}) => {
  await openEditor(page)
  const typed = "Recovered draft **source**"
  await page.locator("input[name='title']").fill("Recovered draft title")
  await typeEditorText(page, typed)
  await page.locator("textarea[name='comments']").fill("recovered revision note")
  await expectDraftSynced(request, {
    title: "Recovered draft title",
    wikitext: typed,
    comments: "recovered revision note"
  })

  await page.close()
  await request.post(`${FIXTURE_URL}/clear-page-edit-locks`)
  const reopened = await context.newPage()
  await openEditor(reopened)
  await expect(reopened.getByText("A saved draft is available")).toBeVisible()
  await expect(reopened.locator("textarea[name='wikitext']")).not.toHaveValue(typed)
  await reopened.getByRole("button", { name: "Restore draft" }).click()
  await expect(reopened.locator("input[name='title']")).toHaveValue(
    "Recovered draft title"
  )
  await expect(reopened.locator("textarea[name='wikitext']")).toHaveValue(typed)
  await expect(reopened.locator("textarea[name='comments']")).toHaveValue(
    "recovered revision note"
  )
  await reopened.close()
})

test("discard removes the draft explicitly and preserves the current page text", async ({
  page,
  request
}) => {
  await request.post(
    `${FIXTURE_URL}/seed-page-draft?${new URLSearchParams({
      slug: SLUG,
      title: "Discard me",
      wikitext: "discarded source",
      comments: "discard note"
    })}`
  )
  await openEditor(page)
  await expect(page.getByText("A saved draft is available")).toBeVisible()
  await page.getByRole("button", { name: "Discard draft" }).click()
  await expect(page.getByText("A saved draft is available")).toHaveCount(0)
  expect(await fixtureDraft(request)).toBeNull()
  await expect(page.locator("textarea[name='wikitext']")).toHaveValue(
    /Editor fixture heading/
  )
})

test("a successful full-page save supersedes and removes the synchronized draft", async ({
  page,
  request
}) => {
  await openEditor(page)
  const typed = "Saved source replacing the draft"
  await typeEditorText(page, typed)
  await page.locator("textarea[name='comments']").fill("save cleanup probe")
  await expectDraftSynced(request, { wikitext: typed, comments: "save cleanup probe" })

  await page
    .locator("#editor")
    .locator("button[type='submit'], input[type='submit']")
    .click()
  await expect(page).toHaveURL(new RegExp(`/${SLUG}$`, "u"))
  await expect.poll(async () => fixtureDraft(request)).toBeNull()
  const writes = await request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())
  expect(writes.pageDraftRemove.length).toBeGreaterThan(0)
  expect(await listDrafts(request)).toEqual([])
  await page.goto(EDITOR_PATH)
  await expect(page.locator(".wikitext-editor .cm-content")).toBeVisible({
    timeout: 30_000
  })
  await expect(page.getByText("A saved draft is available")).toHaveCount(0)
})

test("a conflicting edit lock blocks draft synchronization and restore without overwriting the draft", async ({
  page,
  request
}) => {
  await request.post(
    `${FIXTURE_URL}/seed-page-draft?${new URLSearchParams({
      slug: SLUG,
      title: "Protected draft",
      wikitext: "protected source",
      comments: "protected note"
    })}`
  )
  await request.post(`${FIXTURE_URL}/hold-page-edit-lock?slug=${SLUG}&user_id=456`)
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto(EDITOR_PATH)

  await expect(page.getByText("This page is being edited by another user.")).toBeVisible()
  await expect(page.getByText("A saved draft is available")).toHaveCount(0)
  expect(await fixtureDraft(request)).toEqual(
    expect.objectContaining({
      title: "Protected draft",
      wikitext: "protected source",
      comments: "protected note"
    })
  )
  const writes = await request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())
  expect(writes.pageDraftSave).toEqual([])
})

test("a stale-page save is rejected and the user's draft remains available", async ({
  page,
  request
}) => {
  await openEditor(page)
  const typed = "Stale editor draft source"
  await typeEditorText(page, typed)
  await expectDraftSynced(request, { wikitext: typed })

  await request.post(
    `${FIXTURE_URL}/save-fixture-page?${new URLSearchParams({
      slug: SLUG,
      wikitext: "Externally saved source"
    })}`
  )
  await page
    .locator("#editor")
    .locator("button[type='submit'], input[type='submit']")
    .click()
  await expect(page.getByText("The page has changed")).toBeVisible()
  expect(
    await request
      .get(`${FIXTURE_URL}/fixture-page-source?slug=${SLUG}`)
      .then((response) => response.json())
  ).toEqual({ wikitext: "Externally saved source" })
  expect(await fixtureDraft(request)).toEqual(
    expect.objectContaining({ wikitext: typed })
  )
})

test("a new page draft synchronizes without an edit lease and is offered on reopen", async ({
  page,
  context,
  request
}) => {
  const slug = "editor-live-preview-create-probe"
  await request.post(`${FIXTURE_URL}/reset-fixture-page?slug=${slug}`)
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  const response = await page.goto(`/${slug}/edit/true`)
  expect(response?.status()).toBe(404)
  await expect(page.locator(".wikitext-editor .cm-content")).toBeVisible({
    timeout: 30_000
  })
  const typed = "New page draft source"
  await typeEditorText(page, typed)
  await page.locator("textarea[name='comments']").fill("new page note")
  await expectDraftSynced(request, { wikitext: typed, comments: "new page note" }, slug)

  await page.close()
  const reopened = await context.newPage()
  await reopened.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await reopened.goto(`/${slug}/edit/true`)
  await expect(reopened.getByText("A saved draft is available")).toBeVisible()
  await reopened.getByRole("button", { name: "Restore draft" }).click()
  await expect(reopened.locator("textarea[name='wikitext']")).toHaveValue(typed)
  await expect(reopened.locator("textarea[name='comments']")).toHaveValue("new page note")
  await reopened.close()
})
