import { expect, test, type Page } from "./hermetic-playwright"

const FIXTURE_URL = `http://127.0.0.1:${process.env.PLAYWRIGHT_FIXTURE_PORT ?? "42747"}`
const AUTHENTICATED_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki",
  cookie: "wikijump_token=fixture-session-token"
}
const WIKI_SLUG = "data-form-checkbox-wiki-flow:example"
const BUDGET_SLUG = "data-form-ed8-flow:example"

const waitForHydration = async (page: Page) => {
  await page.waitForFunction(() => {
    const element = document.querySelector<HTMLAnchorElement>("#edit-save-button")
    if (!element) return false
    return Object.getOwnPropertySymbols(element).some((symbol) => {
      if (symbol.description !== "events") return false
      const handlers = (element as unknown as Record<symbol, { click?: unknown }>)[symbol]
      return typeof handlers?.click === "function"
    })
  })
}

const openEditor = async (page: Page, slug: string) => {
  await page.goto(`/${slug}/edit/true`)
  await waitForHydration(page)
  await expect(page.locator("#edit-page-form")).toBeVisible()
}

const replaceEditorText = async (page: Page, text: string) => {
  const content = page.locator(".field-body .cm-content")
  await expect(content).toBeVisible()
  await content.click()
  await page.keyboard.press("ControlOrMeta+A")
  await page.keyboard.type(text)
}

const drainPreviewRequests = async (
  request: import("@playwright/test").APIRequestContext
) =>
  request
    .get(`${FIXTURE_URL}/last-page-preview-requests`)
    .then((response) => response.json())

test.beforeEach(async ({ page, request }) => {
  await request.get(`${FIXTURE_URL}/last-page-write-requests`)
  await drainPreviewRequests(request)
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
})

test("long-text wiki fields get the shared editor while other controls stay literal", async ({
  page
}) => {
  await openEditor(page, WIKI_SLUG)

  const editor = page.locator(".field-wiki .wikitext-editor")
  await expect(editor).toHaveClass(/wikitext-editor-enhanced/u)
  await expect(page.locator(".field-wiki .cm-content")).toBeVisible()
  await expect(page.locator("textarea[name='field-wiki']")).toBeHidden()
  await expect(
    page.locator(".field-wiki .wikitext-editor-toolbar button")
  ).not.toHaveCount(0)
  await expect(page.locator(".field-wiki .cm-line")).toContainText("**Default**")

  const content = page.locator(".field-wiki .cm-content")
  await content.click()
  await page.keyboard.press("ControlOrMeta+A")
  await page.keyboard.type("[[module Rate]]")
  await expect(page.locator(".field-wiki .cm-content .tok-keyword")).not.toHaveCount(0)

  await page.keyboard.press("ControlOrMeta+A")
  await page.keyboard.type("[[di")
  await expect(page.locator(".field-wiki .cm-tooltip-autocomplete")).toBeVisible()
  await page
    .locator(".field-wiki .cm-tooltip-autocomplete li")
    .filter({ hasText: "div (paired)" })
    .first()
    .click()
  await expect(page.locator("textarea[name='field-wiki']")).toHaveValue(
    "[[div]]\n\n[[/div]]"
  )

  await page.keyboard.press("ControlOrMeta+A")
  await page.locator(".field-wiki button[data-editor-action='bold']").click()
  await expect(page.locator("textarea[name='field-wiki']")).toHaveValue(
    "**[[div]]\n\n[[/div]]**"
  )

  await expect(page.locator("input[name='field-wiki_one_line']")).toHaveClass(
    "form-control form-wiki"
  )
  await expect(page.locator("input[name='field-wiki_one_line']")).toHaveAttribute(
    "size",
    "20"
  )
  await expect(page.locator(".field-wiki_one_line .cm-editor")).toHaveCount(0)
  await expect(page.locator("input[name='field-checkbox_unchecked']")).toHaveClass(
    "form-checkbox"
  )
  await expect(page.locator("input[name='field-checkbox_unchecked']")).toHaveAttribute(
    "type",
    "checkbox"
  )
})

test("plain multi-line text fields keep their literal textarea control", async ({
  page
}) => {
  await openEditor(page, "data-form-controls-flow:example")

  const multi = page.locator("textarea[name='field-multi']")
  await expect(multi).toHaveClass("form-control form-text")
  await expect(multi).toHaveAttribute("rows", "3")
  await expect(multi).toHaveAttribute("cols", "50")
  await expect(page.locator(".field-multi .cm-editor")).toHaveCount(0)
  await expect(page.locator(".field-multi .wikitext-editor-toolbar")).toHaveCount(0)
})

test("adversarial long-text content serializes exact bytes without corrupting neighbours", async ({
  page,
  request
}) => {
  await openEditor(page, BUDGET_SLUG)
  await page.locator("input[name='field-matched']").fill("a")
  await page.locator("input[name='field-matched_two']").fill("aa")

  const adversarial = [
    "intro: not a field boundary",
    "quoted \"double\" and 'single' with \\ backslash",
    "# hash and [[[start|Home]]] are literal here",
    "[[div]]",
    "[[/div]]"
  ].join("\n")
  await replaceEditorText(page, adversarial)
  await expect(page.locator("textarea[name='field-body']")).toHaveValue(adversarial)

  await page.locator("#edit-save-button").click()
  await expect
    .poll(async () => {
      const writes = await request
        .get(`${FIXTURE_URL}/last-page-write-requests`)
        .then((response) => response.json())
      return writes.pageCreate.find(
        (entry: { params: { slug?: string } }) => entry.params.slug === BUDGET_SLUG
      )
    })
    .toMatchObject({
      params: {
        wikitext: [
          `body: "intro: not a field boundary\\nquoted \\"double\\" and 'single' with \\\\ backslash\\n# hash and [[[start|Home]]] are literal here\\n[[div]]\\n[[/div]]"`,
          "matched: a",
          "matched_two: aa"
        ].join("\n")
      }
    })
})

test("field validation stays inside the browser budget with the shared editor mounted", async ({
  page,
  request
}) => {
  await openEditor(page, BUDGET_SLUG)
  await replaceEditorText(page, "[[div]]\nvalid wiki body")
  await page.locator("input[name='field-matched']").fill(`${"a".repeat(28)}!`)
  await page.locator("input[name='field-matched_two']").fill(`${"a".repeat(28)}!`)

  const validationStartedAt = Date.now()
  await page.locator("#edit-save-button").click()
  for (const name of ["matched", "matched_two"]) {
    await expect(page.locator(`.field-${name} .form-message`)).toHaveText(
      "Wikijump could not safely evaluate this field."
    )
  }
  const elapsed = Date.now() - validationStartedAt
  console.info(`ED-8 browser validation budget with shared editor: ${elapsed} ms`)
  expect(elapsed).toBeLessThan(450)

  await page.locator("#edit-page-title").fill("Editor remains responsive")
  await expect(page.locator("#edit-page-title")).toHaveValue("Editor remains responsive")
  const writes = await request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())
  expect(
    writes.pageCreate.find(
      (entry: { params: { slug?: string } }) => entry.params.slug === BUDGET_SLUG
    )
  ).toBeUndefined()
})

test("long-text data-form editing exposes the same composed-source live preview", async ({
  page,
  request
}) => {
  await openEditor(page, BUDGET_SLUG)
  await expect(page.locator(".wikitext-live-preview")).toHaveCount(1)
  await expect(page.locator("#edit-preview-status")).toHaveText(
    "Preview is up to date.",
    { timeout: 10_000 }
  )
  await drainPreviewRequests(request)

  await replaceEditorText(page, "**Live** preview body")
  await page.locator("input[name='field-matched']").fill("a")
  await page.locator("input[name='field-matched_two']").fill("aa")
  await expect(page.locator("#edit-preview-status")).toHaveText(
    "Preview is up to date.",
    { timeout: 10_000 }
  )
  await expect(page.locator("#live-preview-body")).toContainText("Live preview body")

  const previewRequests = await drainPreviewRequests(request)
  expect(previewRequests.at(-1)).toEqual(
    expect.objectContaining({
      headers: expect.objectContaining({ page: BUDGET_SLUG }),
      params: expect.objectContaining({
        site_id: 6000005,
        wikitext: ["body: '**Live** preview body'", "matched: a", "matched_two: aa"].join(
          "\n"
        )
      })
    })
  )
})
