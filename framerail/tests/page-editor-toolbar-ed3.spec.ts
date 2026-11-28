import {
  expect,
  test,
  waitForSvelteDelegatedHandler,
  type Page
} from "./hermetic-playwright"

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

const MAIN_EDITOR_PATH = "/editor-codemirror-probe/edit"
const CREATE_SLUG = "editor-codemirror-create-probe"
const SECTION_SLUG = "editor-codemirror-section-probe"
const APPEND_SLUG = "editor-codemirror-append-probe"

const expectedActions = [
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "bold",
  "italic",
  "strike",
  "teletype",
  "quote",
  "bullet-list",
  "numbered-list",
  "horizontal-rule",
  "raw",
  "link",
  "image",
  "table",
  "code",
  "footnote",
  "math",
  "inline-math"
]

const tableSkeleton = "||~ Heading 1 ||~ Heading 2 ||\n|| Cell 1 || Cell 2 ||"

const expectEditorReady = async (page: Page, surfaceSelector: string) => {
  const surface = page.locator(surfaceSelector)
  await expect(surface.locator(".cm-content")).toBeVisible({ timeout: 30_000 })
  await expect(surface.locator(".wikitext-editor-toolbar")).toBeVisible()
  await expect(surface.locator(".wikitext-editor-fallback")).toBeHidden()
  return surface
}

const openMainEditor = async (page: Page) => {
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto(MAIN_EDITOR_PATH)
  return expectEditorReady(page, "#editor")
}

const openAppendPane = async (page: Page) => {
  await page.goto(`/${APPEND_SLUG}`, { waitUntil: "domcontentloaded" })
  await waitForSvelteDelegatedHandler(page, "#more-options-button")
  await page.locator("#more-options-button").click()
  await page.locator("#edit-append-button").click()
}

const openSectionControls = async (page: Page) => {
  await page.goto(`/${SECTION_SLUG}`, { waitUntil: "domcontentloaded" })
  await waitForSvelteDelegatedHandler(page, "#more-options-button")
  await page.locator("#more-options-button").click()
  await page.locator("#edit-sections-button").click()
  await expect(page.locator("#edit-section-b-1")).toBeVisible()
}

const resetEditor = async (page: Page, surfaceSelector: string, text: string) => {
  const content = page.locator(`${surfaceSelector} .cm-content`)
  await content.click()
  await page.keyboard.press("Control+A")
  if (text === "") {
    await page.keyboard.press("Backspace")
    return
  }
  await page.keyboard.insertText(text)
}

const selectEditorContents = async (page: Page, surfaceSelector: string) => {
  const content = page.locator(`${surfaceSelector} .cm-content`)
  await content.click()
  await page.keyboard.press("Control+A")
}

const acceptNextPrompt = (page: Page, value: string) => {
  page.once("dialog", (dialog) => {
    void dialog.accept(value)
  })
}

test.beforeEach(async ({ request }) => {
  await request.post(`${FIXTURE_URL}/clear-page-edit-locks`)
})

test.afterEach(async ({ request }) => {
  await request.post(`${FIXTURE_URL}/clear-page-edit-locks`)
})

test("every toolbar button applies its deterministic source transformation", async ({
  page
}) => {
  const surface = await openMainEditor(page)
  const cases: {
    action: string
    initial: string
    expected: string
    prompt?: string
  }[] = [
    { action: "heading1", initial: "Title", expected: "+ Title" },
    { action: "heading2", initial: "Title", expected: "++ Title" },
    { action: "heading3", initial: "Title", expected: "+++ Title" },
    { action: "heading4", initial: "Title", expected: "++++ Title" },
    { action: "heading5", initial: "Title", expected: "+++++ Title" },
    { action: "heading6", initial: "Title", expected: "++++++ Title" },
    { action: "bold", initial: "alpha", expected: "**alpha**" },
    { action: "italic", initial: "alpha", expected: "//alpha//" },
    { action: "strike", initial: "alpha", expected: "--alpha--" },
    { action: "teletype", initial: "alpha", expected: "{{alpha}}" },
    { action: "quote", initial: "alpha\nbeta", expected: "> alpha\n> beta" },
    { action: "bullet-list", initial: "alpha\nbeta", expected: "* alpha\n* beta" },
    { action: "numbered-list", initial: "alpha\nbeta", expected: "# alpha\n# beta" },
    { action: "horizontal-rule", initial: "alpha", expected: "----" },
    { action: "raw", initial: "**alpha**", expected: "@@**alpha**@@" },
    {
      action: "link",
      initial: "alpha",
      expected: "[[[https://example.test|alpha]]]",
      prompt: "https://example.test"
    },
    {
      action: "image",
      initial: "alpha",
      expected: "[[image image.png]]",
      prompt: "image.png"
    },
    { action: "table", initial: "alpha", expected: tableSkeleton },
    { action: "code", initial: "alpha", expected: "[[code]]\nalpha\n[[/code]]" },
    {
      action: "footnote",
      initial: "alpha",
      expected: "[[footnote]]alpha[[/footnote]]"
    },
    { action: "math", initial: "alpha", expected: "[[math]]\nalpha\n[[/math]]" },
    { action: "inline-math", initial: "alpha", expected: "[[$ alpha $]]" }
  ]

  for (const { action, initial, expected, prompt } of cases) {
    await resetEditor(page, "#editor", initial)
    if (initial !== "") await selectEditorContents(page, "#editor")
    if (prompt !== undefined) acceptNextPrompt(page, prompt)
    await surface.locator(`[data-editor-action='${action}']`).click()
    await expect(surface.locator("textarea[name='wikitext']")).toHaveValue(expected)
  }

  await resetEditor(page, "#editor", "")
  await surface.locator("[data-editor-action='bold']").click()
  await expect(surface.locator("textarea[name='wikitext']")).toHaveValue("****")

  await resetEditor(page, "#editor", "**alpha**")
  const textArea = surface.locator("textarea[name='wikitext']")
  await selectEditorContents(page, "#editor")
  await surface.locator("[data-editor-action='bold']").click()
  await expect(textArea).toHaveValue("alpha")
})

test("documented keyboard shortcuts apply their editor operations", async ({ page }) => {
  const surface = await openMainEditor(page)
  const cases: {
    action: string
    shortcut: string
    initial: string
    expected: string
    prompt?: string
  }[] = [
    { action: "heading1", shortcut: "Alt+1", initial: "Title", expected: "+ Title" },
    { action: "heading2", shortcut: "Alt+2", initial: "Title", expected: "++ Title" },
    { action: "heading3", shortcut: "Alt+3", initial: "Title", expected: "+++ Title" },
    { action: "heading4", shortcut: "Alt+4", initial: "Title", expected: "++++ Title" },
    {
      action: "heading5",
      shortcut: "Alt+5",
      initial: "Title",
      expected: "+++++ Title"
    },
    {
      action: "heading6",
      shortcut: "Alt+6",
      initial: "Title",
      expected: "++++++ Title"
    },
    { action: "bold", shortcut: "Control+B", initial: "alpha", expected: "**alpha**" },
    { action: "italic", shortcut: "Control+I", initial: "alpha", expected: "//alpha//" },
    {
      action: "strike",
      shortcut: "Control+Shift+X",
      initial: "alpha",
      expected: "--alpha--"
    },
    {
      action: "teletype",
      shortcut: "Alt+T",
      initial: "alpha",
      expected: "{{alpha}}"
    },
    {
      action: "quote",
      shortcut: "Alt+Q",
      initial: "alpha\nbeta",
      expected: "> alpha\n> beta"
    },
    {
      action: "bullet-list",
      shortcut: "Alt+U",
      initial: "alpha\nbeta",
      expected: "* alpha\n* beta"
    },
    {
      action: "numbered-list",
      shortcut: "Alt+O",
      initial: "alpha\nbeta",
      expected: "# alpha\n# beta"
    },
    {
      action: "link",
      shortcut: "Control+K",
      initial: "alpha",
      expected: "[[[https://example.test|alpha]]]",
      prompt: "https://example.test"
    },
    {
      action: "image",
      shortcut: "Alt+G",
      initial: "alpha",
      expected: "[[image image.png]]",
      prompt: "image.png"
    },
    {
      action: "code",
      shortcut: "Alt+C",
      initial: "alpha",
      expected: "[[code]]\nalpha\n[[/code]]"
    }
  ]

  for (const { action, shortcut, initial, expected, prompt } of cases) {
    const button = surface.locator(`[data-editor-action='${action}']`)
    await expect(button).toHaveAttribute(
      "title",
      new RegExp(escapeRegExp(shortcutDisplay(shortcut)), "u")
    )
    await expect(button).toHaveAttribute("aria-keyshortcuts", /.+/)
    await resetEditor(page, "#editor", initial)
    if (initial !== "") await selectEditorContents(page, "#editor")
    if (prompt !== undefined) acceptNextPrompt(page, prompt)
    await page.keyboard.press(shortcut)
    await expect(surface.locator("textarea[name='wikitext']")).toHaveValue(expected)
  }
})

const shortcutDisplay = (shortcut: string) => {
  if (shortcut.startsWith("Control+Shift+")) {
    return `Ctrl/Cmd+Shift+${shortcut.slice("Control+Shift+".length)}`
  }
  if (shortcut.startsWith("Control+")) {
    return `Ctrl/Cmd+${shortcut.slice("Control+".length)}`
  }
  return shortcut
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

test("all toolbar controls are keyboard reachable in DOM order and activatable", async ({
  page
}) => {
  const surface = await openMainEditor(page)
  const focusedActions: string[] = []

  for (
    let index = 0;
    index < 100 && focusedActions.length < expectedActions.length;
    index += 1
  ) {
    await page.keyboard.press("Tab")
    const action = await page.evaluate(() =>
      document.activeElement?.getAttribute("data-editor-action")
    )
    if (action && focusedActions[focusedActions.length - 1] !== action) {
      focusedActions.push(action)
    }
  }

  expect(focusedActions).toEqual(expectedActions)
  await expect(surface.locator("[data-editor-action='inline-math']")).toBeFocused()

  await resetEditor(page, "#editor", "Plain heading")
  await surface.locator("[data-editor-action='heading1']").focus()
  await page.keyboard.press("Space")
  await expect(surface.locator("textarea[name='wikitext']")).toHaveValue(
    "+ Plain heading"
  )
})

test("the toolbar is identical across main edit, creation, section edit, and append", async ({
  page
}) => {
  const toolbarSignature = async (surfaceSelector: string) =>
    page.locator(`${surfaceSelector} .wikitext-editor`).evaluate((element) => {
      const buttons = [...element.querySelectorAll("[data-editor-action]")].map(
        (button) => ({
          action: button.getAttribute("data-editor-action"),
          accessibleName: button.getAttribute("aria-label"),
          shortcuts: button.getAttribute("aria-keyshortcuts"),
          text: button.textContent,
          title: button.getAttribute("title")
        })
      )
      return {
        buttons,
        note: element.querySelector(".wikitext-editor-toolbar-note")?.textContent
      }
    })

  await openMainEditor(page)
  const mainSignature = await toolbarSignature("#editor")
  expect(mainSignature.buttons.map(({ action }) => action)).toEqual(expectedActions)
  expect(mainSignature.note).toContain("text source remains authoritative")

  await page.goto(`/${CREATE_SLUG}/edit/true`)
  await expectEditorReady(page, "#editor")
  expect(await toolbarSignature("#editor")).toEqual(mainSignature)

  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await openSectionControls(page)
  await page.locator("#edit-section-b-1").click()
  await expectEditorReady(page, "#edit-section-content")
  expect(await toolbarSignature("#edit-section-content")).toEqual(mainSignature)

  await openAppendPane(page)
  await expectEditorReady(page, "#page-append")
  expect(await toolbarSignature("#page-append")).toEqual(mainSignature)
})
