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
const APP_URL = `http://127.0.0.1:${process.env.PLAYWRIGHT_APP_PORT ?? "4173"}`
const SLUG = "editor-codemirror-probe"
const CREATE_SLUG = "editor-codemirror-create-probe"
const PAGE_ID = 3000601
const EDITOR_PATH = `/${SLUG}/edit`

const pageProperties = async (request: import("@playwright/test").APIRequestContext) =>
  request
    .get(`${FIXTURE_URL}/fixture-page-properties?slug=${encodeURIComponent(SLUG)}`)
    .then((response) => response.json())

const pageWrites = async (request: import("@playwright/test").APIRequestContext) =>
  request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())

const resetFixture = async (request: import("@playwright/test").APIRequestContext) => {
  await request.post(`${FIXTURE_URL}/clear-page-edit-locks`)
  await request.post(`${FIXTURE_URL}/clear-properties-failure`)
  for (const slug of [SLUG, CREATE_SLUG]) {
    await request.post(
      `${FIXTURE_URL}/reset-fixture-page?slug=${encodeURIComponent(slug)}`
    )
  }
  await pageWrites(request)
}

const openEditor = async (
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext
) => {
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto(EDITOR_PATH)
  await expect(page.locator(".wikitext-editor .cm-content")).toBeVisible({
    timeout: 30_000
  })
  await expect(page.locator("[data-properties='panel']")).toBeVisible()
  await expect(page.locator("#ed6-parent")).toBeEnabled({ timeout: 15_000 })
}

const saveEditor = async (page: import("@playwright/test").Page) => {
  await page
    .locator("#editor")
    .locator("button[type='submit'], input[type='submit']")
    .click()
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request)
})

test.afterEach(async ({ request }) => {
  await resetFixture(request)
})

test("title, tags, and parent round-trip through save into independent page state", async ({
  page,
  request
}) => {
  await openEditor(page, request)
  await expect(page.locator("#ed6-title")).toHaveValue("Editor CodeMirror Probe")
  await expect(page.locator("#ed6-tags")).toHaveValue("fixture")
  await expect(page.locator("#ed6-parent")).toHaveValue("")

  await page.locator("#ed6-title").fill("Properties Round Trip")
  await page.locator("#ed6-tags").fill("fixture ed6-tag")
  await page.locator("#ed6-parent").fill("component:editor-codemirror-include")
  await saveEditor(page)

  await expect(page).toHaveURL(new RegExp(`/${SLUG}$`, "u"))
  const saved = await pageProperties(request)
  expect(saved).toEqual(
    expect.objectContaining({
      title: "Properties Round Trip",
      tags: ["fixture", "ed6-tag"],
      parent: ["component:editor-codemirror-include"]
    })
  )

  const writes = await pageWrites(request)
  expect(writes.pageEdit.at(-1)?.params).toEqual(
    expect.objectContaining({
      title: "Properties Round Trip",
      tags: ["fixture", "ed6-tag"]
    })
  )
  expect(writes.parentUpdate.at(-1)?.params).toEqual(
    expect.objectContaining({
      child: PAGE_ID,
      add: ["component:editor-codemirror-include"]
    })
  )
})

test("parent change is a gated page-tree mutation using edit permission", async ({
  page,
  request
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.goto(EDITOR_PATH)
  await expect(page.locator("[data-properties='panel']")).toHaveCount(0)

  const denied = await request.post(`${APP_URL}${EDITOR_PATH}?/parentSet`, {
    headers: SITE_HEADERS,
    multipart: {
      __superform_json:
        '[{"siteId":4,"pageId":1,"addParents":2},3000601,[3],"main",6000005]'
    }
  })
  expect(denied.status()).toBe(401)
  expect((await pageWrites(request)).parentUpdate).toEqual([])

  await openEditor(page, request)
  await page.locator("#ed6-parent").fill("main")
  await saveEditor(page)
  await expect(page).toHaveURL(new RegExp(`/${SLUG}$`, "u"))

  const writes = await pageWrites(request)
  expect(writes.parentUpdate.at(-1)?.headers).toEqual(
    expect.objectContaining({ sessionToken: "fixture-session-token" })
  )
  expect((await pageProperties(request)).parent).toEqual(["main"])
})

test("a failed parent move after a successful content save is explicit and retryable", async ({
  page,
  request
}) => {
  await request.post(`${FIXTURE_URL}/set-properties-failure?step=parent&code=1308`)
  await openEditor(page, request)
  await page.locator("#ed6-title").fill("Partial Content Saved")
  await page.locator("#ed6-tags").fill("fixture partial-tag")
  await page.locator("#ed6-parent").fill("main")
  await saveEditor(page)

  const report = page.locator("#ed6-properties-report")
  await expect(report).toHaveAttribute("data-properties-state", "partial")
  await expect(report).toContainText("page-tree move was not applied")
  await expect(report).toContainText("would create a cycle")
  await expect(page.locator("[data-properties='retry-move']")).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`${EDITOR_PATH}$`, "u"))

  const partial = await pageProperties(request)
  expect(partial.title).toBe("Partial Content Saved")
  expect(partial.tags).toEqual(["fixture", "partial-tag"])
  expect(partial.parent).toEqual([])

  await page.locator("[data-properties='retry-move']").click()
  await expect(page).toHaveURL(new RegExp(`/${SLUG}$`, "u"))
  expect((await pageProperties(request)).parent).toEqual(["main"])
})

test("invalid tags and parents explain the fix before saving", async ({
  page,
  request
}) => {
  await openEditor(page, request)
  await page.locator("#ed6-tags").fill("alpha,beta")
  await expect(page.locator("#ed6-tags-error")).toContainText("Remove the comma")
  await saveEditor(page)
  await expect(page.locator("#ed6-properties-report")).toHaveAttribute(
    "data-properties-state",
    "invalid"
  )
  expect((await pageWrites(request)).pageEdit).toEqual([])

  await page.locator("#ed6-tags").fill("fixture")
  await page.locator("#ed6-parent").fill("Bad Parent")
  await expect(page.locator("#ed6-parent-error")).toContainText("not a valid page name")

  await page.locator("#ed6-parent").fill(SLUG)
  await expect(page.locator("#ed6-parent-error")).toContainText(
    "cannot be its own parent"
  )

  await page.locator("#ed6-parent").fill("missing:parent")
  await saveEditor(page)
  const report = page.locator("#ed6-properties-report")
  await expect(report).toHaveAttribute("data-properties-state", "partial")
  await expect(report).toContainText("parent page does not exist")
  expect((await pageProperties(request)).parent).toEqual([])
})

test("creation carries URL-supplied properties and applies the parent through the create path", async ({
  page,
  request
}) => {
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  const response = await page.goto(
    `/${CREATE_SLUG}/edit/true/title/Created%20Properties/tags/created-tag/parentPage/main`
  )
  expect(response?.status()).toBe(404)
  await expect(page.locator(".wikitext-editor .cm-content")).toBeVisible({
    timeout: 30_000
  })
  await expect(page.locator("#ed6-title")).toHaveValue("Created Properties")
  await expect(page.locator("#ed6-tags")).toHaveValue("created-tag")
  await expect(page.locator("#ed6-parent")).toHaveValue("main")
  await expect(page.locator("#ed6-layout")).toBeVisible()
  await expect(page.locator("[data-properties='template']")).toBeVisible()

  await saveEditor(page)
  await expect(page).toHaveURL(new RegExp(`/${CREATE_SLUG}$`, "u"))
  const writes = await pageWrites(request)
  expect(writes.pageCreate.at(-1)?.params).toEqual(
    expect.objectContaining({ title: "Created Properties", tags: ["created-tag"] })
  )
  expect(writes.parentUpdate.at(-1)?.params).toEqual(
    expect.objectContaining({ add: ["main"] })
  )
  const saved = await request
    .get(`${FIXTURE_URL}/fixture-page-properties?slug=${CREATE_SLUG}`)
    .then((result) => result.json())
  expect(saved.parent).toEqual(["main"])
})

test("the properties panel stays bounded at 360px without covering the primary actions", async ({
  page,
  request
}) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await openEditor(page, request)

  await expect(page.locator("#ed6-tags")).toBeVisible()
  await expect(page.locator("#ed6-parent")).toBeVisible()
  const saveButton = page
    .locator("#editor")
    .locator("button[type='submit'], input[type='submit']")
  await saveButton.scrollIntoViewIfNeeded()

  const metrics = await page.evaluate(() => {
    const panel = document.querySelector("[data-properties='panel']")
    const save = document.querySelector("#editor [type='submit']")
    const scroller = document.querySelector(".wikitext-editor .cm-scroller")
    if (
      !(panel instanceof HTMLElement) ||
      !(save instanceof HTMLElement) ||
      !(scroller instanceof HTMLElement)
    ) {
      throw new Error("Editor properties elements are unavailable")
    }
    const saveRect = save.getBoundingClientRect()
    const hit = document.elementFromPoint(
      saveRect.left + saveRect.width / 2,
      saveRect.top + saveRect.height / 2
    )
    const scrollerStyle = getComputedStyle(scroller)
    return {
      clientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      panelRight: panel.getBoundingClientRect().right,
      saveUncovered: hit === save || save.contains(hit),
      touchAction: scrollerStyle.touchAction,
      overscrollBehavior: scrollerStyle.overscrollBehavior
    }
  })
  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
  expect(metrics.panelRight).toBeLessThanOrEqual(metrics.clientWidth)
  expect(metrics.saveUncovered).toBe(true)
  expect(metrics.touchAction).toContain("pan-x")
  expect(metrics.touchAction).toContain("pan-y")
  expect(metrics.overscrollBehavior).not.toBe("contain")
  expect(metrics.overscrollBehavior).not.toBe("none")
})
