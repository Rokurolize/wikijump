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
const SLUG = "editor-codemirror-probe"
const EDITOR_PATH = `/${SLUG}/edit`

const pageWrites = async (request: import("@playwright/test").APIRequestContext) =>
  request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())

const pageSource = async (request: import("@playwright/test").APIRequestContext) =>
  request
    .get(`${FIXTURE_URL}/fixture-page-source?slug=${SLUG}`)
    .then((response) => response.json())
    .then((body) => body.wikitext as string)

const resetFixture = async (request: import("@playwright/test").APIRequestContext) => {
  await request.post(`${FIXTURE_URL}/clear-page-edit-locks`)
  await request.post(`${FIXTURE_URL}/reset-fixture-page?slug=${SLUG}`)
  await pageWrites(request)
}

const openEditor = async (page: import("@playwright/test").Page) => {
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto(EDITOR_PATH)
  await expect(page.locator(".wikitext-editor .cm-content")).toBeVisible({
    timeout: 30_000
  })
  await expect(page.locator(".wikitext-editor-fallback")).toBeHidden()
}

const replaceEditorText = async (page: import("@playwright/test").Page, text: string) => {
  await page.locator(".wikitext-editor .cm-content").click()
  await page.keyboard.press("Control+A")
  await page.keyboard.type(text)
  await expect(page.locator(".wikitext-editor-fallback")).toHaveValue(text)
}

const tokenBox = async (
  page: import("@playwright/test").Page,
  lineIndex: number,
  token: string
) =>
  page
    .locator(".wikitext-editor .cm-line")
    .nth(lineIndex)
    .evaluate((element, needle) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let seen = ""
      let node = walker.nextNode()
      while (node) {
        const text = node.textContent ?? ""
        const index = text.indexOf(needle, seen.length - text.length)
        if (index >= 0) {
          const range = document.createRange()
          range.setStart(node, index)
          range.setEnd(node, index + needle.length)
          const rect = range.getBoundingClientRect()
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        }
        seen += text
        node = walker.nextNode()
      }
      throw new Error(`token ${needle} is unavailable in line ${lineIndex}`)
    }, token)

const hoverToken = async (
  page: import("@playwright/test").Page,
  lineIndex: number,
  token: string
) => {
  const box = await tokenBox(page, lineIndex, token)
  await page.mouse.move(box.x + 3, box.y)
  await page.mouse.move(box.x, box.y)
  await page.waitForFunction(
    () => {
      const element = document.querySelector(".wikitext-assist-hover")
      return element !== null && element.getBoundingClientRect().height > 0
    },
    undefined,
    { timeout: 10_000 }
  )
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request)
})

test.afterEach(async ({ request }) => {
  await resetFixture(request)
})

test("explicit autocomplete is invoked with Mod-Space and can be dismissed without text loss", async ({
  page
}) => {
  await openEditor(page)
  await replaceEditorText(page, "[[")
  await expect(page.locator(".cm-tooltip-autocomplete")).toHaveCount(0)

  await page.keyboard.press("Control+Space")
  const tooltip = page.locator(".cm-tooltip-autocomplete")
  await expect(tooltip).toBeVisible({ timeout: 10_000 })
  await expect(tooltip).toContainText("div")
  await expect(tooltip).toContainText("module Rate")
  await expect(tooltip).toContainText("**strong text**")

  await page.keyboard.press("Escape")
  await expect(tooltip).toHaveCount(0)
  await expect(page.locator(".wikitext-editor-fallback")).toHaveValue("[[")
})

test("automatic completion appears while typing, accepts with Enter, and dismisses with Escape", async ({
  page
}) => {
  await openEditor(page)
  await replaceEditorText(page, "[[collapsible fol")
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 10_000 })
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("folded")

  await page.keyboard.press("Escape")
  await expect(page.locator(".cm-tooltip-autocomplete")).toHaveCount(0)
  await expect(page.locator(".wikitext-editor-fallback")).toHaveValue("[[collapsible fol")

  await page.keyboard.type('ded="true"]]Body')
  await expect(page.locator(".wikitext-editor-fallback")).toHaveValue(
    '[[collapsible folded="true"]]Body'
  )
  await page
    .locator("#editor button[type='submit'], #editor input[type='submit']")
    .click()
  await expect(page).toHaveURL(new RegExp(`/${SLUG}$`, "u"))
  const writes = await pageWrites(page.request)
  expect(writes.pageEdit.at(-1).params.wikitext).toBe('[[collapsible folded="true"]]Body')
})

test("accepting module and paired-block completions inserts only the missing source", async ({
  page
}) => {
  await openEditor(page)
  await replaceEditorText(page, "[[module Ra")
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 10_000 })
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("Rate")
  await page
    .locator(".cm-tooltip-autocomplete li")
    .filter({ hasText: "Rate" })
    .first()
    .click()
  await expect(page.locator(".wikitext-editor-fallback")).toHaveValue("[[module Rate")
  await page.keyboard.type("]]")
  await expect(page.locator(".wikitext-editor-fallback")).toHaveValue("[[module Rate]]")

  await replaceEditorText(page, "[[di")
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 10_000 })
  await page
    .locator(".cm-tooltip-autocomplete li")
    .filter({ hasText: "div (paired)" })
    .click()
  await expect(page.locator(".wikitext-editor-fallback")).toHaveValue(
    "[[div]]\n\n[[/div]]"
  )
})

test("hover help describes a module, an argument, and a block", async ({ page }) => {
  await openEditor(page)
  await replaceEditorText(page, '[[module Rate]]\n[[collapsible folded="true"]]\n[[div]]')

  await hoverToken(page, 0, "Rate")
  await expect(page.locator(".wikitext-assist-hover")).toContainText("Rate — module")

  await hoverToken(page, 1, "folded")
  await expect(page.locator(".wikitext-assist-hover-title")).toHaveText(
    "collapsible.folded — argument"
  )
  await expect(page.locator(".wikitext-assist-hover")).toContainText("type: bool")

  await hoverToken(page, 2, "div")
  await expect(page.locator(".wikitext-assist-hover-title")).toHaveText("div — block")
  await expect(page.locator(".wikitext-assist-hover")).toContainText("body: elements")
})

test("broken wikitext degrades gracefully across completion, hover, and diagnostics", async ({
  page
}) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  const broken = '[[module [[[[ %%no-close\n[[collapsible hideLocation="\n]]] stray [[['
  await openEditor(page)
  await replaceEditorText(page, broken)
  await expect(page.locator(".wikitext-editor .cm-content")).toBeVisible()
  await expect(page.locator(".wikitext-editor-fallback")).toHaveValue(broken)

  await page.keyboard.press("Control+Space")
  await expect(page.locator(".wikitext-editor .cm-content")).toBeVisible()
  await page.keyboard.press("Escape")

  const lastLine = await page.locator(".wikitext-editor .cm-line").last().boundingBox()
  expect(lastLine).not.toBeNull()
  await page.mouse.move(lastLine!.x + 20, lastLine!.y + lastLine!.height / 2)
  await expect(page.locator(".wikitext-editor .cm-content")).toBeVisible()

  const notice = page.locator(".wikitext-editor-hint-notice")
  await expect(notice).toBeVisible({ timeout: 10_000 })
  await expect(notice).toContainText("not render errors")
  expect(await page.locator(".cm-lintRange-error").count()).toBe(0)
  expect(pageErrors).toEqual([])
})

test("a heuristic warning never blocks a valid literal block from rendering or saving", async ({
  page,
  request
}) => {
  const source = ["[[code]]", "[[literal unclosed-looking text", "[[/code]]"].join("\n")
  await openEditor(page)
  await replaceEditorText(page, source)
  await expect(page.locator(".wikitext-editor-hint-notice")).toBeVisible({
    timeout: 10_000
  })
  await expect(page.locator(".cm-wikitext-heuristic")).toHaveCount(1)
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(0)

  const hint = page.locator(".cm-lintRange-warning").first()
  await hint.hover()
  await expect(page.locator(".cm-tooltip-lint")).toContainText(
    "Editor heuristic (not a render error)"
  )
  await page.keyboard.press("Escape")

  await expect(page.locator("#edit-preview-status")).toHaveText(
    "Preview is up to date.",
    {
      timeout: 10_000
    }
  )
  await expect(page.locator("#live-preview-body")).toContainText(
    "[[literal unclosed-looking text"
  )
  await page
    .locator("#editor button[type='submit'], #editor input[type='submit']")
    .click()
  await expect(page).toHaveURL(new RegExp(`/${SLUG}$`, "u"))
  expect(await pageSource(request)).toBe(source)
  const writes = await pageWrites(request)
  expect(writes.pageEdit.at(-1).params.wikitext).toBe(source)
})
