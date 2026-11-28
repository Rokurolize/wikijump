import { expect, test } from "./hermetic-playwright"

import type { APIRequestContext, Page } from "./hermetic-playwright"

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
const SLUG = "editor-codemirror-probe"
const EDITOR_PATH = `/${SLUG}/edit`

const openEditor = async (page: Page, headers: Record<string, string> = {}) => {
  await page.setExtraHTTPHeaders({ ...AUTHENTICATED_HEADERS, ...headers })
  await page.goto(EDITOR_PATH)
  await expect(page.locator(".wikitext-editor .cm-content")).toBeVisible({
    timeout: 30_000
  })
}

const reset = async (request: APIRequestContext) => {
  await request.post(`${FIXTURE_URL}/clear-page-edit-locks`)
  await request.post(`${FIXTURE_URL}/clear-page-drafts`)
  await request.post(`${FIXTURE_URL}/reset-fixture-page?slug=${SLUG}`)
}

test.beforeEach(async ({ request }) => {
  await reset(request)
})

test.afterEach(async ({ request }) => {
  await reset(request)
})

test("360px editor keeps every touch target reachable with the preview in reading order", async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await openEditor(page)

  const metrics = await page.evaluate(() => {
    const selectors = [
      ".wikitext-editor-toolbar button",
      "#edit-preview-pause-button",
      ".wikitext-live-preview-back-to-source",
      "#ed6-title",
      "#ed6-alt-title",
      "#ed6-layout",
      "#ed6-tags",
      "#ed6-comments",
      "#ed6-parent",
      "#editor [type='submit']"
    ]
    const undersized = selectors.flatMap((selector) =>
      [...document.querySelectorAll<HTMLElement>(selector)].flatMap((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width < 43.5 || rect.height < 43.5
          ? [`${selector}: ${Math.round(rect.width)}x${Math.round(rect.height)}`]
          : []
      })
    )
    const preview = document.querySelector<HTMLElement>(".wikitext-live-preview")
    const previewHeader = document.querySelector<HTMLElement>(
      ".wikitext-live-preview-header"
    )
    const previewBody = document.querySelector<HTMLElement>(".wikitext-live-preview-body")
    const source = document.querySelector<HTMLElement>(".wikitext-editor")
    const back = document.querySelector<HTMLElement>(
      ".wikitext-live-preview-back-to-source"
    )
    if (!preview || !previewHeader || !previewBody || !source || !back) {
      throw new Error("Editor mobile layout elements are unavailable")
    }
    const save = document.querySelector<HTMLElement>("#editor [type='submit']")
    if (!save) throw new Error("Save control is unavailable")
    save.scrollIntoView({ block: "center" })
    const saveRect = save.getBoundingClientRect()
    const hit = document.elementFromPoint(
      saveRect.left + saveRect.width / 2,
      saveRect.top + saveRect.height / 2
    )
    return {
      undersized,
      clientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      previewAfterActions: preview.getBoundingClientRect().top > saveRect.top,
      previewHeaderSticky: getComputedStyle(previewHeader).position === "sticky",
      previewBodyBounded: getComputedStyle(previewBody).maxHeight !== "none",
      sourceVisible: source.getBoundingClientRect().width > 0,
      backVisible: getComputedStyle(back).display !== "none",
      saveUncovered: hit === save || save.contains(hit)
    }
  })

  expect(metrics.undersized).toEqual([])
  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
  expect(metrics.previewAfterActions).toBe(true)
  expect(metrics.previewHeaderSticky).toBe(true)
  expect(metrics.previewBodyBounded).toBe(true)
  expect(metrics.sourceVisible).toBe(true)
  expect(metrics.backVisible).toBe(true)
  expect(metrics.saveUncovered).toBe(true)

  await page.locator(".wikitext-live-preview-back-to-source").click()
  await expect(page.locator(".wikitext-editor .cm-content")).toBeFocused()
})

test("keyboard-only edit and save restores focus after dismissing the draft dialog", async ({
  page,
  request
}) => {
  await request.post(
    `${FIXTURE_URL}/seed-page-draft?${new URLSearchParams({
      slug: SLUG,
      title: "Keyboard draft",
      wikitext: "Keyboard draft text",
      comments: "keyboard"
    })}`
  )
  await openEditor(page)
  const dialog = page.locator(".edit-draft-dialog")
  await expect(dialog).toBeVisible()
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest(".edit-draft-dialog"))
    )
  ).toBe(true)

  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(page.locator(".wikitext-editor .cm-content")).toBeFocused()

  let editorFocused = await page.evaluate(() =>
    Boolean(document.activeElement?.classList.contains("cm-content"))
  )
  for (let index = 0; index < 100 && !editorFocused; index += 1) {
    await page.keyboard.press("Tab")
    editorFocused = await page.evaluate(() =>
      Boolean(document.activeElement?.classList.contains("cm-content"))
    )
  }
  expect(editorFocused).toBe(true)
  await page.keyboard.press("Control+A")
  await page.keyboard.type("Keyboard-only ED9 save")

  let saveFocused = await page.evaluate(() => {
    const element = document.activeElement
    return (
      (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
      element.type === "submit"
    )
  })
  for (let index = 0; index < 40 && !saveFocused; index += 1) {
    await page.keyboard.press("Tab")
    saveFocused = await page.evaluate(() => {
      const element = document.activeElement
      return (
        (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
        element.type === "submit"
      )
    })
  }
  expect(saveFocused).toBe(true)
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(new RegExp(`/${SLUG}$`, "u"))
  const writes = await request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())
  expect(writes.pageEdit.at(-1)?.params.wikitext).toBe("Keyboard-only ED9 save")
})

test("semantic roles, labels, and live regions cover editor state changes", async ({
  page,
  request
}) => {
  await request.post(
    `${FIXTURE_URL}/seed-page-draft?${new URLSearchParams({
      slug: SLUG,
      title: "Semantic draft",
      wikitext: "Semantic draft text",
      comments: "semantic"
    })}`
  )
  await openEditor(page)

  await expect(
    page.getByRole("toolbar", { name: "Wikitext source editing toolbar" })
  ).toBeVisible()
  expect(
    await page.locator(".wikitext-editor-toolbar button[aria-label]").count()
  ).toBeGreaterThanOrEqual(22)
  await expect(page.locator("[data-editor-action='bold']")).toHaveAttribute(
    "aria-keyshortcuts",
    "Control+B Meta+B"
  )

  const editor = page.locator(".wikitext-editor .cm-content")
  await expect(editor).toHaveAttribute("role", "textbox")
  await expect(editor).toHaveAttribute("aria-multiline", "true")
  await expect(editor).toHaveAttribute("aria-label", "Page source")
  await expect(editor).toHaveAttribute("spellcheck", "true")
  const describedBy = await editor.getAttribute("aria-describedby")
  expect(describedBy).toBeTruthy()
  await expect(page.locator(`#${describedBy}`)).toContainText("WYSIWYG")

  const preview = page.locator(".wikitext-live-preview")
  await expect(preview).toHaveAttribute("aria-label", "Preview")
  await expect(page.locator("#edit-preview-status")).toHaveAttribute("role", "status")
  await expect(page.locator("#edit-preview-status")).toHaveAttribute(
    "aria-live",
    "polite"
  )
  await expect(page.locator("[data-properties='panel']")).toHaveAttribute(
    "aria-label",
    "Page properties"
  )

  const announcer = page.locator("[data-editor-announcement]")
  await expect(announcer).toHaveAttribute("role", "status")
  await expect(announcer).toHaveAttribute("aria-live", "polite")

  const dialog = page.locator(".edit-draft-dialog")
  await expect(dialog).toHaveAttribute("role", "dialog")
  await expect(dialog).toHaveAttribute("aria-modal", "true")
  await page.getByRole("button", { name: "Restore draft" }).click()
  await expect(announcer).toHaveText("Draft restored into the editor.")
  await expect(page.locator("textarea[name='wikitext']")).toHaveValue(
    "Semantic draft text"
  )
})

test("right-to-left context mirrors the editor chrome and keeps typing intact", async ({
  page
}) => {
  await openEditor(page)
  await page.evaluate(() => {
    document.documentElement.dir = "rtl"
  })
  await expect(page.locator(".wikitext-editor")).toHaveAttribute("dir", "rtl")

  const metrics = await page.evaluate(() => {
    const direction = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)
      if (!element) throw new Error(`Missing ${selector}`)
      return getComputedStyle(element).direction
    }
    const buttons = [
      ...document.querySelectorAll<HTMLElement>(".wikitext-editor-toolbar button")
    ]
    const gutter = document.querySelector<HTMLElement>(".wikitext-editor .cm-gutters")
    const content = document.querySelector<HTMLElement>(".wikitext-editor .cm-content")
    if (!gutter || !content || buttons.length < 2)
      throw new Error("Editor chrome unavailable")
    return {
      editor: direction(".wikitext-editor"),
      toolbar: direction(".wikitext-editor-toolbar"),
      preview: direction(".wikitext-live-preview"),
      properties: direction("[data-properties='panel']"),
      content: direction(".wikitext-editor .cm-content"),
      firstButtonX: buttons[0].getBoundingClientRect().left,
      lastButtonX: buttons.at(-1)!.getBoundingClientRect().left,
      gutterLeft: gutter.getBoundingClientRect().left,
      contentLeft: content.getBoundingClientRect().left,
      documentScrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }
  })

  expect(metrics.editor).toBe("rtl")
  expect(metrics.toolbar).toBe("rtl")
  expect(metrics.preview).toBe("rtl")
  expect(metrics.properties).toBe("rtl")
  expect(metrics.content).toBe("rtl")
  expect(metrics.firstButtonX).toBeGreaterThan(metrics.lastButtonX)
  expect(metrics.gutterLeft).toBeGreaterThan(metrics.contentLeft)
  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.clientWidth)

  await page.locator(".wikitext-editor .cm-content").click()
  await page.keyboard.press("Control+A")
  await page.keyboard.type("rtl source")
  const before = await page.evaluate(() => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    return { offset: selection.anchorOffset, x: rect.left }
  })
  await page.keyboard.press("ArrowLeft")
  const after = await page.evaluate(() => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    return { offset: selection.anchorOffset, x: rect.left }
  })
  expect(before).not.toEqual(after)
  await expect(page.locator("textarea[name='wikitext']")).toHaveValue("rtl source")
})

test("IME composition and browser spellcheck leave the wikitext bytes intact", async ({
  page
}) => {
  await openEditor(page)
  const editor = page.locator(".wikitext-editor .cm-content")
  await editor.click()
  await page.keyboard.press("Control+A")
  await page.keyboard.press("Backspace")
  const session = await page.context().newCDPSession(page)
  for (const text of ["中", "文"]) {
    await session.send("Input.imeSetComposition", {
      text,
      selectionStart: text.length,
      selectionEnd: text.length
    })
    await session.send("Input.insertText", { text })
  }
  await expect(page.locator("textarea[name='wikitext']")).toHaveValue("中文")
  await expect(editor).toHaveText("中文")

  await page.keyboard.type(" speling mistakes")
  const source = await page.locator("textarea[name='wikitext']").inputValue()
  expect(source).toBe("中文 speling mistakes")
  expect(await page.evaluate(() => document.querySelectorAll("spell").length)).toBe(0)
  await expect(editor).toHaveAttribute("spellcheck", "true")
})

test.describe("Japanese editor locale", () => {
  test.use({ locale: "ja-JP" })

  test("Japanese locale resolves editor chrome through the Fluent catalogues", async ({
    page
  }) => {
    await openEditor(page, { "Accept-Language": "ja" })
    await expect(
      page.getByRole("toolbar", { name: "Wikiテキスト編集ツールバー" })
    ).toBeVisible()
    await expect(page.locator(".editor-properties-heading")).toHaveText(
      "ページのプロパティ"
    )
    await expect(page.locator("#ed6-title")).toHaveAttribute("placeholder", "タイトル")
    await expect(page.locator(".wikitext-live-preview")).toHaveAttribute(
      "aria-label",
      "プレビュー"
    )
    await expect(page.locator("#edit-preview-status")).toContainText("プレビュー", {
      timeout: 10_000
    })
    await expect(page.locator("[data-editor-action='bold']")).toHaveAttribute(
      "aria-label",
      "太字"
    )
    const leaked = await page.evaluate(() => {
      const chrome = [
        ...document.querySelectorAll<HTMLElement>(
          ".wikitext-editor-toolbar, .editor-properties, .wikitext-live-preview"
        )
      ]
        .map((element) => element.textContent ?? "")
        .join(" ")
      return (
        /editor-(?:toolbar|preview|properties|draft|save|lease|hint|link|image|back|section|create|edit|checking|acquiring|lock|check|parent)-[a-z-]+/u.exec(
          chrome
        )?.[0] ?? null
      )
    })
    expect(leaked).toBeNull()
  })
})
