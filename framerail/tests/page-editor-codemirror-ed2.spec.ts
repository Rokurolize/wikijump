import { expect, test, waitForSvelteDelegatedHandler } from "./hermetic-playwright"

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

const CREATE_SLUG = "editor-codemirror-create-probe"
const SECTION_SLUG = "editor-codemirror-section-probe"
const APPEND_SLUG = "editor-codemirror-append-probe"

const templateAlpha = "+ Template Alpha heading\n\nTemplate **alpha** body."
const templateBeta = "+ Template Beta heading\n\n[[[page-workflow-probe|Template link]]]"

const sectionSource = [
  "Intro bytes áβ中 🚀",
  "",
  "+ Alpha section",
  "Alpha body **bold**.",
  "",
  "++ Child section",
  "Child body with [[[page-workflow-probe|a link]]].",
  "",
  "++ Second child",
  "Second child body.",
  "",
  "+ Beta section",
  "Beta body."
].join("\n")

const appendBase = "Append base áβ中 🚀\nwith **bold** base."

const rustLines = (text: string): string[] => {
  const lines: string[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\n") continue
    lines.push(text.slice(start, text[index - 1] === "\r" ? index - 1 : index))
    start = index + 1
  }
  if (start < text.length) lines.push(text.slice(start))
  return lines
}

const headingLevel = (line: string): number | null => {
  let pluses = 0
  while (pluses < line.length && line[pluses] === "+") pluses += 1
  if (pluses === 0 || pluses > 6) return null
  let rest = line.slice(pluses)
  if (rest.startsWith("*")) rest = rest.slice(1)
  return rest === "" || rest.startsWith(" ") ? pluses : null
}

const spliceSection = (
  wikitext: string,
  sectionIndex: number,
  replacement: string
): string => {
  const trailingNewline = wikitext.endsWith("\n")
  const lines = rustLines(wikitext)
  const headings = lines.flatMap((line, index) => {
    const level = headingLevel(line)
    return level === null ? [] : [{ index, level }]
  })
  const heading = headings[sectionIndex]
  if (!heading) throw new Error("expected section is unavailable")
  const end =
    headings.slice(sectionIndex + 1).find((other) => other.level <= heading.level)
      ?.index ?? lines.length
  const spliced = [
    ...lines.slice(0, heading.index),
    ...rustLines(replacement),
    ...lines.slice(end)
  ].join("\n")
  return trailingNewline && spliced !== "" ? `${spliced}\n` : spliced
}

const multipartTextFieldBytes = (text: string): string => text.replace(/\n/gu, "\r\n")

const appendWikitext = (wikitext: string, addition: string): string => {
  if (addition === "") return wikitext
  if (wikitext === "") return addition
  return wikitext.endsWith("\n") ? `${wikitext}${addition}` : `${wikitext}\n${addition}`
}

const fixturePageSource = async (
  request: import("@playwright/test").APIRequestContext,
  slug: string
) =>
  request
    .get(`${FIXTURE_URL}/fixture-page-source?slug=${encodeURIComponent(slug)}`)
    .then((response) => response.json())
    .then((body) => body.wikitext as string)

const pageWrites = async (request: import("@playwright/test").APIRequestContext) =>
  request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())

const expectMobileEditorContained = async (
  page: import("@playwright/test").Page,
  surfaceSelector: string
) => {
  const metrics = await page
    .locator(`${surfaceSelector} .wikitext-editor`)
    .evaluate((element) => {
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
}

const focusEditorByKeyboard = async (
  page: import("@playwright/test").Page,
  surfaceSelector: string
) => {
  let editorFocused = false
  for (let index = 0; index < 100; index += 1) {
    await page.keyboard.press("Tab")
    editorFocused = await page
      .locator(`${surfaceSelector} .cm-content`)
      .evaluate((element) => element === document.activeElement)
      .catch(() => false)
    if (editorFocused) break
  }
  expect(editorFocused).toBe(true)
}

const focusSubmitByKeyboard = async (
  page: import("@playwright/test").Page,
  surfaceSelector: string
) => {
  let submitFocused = false
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press("Tab")
    submitFocused = await page.evaluate((selector) => {
      const surface = document.querySelector(selector)
      const element = document.activeElement
      return (
        surface?.contains(element) === true &&
        (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
        element.type === "submit"
      )
    }, surfaceSelector)
    if (submitFocused) break
  }
  expect(submitFocused).toBe(true)
}

const expectEditorReady = async (
  page: import("@playwright/test").Page,
  surfaceSelector: string
) => {
  const surface = page.locator(surfaceSelector)
  await expect(surface.locator(".cm-content")).toBeVisible({ timeout: 30_000 })
  await expect(surface.locator(".wikitext-editor-fallback")).toBeHidden()
  return surface
}

const openAppendPane = async (page: import("@playwright/test").Page) => {
  await page.goto(`/${APPEND_SLUG}`, { waitUntil: "domcontentloaded" })
  await waitForSvelteDelegatedHandler(page, "#more-options-button")
  await page.locator("#more-options-button").click()
  await page.locator("#edit-append-button").click()
}

const openSectionControls = async (page: import("@playwright/test").Page) => {
  await page.goto(`/${SECTION_SLUG}`, { waitUntil: "domcontentloaded" })
  await waitForSvelteDelegatedHandler(page, "#more-options-button")
  await page.locator("#more-options-button").click()
  await page.locator("#edit-sections-button").click()
  await expect(page.locator("#edit-section-b-1")).toBeVisible()
}

test.beforeEach(async ({ request }) => {
  await request.post(`${FIXTURE_URL}/clear-page-edit-locks`)
  await request.get(`${FIXTURE_URL}/last-page-write-requests`)
})

test.afterEach(async ({ request }) => {
  await request.post(`${FIXTURE_URL}/clear-page-edit-locks`)
  for (const slug of [CREATE_SLUG, SECTION_SLUG, APPEND_SLUG]) {
    await request.post(
      `${FIXTURE_URL}/reset-fixture-page?slug=${encodeURIComponent(slug)}`
    )
  }
})

test("creation keeps template and layout behavior while submitting exact typed bytes", async ({
  page,
  request
}) => {
  const typedCreation = [
    "+ Created heading",
    "",
    "[[[page-workflow-probe|Created link]]]",
    "",
    "Created **bold** bytes: áβ中 🚀"
  ].join("\n")
  await page.setViewportSize({ width: 360, height: 640 })
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  const response = await page.goto(`/${CREATE_SLUG}/edit/true`)
  expect(response?.status()).toBe(404)

  const surface = await expectEditorReady(page, "#editor")
  await expect(surface.locator("textarea[name='wikitext']")).toHaveValue(templateAlpha)
  await expect(surface.locator(".tok-heading").first()).toHaveText(
    "+ Template Alpha heading"
  )
  await expect(surface.locator(".tok-strong").first()).toHaveText("**alpha**")

  await page.locator("#page-templates").selectOption({ label: "Editor template beta" })
  await expect(surface.locator("textarea[name='wikitext']")).toHaveValue(templateBeta)
  await expect(surface.locator(".cm-content")).toContainText("Template Beta heading")
  await page.locator("select[name='layout']").selectOption("wikijump")

  await focusEditorByKeyboard(page, "#editor")
  await page.keyboard.press("Control+A")
  await page.keyboard.type(typedCreation)
  await expect(surface.locator("textarea[name='wikitext']")).toHaveValue(typedCreation)
  await expect(surface.locator(".tok-heading").first()).toHaveText("+ Created heading")
  await expect(surface.locator(".tok-link").first()).toContainText(
    "[[[page-workflow-probe|Created link]]]"
  )
  await expect(surface.locator(".tok-strong").first()).toHaveText("**bold**")
  await expectMobileEditorContained(page, "#editor")

  await focusSubmitByKeyboard(page, "#editor")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(new RegExp(`/${CREATE_SLUG}$`, "u"))

  const writes = await pageWrites(request)
  expect(writes.pageCreate).toEqual([
    expect.objectContaining({
      params: expect.objectContaining({
        slug: CREATE_SLUG,
        wikitext: typedCreation,
        layout: "wikijump"
      })
    })
  ])
  expect(writes.pageEditLockAcquire).toEqual([])
})

test("section editing submits the typed replacement and reconstructs the full source", async ({
  page,
  request
}) => {
  const childStart = sectionSource.indexOf("++ Child section")
  const secondChildStart = sectionSource.indexOf("++ Second child")
  const initialSection = sectionSource.slice(childStart, secondChildStart)
  const replacement = [
    "++ Replacement child",
    "Replacement **bold** bytes: áβ中 🚀",
    "",
    "+++ Nested replacement",
    "Nested body"
  ].join("\n")
  await page.setViewportSize({ width: 360, height: 640 })
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await openSectionControls(page)
  await page.locator("#edit-section-b-1").click()

  const surface = await expectEditorReady(page, "#edit-section-content")
  await expect(surface.locator("textarea[name='wikitext']")).toHaveValue(initialSection)
  await expect(surface.locator(".tok-heading").first()).toHaveText("++ Child section")
  await expect(surface.locator(".tok-link").first()).toContainText(
    "[[[page-workflow-probe|a link]]]"
  )

  await focusEditorByKeyboard(page, "#edit-section-content")
  await page.keyboard.press("Control+A")
  await page.keyboard.type(replacement)
  await expect(surface.locator("textarea[name='wikitext']")).toHaveValue(replacement)
  await expect(surface.locator(".tok-heading").first()).toHaveText("++ Replacement child")
  await expect(surface.locator(".tok-strong").first()).toHaveText("**bold**")
  await expectMobileEditorContained(page, "#edit-section-content")

  const editResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("?/edit") && response.request().method() === "POST",
    { timeout: 10_000 }
  )
  await focusSubmitByKeyboard(page, "#edit-section-content")
  await page.keyboard.press("Enter")
  const editResponse = await editResponsePromise
  expect(editResponse.status()).toBe(200)
  await expect(page).toHaveURL(new RegExp(`/${SECTION_SLUG}$`, "u"))

  const writes = await pageWrites(request)
  expect(writes.pageEdit).toEqual([
    expect.objectContaining({
      params: expect.objectContaining({
        wikitext: replacement,
        lease: expect.objectContaining({
          mode: "section",
          section_index: 1
        })
      })
    })
  ])
  expect(writes.pageEditLockAcquire).toEqual([
    expect.objectContaining({
      params: expect.objectContaining({ mode: "section", section_index: 1 })
    })
  ])
  expect(await fixturePageSource(request, SECTION_SLUG)).toBe(
    spliceSection(sectionSource, 1, replacement)
  )
})

test("append submits the typed addition and preserves byte-identical composition", async ({
  page,
  request
}) => {
  const addition = ["+ Appended heading", "", "Appended **bold** bytes: áβ中 🚀"].join(
    "\n"
  )
  await page.setViewportSize({ width: 360, height: 640 })
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await openAppendPane(page)

  const surface = await expectEditorReady(page, "#page-append")
  await focusEditorByKeyboard(page, "#page-append")
  await page.keyboard.type(addition)
  await expect(surface.locator("textarea[name='append']")).toHaveValue(addition)
  await expect(surface.locator("input[name='wikitext']")).toHaveValue(addition)
  await expect(surface.locator(".tok-heading").first()).toHaveText("+ Appended heading")
  await expect(surface.locator(".tok-strong").first()).toHaveText("**bold**")
  await page.locator('label[for="page-append-input"]').click()
  await expect(surface.locator(".cm-content")).toBeFocused()
  await expectMobileEditorContained(page, "#page-append")

  await focusSubmitByKeyboard(page, "#page-append")
  await page.keyboard.press("Enter")
  await expect(page.locator("#page-append")).toHaveCount(0)

  const writes = await pageWrites(request)
  expect(writes.pageEdit).toEqual([
    expect.objectContaining({
      params: expect.objectContaining({
        wikitext: multipartTextFieldBytes(addition),
        lease: expect.objectContaining({ mode: "append" })
      })
    })
  ])
  expect(writes.pageEditLockAcquire).toEqual([
    expect.objectContaining({
      params: expect.objectContaining({ mode: "append" })
    })
  ])
  expect(await fixturePageSource(request, APPEND_SLUG)).toBe(
    appendWikitext(appendBase, multipartTextFieldBytes(addition))
  )
})

test("section editing surfaces an existing lock conflict with the section lease mode", async ({
  page,
  request
}) => {
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await request.post(`${FIXTURE_URL}/hold-page-edit-lock?slug=${SECTION_SLUG}`)
  await openSectionControls(page)
  await page.locator("#edit-section-b-1").click()

  await expect(page.locator("#edit-lease-dialog-title")).toHaveText(
    "The page is being edited"
  )
  await expect(page.locator(".edit-lease-conflicts")).toContainText(
    "User 456 — lock mode: page"
  )
  await expect(page.locator("#edit-section-content .cm-content")).toHaveCount(0)

  const writes = await pageWrites(request)
  expect(writes.pageEditLockAcquire).toEqual([
    expect.objectContaining({
      params: expect.objectContaining({ mode: "section", section_index: 1 })
    })
  ])
})

test("append surfaces an existing lock conflict with the append lease mode", async ({
  page,
  request
}) => {
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await request.post(`${FIXTURE_URL}/hold-page-edit-lock?slug=${APPEND_SLUG}`)
  await openAppendPane(page)

  await expect(page.locator("#edit-lease-dialog-title")).toHaveText(
    "The page is being edited"
  )
  await expect(page.locator(".edit-lease-conflicts")).toContainText(
    "User 456 — lock mode: page"
  )
  await expect(page.locator("#page-append .cm-content")).toHaveCount(0)

  const writes = await pageWrites(request)
  expect(writes.pageEditLockAcquire).toEqual([
    expect.objectContaining({
      params: expect.objectContaining({ mode: "append" })
    })
  ])
})
