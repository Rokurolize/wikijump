import { expect, test } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}
const AUTHENTICATED_HEADERS = {
  ...SITE_HEADERS,
  cookie: "wikijump_token=fixture-session-token",
  origin: `http://localhost:${process.env.PLAYWRIGHT_APP_PORT ?? "4173"}`
}
const FIXTURE_URL = `http://127.0.0.1:${process.env.PLAYWRIGHT_FIXTURE_PORT ?? "42747"}`
const EDITOR_PATH = "/editor-codemirror-probe/edit"

const typedWikitext = [
  "+ Typed editor heading",
  "",
  "[[include component:editor-codemirror-include]]",
  "",
  "Typed **bold** body with exact bytes: áβ中 🚀"
].join("\n")

const openEditor = async (
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext
) => {
  await request.post(`${FIXTURE_URL}/clear-page-edit-locks`)
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto(EDITOR_PATH)
  await expect(page.locator(".wikitext-editor .cm-content")).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Page source" })).toBeVisible()
  await expect(page.locator("textarea[name='wikitext']")).toBeHidden()
}

const typeEditorText = async (page: import("@playwright/test").Page, text: string) => {
  await page.locator(".wikitext-editor .cm-content").click()
  await page.keyboard.press("Control+A")
  await page.keyboard.type(text)
}

test("CodeMirror preview and save use the exact typed wikitext and the server paths", async ({
  page,
  request
}) => {
  await openEditor(page, request)

  await expect(page.locator(".wikitext-editor .tok-heading").first()).toHaveText(
    "+ Editor fixture heading"
  )
  await expect(page.locator(".wikitext-editor .tok-keyword").first()).toContainText(
    "[[include component:editor-codemirror-include]]"
  )
  await expect(page.locator(".wikitext-editor .tok-link").first()).toContainText(
    "[[[page-workflow-probe|Fixture link]]]"
  )
  await expect(page.locator(".wikitext-editor .tok-strong").first()).toHaveText(
    "**Bold fixture**"
  )
  await expect(page.locator(".wikitext-editor .tok-emphasis").first()).toHaveText(
    "//italic fixture//"
  )
  await expect(page.locator(".wikitext-editor .tok-comment").first()).toHaveText(
    "[!-- hidden fixture comment --]"
  )
  await expect(page.locator(".wikitext-editor .tok-meta").first()).toHaveText("%%title%%")

  const externallySetText = "External form synchronization"
  await page.locator("textarea[name='wikitext']").evaluate((element, value) => {
    if (!(element instanceof HTMLTextAreaElement)) {
      throw new Error("wikitext fallback textarea is unavailable")
    }
    element.value = value
    element.dispatchEvent(new Event("input", { bubbles: true }))
  }, externallySetText)
  await expect(page.locator(".wikitext-editor .cm-content")).toHaveText(externallySetText)

  await typeEditorText(page, typedWikitext)
  await expect(page.locator("textarea[name='wikitext']")).toHaveValue(typedWikitext)

  const previewResponse = page.waitForResponse(
    (response) =>
      response.url().includes("?/preview") && response.request().method() === "POST"
  )
  await page.locator("#edit-preview-button").click()
  expect((await previewResponse).status()).toBe(200)
  await expect(page.locator("#page-content")).toContainText(
    "Included editor fixture text."
  )
  const previewHtml = await page.locator("#page-content").innerHTML()

  const previewRequests = await request
    .get(`${FIXTURE_URL}/last-page-preview-requests`)
    .then((response) => response.json())
  expect(previewRequests).toEqual([
    expect.objectContaining({
      params: expect.objectContaining({
        site_id: 6000005,
        title: "Editor CodeMirror Probe",
        wikitext: typedWikitext,
        syntax_only: false
      })
    })
  ])

  await page.locator("textarea[name='comments']").fill("codemirror exact save")
  await page
    .locator("#editor")
    .locator("button[type='submit'], input[type='submit']")
    .click()
  await expect(page).toHaveURL(/\/editor-codemirror-probe$/u)
  await expect(page.locator("#page-content")).toContainText(
    "Included editor fixture text."
  )
  const savedHtml = await page.locator("#page-content").innerHTML()
  expect(savedHtml).toBe(previewHtml)

  const writes = await request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())
  expect(writes.pageEdit).toEqual([
    expect.objectContaining({
      params: expect.objectContaining({
        page: 3000601,
        wikitext: typedWikitext,
        title: "Editor CodeMirror Probe",
        revision_comments: "codemirror exact save",
        lease: expect.objectContaining({
          mode: "page",
          lock_id: expect.any(Number),
          lock_secret: expect.any(String)
        })
      })
    })
  ])
  expect(writes.pageEditLockAcquire).toEqual([
    expect.objectContaining({
      params: expect.objectContaining({ page: "editor-codemirror-probe", mode: "page" })
    })
  ])
})

test("keyboard-only editing reaches the editor, preview, and save without Tab trapping", async ({
  page,
  request
}) => {
  await openEditor(page, request)
  const keyboardText = "Keyboard-only exact text"

  let editorFocused = false
  for (let index = 0; index < 100; index += 1) {
    await page.keyboard.press("Tab")
    editorFocused =
      (await page.evaluate(() =>
        document.activeElement?.classList.contains("cm-content")
      )) === true
    if (editorFocused) break
  }
  expect(editorFocused).toBe(true)

  await page.keyboard.press("Control+A")
  await page.keyboard.type(keyboardText)
  await expect(page.locator("textarea[name='wikitext']")).toHaveValue(keyboardText)

  await page.keyboard.press("Tab")
  await expect(page.locator("input[name='tags']")).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(page.locator("textarea[name='comments']")).toBeFocused()

  let previewFocused = false
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab")
    previewFocused =
      (await page.evaluate(
        () => document.activeElement?.id === "edit-preview-button"
      )) === true
    if (previewFocused) break
  }
  expect(previewFocused).toBe(true)

  const previewResponse = page.waitForResponse((response) =>
    response.url().includes("?/preview")
  )
  await page.keyboard.press("Enter")
  expect((await previewResponse).status()).toBe(200)
  await expect(page.locator("#page-content")).toContainText(keyboardText)

  await page.keyboard.press("Tab")
  const saveFocused = await page.evaluate(() => {
    const element = document.activeElement
    return (
      (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
      element.type === "submit"
    )
  })
  expect(saveFocused).toBe(true)
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/editor-codemirror-probe$/u)

  const writes = await request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())
  expect(writes.pageEdit.at(-1)?.params.wikitext).toBe(keyboardText)
})

test("the narrow editor wraps without horizontal overflow and keeps touch scrolling chainable", async ({
  page,
  request
}) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await openEditor(page, request)

  const metrics = await page.locator(".wikitext-editor").evaluate((element) => {
    const editor = element.querySelector(".cm-editor")
    const scroller = element.querySelector(".cm-scroller")
    if (!(editor instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
      throw new Error("CodeMirror editor elements are unavailable")
    }
    const scrollerStyle = getComputedStyle(scroller)
    return {
      clientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      editorClientWidth: editor.clientWidth,
      editorScrollWidth: editor.scrollWidth,
      elementScrollWidth: element.scrollWidth,
      overscrollBehavior: scrollerStyle.overscrollBehavior,
      touchAction: scrollerStyle.touchAction
    }
  })
  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
  expect(metrics.elementScrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
  expect(metrics.editorScrollWidth).toBeLessThanOrEqual(metrics.editorClientWidth + 1)
  expect(metrics.touchAction).toContain("pan-x")
  expect(metrics.touchAction).toContain("pan-y")
  expect(metrics.overscrollBehavior).not.toBe("contain")
  expect(metrics.overscrollBehavior).not.toBe("none")
})
