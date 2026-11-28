import { expect, test } from "./hermetic-playwright"

test.setTimeout(120_000)

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}
const AUTHENTICATED_HEADERS = {
  ...SITE_HEADERS,
  cookie: "wikijump_token=fixture-session-token"
}
const FIXTURE_URL = `http://127.0.0.1:${process.env.PLAYWRIGHT_FIXTURE_PORT ?? "42747"}`
const LIVE_SLUG = "editor-live-preview-probe"
const CREATE_SLUG = "editor-live-preview-create-probe"
const EDITOR_PATH = `/${LIVE_SLUG}/edit`
const PREVIEW_ROUTE = new RegExp(`/${LIVE_SLUG}/edit\\?/preview$`, "u")

const openEditor = async (
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext
) => {
  await request.post(`${FIXTURE_URL}/clear-page-edit-locks`)
  await request.post(`${FIXTURE_URL}/clear-page-drafts`)
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto(EDITOR_PATH)
  await expect(page.locator(".wikitext-editor .cm-content")).toBeVisible({
    timeout: 30_000
  })
}

const typeEditorText = async (page: import("@playwright/test").Page, text: string) => {
  await page.locator(".wikitext-editor .cm-content").click()
  await page.keyboard.press("Control+A")
  await page.keyboard.type(text)
}

const expectPreviewCurrent = async (page: import("@playwright/test").Page) => {
  await expect(page.locator("#edit-preview-status")).toHaveText(
    "Preview is up to date.",
    {
      timeout: 10_000
    }
  )
}

const drainPreviewRequests = async (
  request: import("@playwright/test").APIRequestContext
) =>
  request
    .get(`${FIXTURE_URL}/last-page-preview-requests`)
    .then((response) => response.json())

test.beforeEach(async ({ request }) => {
  await request.post(`${FIXTURE_URL}/clear-page-edit-locks`)
  await request.post(`${FIXTURE_URL}/clear-page-drafts`)
  for (const slug of [LIVE_SLUG, CREATE_SLUG]) {
    await request.post(
      `${FIXTURE_URL}/reset-fixture-page?slug=${encodeURIComponent(slug)}`
    )
  }
  await drainPreviewRequests(request)
})

test.afterEach(async ({ request }) => {
  await request.post(`${FIXTURE_URL}/clear-page-edit-locks`)
  await request.post(`${FIXTURE_URL}/clear-page-drafts`)
  for (const slug of [LIVE_SLUG, CREATE_SLUG]) {
    await request.post(
      `${FIXTURE_URL}/reset-fixture-page?slug=${encodeURIComponent(slug)}`
    )
  }
})

test("continuous server preview matches the saved render for an include-bearing edit", async ({
  page,
  request
}) => {
  const typedWikitext = [
    "+ Continuous preview heading",
    "",
    "[[include component:editor-codemirror-include]]",
    "",
    "Continuous **live** body."
  ].join("\n")
  await openEditor(page, request)
  await expectPreviewCurrent(page)

  await typeEditorText(page, typedWikitext)
  await expect(page.locator("#live-preview-body")).toContainText(
    "Included editor fixture text."
  )
  await expectPreviewCurrent(page)
  const previewHtml = await page.locator("#live-preview-body").innerHTML()

  const previewRequests = await drainPreviewRequests(request)
  expect(previewRequests.at(-1)).toEqual(
    expect.objectContaining({
      headers: expect.objectContaining({ page: LIVE_SLUG }),
      params: expect.objectContaining({
        site_id: 6000005,
        title: "Editor Live Preview Probe",
        wikitext: typedWikitext,
        syntax_only: false
      })
    })
  )

  await page
    .locator("#editor")
    .locator("button[type='submit'], input[type='submit']")
    .click()
  await expect(page).toHaveURL(new RegExp(`/${LIVE_SLUG}$`, "u"))
  await expect(page.locator("#page-content")).toContainText(
    "Included editor fixture text."
  )
  expect(await page.locator("#page-content").innerHTML()).toBe(previewHtml)
})

test("existing-page preview keeps saved-tag iftags semantics while tags are edited", async ({
  page,
  request
}) => {
  const tagProbe = [
    "[[iftags +live-preview-tag]]Saved positive tag visible[[/iftags]]",
    "",
    "[[iftags -live-preview-tag]]Unsaved negative tag visible[[/iftags]]"
  ].join("\n")
  await openEditor(page, request)
  await expectPreviewCurrent(page)
  await expect(page.locator("#live-preview-body")).toContainText("Saved tag visible")
  await expect(page.locator("#live-preview-body")).not.toContainText("Saved tag missing")

  await page.locator("input[name='tags']").fill("fixture")
  await typeEditorText(page, tagProbe)
  await expectPreviewCurrent(page)
  await expect(page.locator("#live-preview-body")).toContainText(
    "Saved positive tag visible"
  )
  await expect(page.locator("#live-preview-body")).not.toContainText(
    "Unsaved negative tag visible"
  )

  const previewRequests = await drainPreviewRequests(request)
  expect(previewRequests.at(-1)?.headers.page).toBe(LIVE_SLUG)
  expect(previewRequests.at(-1)?.params.wikitext).toBe(tagProbe)
})

test("pause and resume are visible, rapid edits debounce, and stale shows during an outstanding render", async ({
  page,
  request
}) => {
  await openEditor(page, request)
  await expectPreviewCurrent(page)
  await drainPreviewRequests(request)

  await page.locator("#edit-preview-pause-button").click()
  await expect(page.locator("#edit-preview-pause-button")).toHaveText("Resume preview")
  await expect(page.locator("#edit-preview-pause-button")).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  await expect(page.locator("#edit-preview-status")).toHaveText(
    "Preview paused. Changes are not being rendered."
  )
  await typeEditorText(page, "Paused edit should not render")
  await page.waitForTimeout(650)
  expect(await drainPreviewRequests(request)).toEqual([])
  await expect(page.locator("#live-preview-body")).not.toContainText(
    "Paused edit should not render"
  )

  await page.locator("#edit-preview-pause-button").click()
  await expect(page.locator("#edit-preview-pause-button")).toHaveText("Pause preview")
  await expectPreviewCurrent(page)
  await expect(page.locator("#live-preview-body")).toContainText(
    "Paused edit should not render"
  )
  const resumedRequests = await drainPreviewRequests(request)
  expect(resumedRequests).toHaveLength(1)

  const rapidText = "Rapid abcdef coalesced continuous preview edit"
  await typeEditorText(page, rapidText)
  await expectPreviewCurrent(page)
  const rapidRequests = await drainPreviewRequests(request)
  expect(rapidRequests).toHaveLength(1)
  expect(rapidRequests[0]?.params.wikitext).toBe(rapidText)

  let releaseFirstPreview!: () => void
  const firstPreviewGate = new Promise<void>((resolve) => {
    releaseFirstPreview = resolve
  })
  let interceptedPreviews = 0
  await page.route(PREVIEW_ROUTE, async (route) => {
    interceptedPreviews += 1
    if (interceptedPreviews === 1) await firstPreviewGate
    await route.continue()
  })
  try {
    const firstRequest = page.waitForRequest((candidate) =>
      candidate.url().includes("?/preview")
    )
    await typeEditorText(page, "Delayed render base")
    await firstRequest
    await typeEditorText(page, "Delayed render base with a newer edit")
    await expect(page.locator("#edit-preview-status")).toHaveText(
      "Preview is stale. Waiting for the latest edit to render."
    )
    expect(interceptedPreviews).toBe(1)
    releaseFirstPreview()
    await expectPreviewCurrent(page)
    await expect(page.locator("#live-preview-body")).toContainText(
      "Delayed render base with a newer edit"
    )
  } finally {
    releaseFirstPreview()
    await page.unroute(PREVIEW_ROUTE)
  }
})

test("a preview server failure shows an error state and saving remains functional", async ({
  page,
  request
}) => {
  await page.route(PREVIEW_ROUTE, async (route) => {
    await route.fulfill({ status: 500, body: "fixture preview outage" })
  })
  await openEditor(page, request)
  await expect(page.locator("#edit-preview-status")).toHaveText(
    "Preview failed. Editing and saving remain available.",
    { timeout: 10_000 }
  )
  await expect(page.locator(".wikitext-live-preview-error")).toContainText(
    "Preview render failed:"
  )

  const typedWikitext = "Saved while preview is unavailable"
  await typeEditorText(page, typedWikitext)
  await expect(page.locator("#edit-preview-status")).toHaveText(
    "Preview failed. Editing and saving remain available.",
    { timeout: 10_000 }
  )
  await page
    .locator("#editor")
    .locator("button[type='submit'], input[type='submit']")
    .click()
  await expect(page).toHaveURL(new RegExp(`/${LIVE_SLUG}$`, "u"), { timeout: 10_000 })
  await expect(page.locator("#page-content")).toContainText(typedWikitext)

  const writes = await request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())
  expect(writes.pageEdit.at(-1)?.params.wikitext).toBe(typedWikitext)
})

test("preview-injected styles are removed with the editor and do not remain in page chrome", async ({
  page,
  request
}) => {
  await openEditor(page, request)
  await typeEditorText(
    page,
    "live-preview-css-probe\n\nPreview style fixture **content**."
  )
  await expectPreviewCurrent(page)
  await expect(page.locator("style[data-live-preview-style]")).toHaveCount(2)

  await page.locator("#editor input[name='cancel']").click()
  await expect(page).toHaveURL(new RegExp(`/${LIVE_SLUG}$`, "u"))
  await expect(page.locator("style[data-live-preview-style]")).toHaveCount(0)
  await expect
    .poll(async () =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    )
    .not.toBe("rgb(12, 34, 56)")
})

test("creation exposes the continuous server preview for the composed new page source", async ({
  page,
  request
}) => {
  const createdText = "Created continuous preview source"
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  const response = await page.goto(`/${CREATE_SLUG}/edit/true`)
  expect(response?.status()).toBe(404)
  await expect(page.locator(".wikitext-editor .cm-content")).toBeVisible({
    timeout: 30_000
  })

  await typeEditorText(page, createdText)
  await expect(page.locator("#live-preview-body")).toContainText(createdText)
  await expectPreviewCurrent(page)
  const previewRequests = await drainPreviewRequests(request)
  expect(previewRequests.at(-1)).toEqual(
    expect.objectContaining({
      headers: expect.objectContaining({ page: CREATE_SLUG }),
      params: expect.objectContaining({ wikitext: createdText })
    })
  )

  await page
    .locator("#editor")
    .locator("button[type='submit'], input[type='submit']")
    .click()
  await expect(page).toHaveURL(new RegExp(`/${CREATE_SLUG}$`, "u"))
  const writes = await request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())
  expect(writes.pageCreate.at(-1)?.params.wikitext).toBe(createdText)
})
