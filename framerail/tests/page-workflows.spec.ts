import {
  expect,
  installNativeEventListenerProbe,
  test,
  waitForNativeEventListener,
  waitForSvelteDelegatedHandler
} from "./hermetic-playwright"

import type { APIResponse } from "./hermetic-playwright"

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

async function expectSuccessfulAction(response: APIResponse) {
  const body = await response.text()
  expect(response.ok(), body).toBe(true)
  expect(body).toContain('"type":"success"')
}

test("article routes carry load and mutation context through Deepwell", async ({
  request
}) => {
  await request.get(`${FIXTURE_URL}/last-article-read-requests`)
  const article = await request.get("/page-workflow-probe", {
    headers: SITE_HEADERS
  })
  const cachedArticle = await request.get("/page-workflow-probe", {
    headers: SITE_HEADERS
  })
  expect(article.ok()).toBe(true)
  expect(article.headers()["x-content-type-options"]).toBe("nosniff")
  expect(cachedArticle.ok()).toBe(true)
  expect(await cachedArticle.text()).toBe(await article.text())
  expect(await article.text()).toContain("Page workflow probe")

  const loadRequests = await request
    .get(`${FIXTURE_URL}/last-article-read-requests`)
    .then((response) => response.json())
  const requestsForProbe = (requests: { route: { slug: string } }[]) =>
    requests.filter(({ route }) => route.slug === "page-workflow-probe")
  expect(requestsForProbe(loadRequests.articleView)).toHaveLength(1)
  expect(requestsForProbe(loadRequests.articleViewCacheMetadata)).toHaveLength(2)

  await expectSuccessfulAction(
    await request.post("/page-workflow-probe?/voteGet", {
      headers: {
        ...AUTHENTICATED_HEADERS,
        "content-type": "text/plain;charset=UTF-8"
      },
      data: JSON.stringify({
        siteId: 6000005,
        pageId: 3000340,
        slug: "page-workflow-probe"
      })
    })
  )

  await expectSuccessfulAction(
    await request.post("/page-workflow-probe?/edit", {
      headers: AUTHENTICATED_HEADERS,
      multipart: {
        siteId: "6000005",
        pageId: "3000340",
        lastRevisionId: "9000340",
        title: "Page Workflow Probe",
        altTitle: "",
        wikitext: "Cross-layer edit",
        tags: "fixture",
        comments: "route edit"
      }
    })
  )
  await expectSuccessfulAction(
    await request.post("/page-workflow-probe?/fileRestore", {
      headers: AUTHENTICATED_HEADERS,
      multipart: {
        siteId: "6000005",
        pageId: "3000340",
        lastRevisionId: "41",
        fileId: "42",
        newPage: "",
        newName: "",
        comments: "route file restore"
      }
    })
  )
  await expectSuccessfulAction(
    await request.post("/page-workflow-probe?/voteCast", {
      headers: {
        ...AUTHENTICATED_HEADERS,
        "content-type": "text/plain;charset=UTF-8"
      },
      data: JSON.stringify({
        siteId: 6000005,
        pageId: 3000340,
        value: 1
      })
    })
  )
  await expectSuccessfulAction(
    await request.post("/page-workflow-probe?/rollback", {
      headers: {
        ...AUTHENTICATED_HEADERS,
        "content-type": "text/plain;charset=UTF-8"
      },
      data: JSON.stringify({
        siteId: 6000005,
        pageId: 3000340,
        revisionNumber: 1,
        lastRevisionId: 9100000,
        comments: "route rollback"
      })
    })
  )

  const pageRequests = await request
    .get(`${FIXTURE_URL}/last-page-write-requests`)
    .then((response) => response.json())
  const fileRequests = await request
    .get(`${FIXTURE_URL}/last-file-requests`)
    .then((response) => response.json())
  const pageReadRequests = await request
    .get(`${FIXTURE_URL}/last-page-read-requests`)
    .then((response) => response.json())

  expect(fileRequests.pageGetFiles).toContainEqual(
    expect.objectContaining({
      headers: {
        page: "page-workflow-probe",
        sessionToken: "fixture-session-token",
        siteId: "6000005"
      },
      params: {
        deleted: false,
        page_id: 3000340,
        site_id: 6000005
      }
    })
  )
  expect(pageReadRequests.voteList).toContainEqual(
    expect.objectContaining({
      headers: {
        page: "page-workflow-probe",
        sessionToken: "fixture-session-token",
        siteId: "6000005"
      },
      params: expect.objectContaining({
        id: 3000340,
        type: "Page"
      })
    })
  )

  expect(pageRequests.pageEdit).toContainEqual(
    expect.objectContaining({
      headers: {
        page: "page-workflow-probe",
        sessionToken: "fixture-session-token",
        siteId: "6000005"
      },
      params: expect.objectContaining({
        page: 3000340,
        wikitext: "Cross-layer edit"
      })
    })
  )
  expect(pageRequests.voteSet).toContainEqual(
    expect.objectContaining({
      headers: {
        page: "page-workflow-probe",
        sessionToken: "fixture-session-token",
        siteId: "6000005"
      },
      params: {
        page_id: 3000340,
        value: 1
      }
    })
  )
  expect(pageRequests.pageRollback).toContainEqual(
    expect.objectContaining({
      headers: {
        page: "page-workflow-probe",
        sessionToken: "fixture-session-token",
        siteId: "6000005"
      },
      params: expect.objectContaining({
        page: 3000340,
        revision_number: 1
      })
    })
  )
  expect(fileRequests.fileRestore).toContainEqual(
    expect.objectContaining({
      headers: {
        page: "page-workflow-probe",
        sessionToken: "fixture-session-token",
        siteId: "6000005"
      },
      params: expect.objectContaining({
        file_id: 42,
        page_id: 3000340
      })
    })
  )
})

test("autonumbered page creation follows the assigned slug", async ({ page }) => {
  await installNativeEventListenerProbe(page)
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto("/autonumber-requested/edit/true")
  await waitForNativeEventListener(page, "#editor", "submit")

  await page.locator("input[name='title']").fill("Autonumber browser test")
  await page.locator("textarea[name='wikitext']").fill("Assigned page body")
  await page.locator("textarea[name='comments']").fill("create")
  await page.getByRole("button", { name: "save", exact: true }).click()

  await expect(page).toHaveURL(/\/104$/u)
  await expect(page.locator("#page-content")).toContainText("Assigned page body")
})

test("history ignores a stale revision diff response", async ({ page, request }) => {
  await request.get(`${FIXTURE_URL}/last-page-read-requests`)
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto("/authoring-history-probe")
  await waitForSvelteDelegatedHandler(page, "#history-button")
  await page.getByRole("link", { name: "history", exact: true }).click()
  await expect(page.locator(".revision-diff-controls")).toBeVisible()

  const fromRevision = page.locator("#revision-diff-from")
  const toRevision = page.locator("#revision-diff-to")
  await page.locator(".revision-diff-controls button").nth(1).click()
  await expect
    .poll(async () => {
      const response = await request.get(`${FIXTURE_URL}/page-revision-diff-requests`)
      return (await response.json()).length
    })
    .toBe(1)

  await fromRevision.selectOption("2")
  await toRevision.selectOption("1")
  await page.locator(".revision-diff-controls button").nth(1).click()

  await expect
    .poll(async () => {
      const response = await request.get(`${FIXTURE_URL}/page-revision-diff-requests`)
      return (await response.json()).length
    })
    .toBe(2)
  const requests = await request
    .get(`${FIXTURE_URL}/page-revision-diff-requests`)
    .then((response) => response.json())
  expect(requests).toEqual([
    {
      site_id: 6000005,
      page_id: 3000345,
      from_revision_number: 1,
      to_revision_number: 2
    },
    {
      site_id: 6000005,
      page_id: 3000345,
      from_revision_number: 2,
      to_revision_number: 1
    }
  ])

  const diff = page.locator(".revision-diff")
  await expect(diff).toContainText("NEW CURRENT DIFF")

  const release = await request.get(
    `${FIXTURE_URL}/release-page-revision-diff?outcome=success`
  )
  expect(await release.json()).toEqual({ released: true })
  await expect(page.locator("#odialog-container")).toHaveCount(0)
  await expect(diff).toContainText("NEW CURRENT DIFF")
  await expect(diff).not.toContainText("OLD STALE DIFF")
})

test("history diff keeps added and removed source readable against its semantic colors", async ({ page, request }) => {
  await request.get(`${FIXTURE_URL}/last-page-read-requests`)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto("/authoring-history-probe")
  await waitForSvelteDelegatedHandler(page, "#history-button")
  await page.getByRole("link", { name: "history", exact: true }).click()
  await page.locator("#revision-diff-from").selectOption("2")
  await page.locator("#revision-diff-to").selectOption("1")
  await page.locator(".revision-diff-controls button").nth(1).click()

  const added = page.locator("#action-area .revision-diff-line.added").first()
  const removed = page.locator("#action-area .revision-diff-line.removed").first()
  const unchanged = page.locator("#action-area .revision-diff-line.unchanged").first()
  await expect
    .poll(async () => {
      const response = await request.get(`${FIXTURE_URL}/page-revision-diff-requests`)
      return (await response.json()).length
    })
    .toBe(1)
  await expect(added).toBeVisible()
  await expect(removed).toBeVisible()
  await expect(unchanged).toBeVisible()
  await page.addStyleTag({
    content: `#action-area .revision-diff-line { white-space: pre !important; }`
  })
  await expect
    .poll(async () => added.evaluate((element) => getComputedStyle(element).whiteSpace))
    .toBe("pre-wrap")
  await expect
    .poll(async () => added.evaluate((element) => {
      const parent = element.parentElement
      return parent ? parent.scrollWidth <= parent.clientWidth : false
    }))
    .toBe(true)
  await expect
    .poll(async () => added.evaluate((element) => getComputedStyle(element).color))
    .toBe("rgb(23, 52, 33)")
  await expect
    .poll(async () => added.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(220, 255, 220)")
  await expect
    .poll(async () => removed.evaluate((element) => getComputedStyle(element).color))
    .toBe("rgb(74, 32, 32)")
  await expect
    .poll(async () => removed.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(255, 225, 225)")
})

test("mobile history presents all revision details as readable in-viewport cards", async ({ page }) => {
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto("/authoring-history-probe")
    // This is the legacy mobile History label treatment used by several real
    // upstream themes. It targets only the first data row and is injected
    // after the app styles, as a theme candidate is during acceptance replay.
    await page.addStyleTag({
      content: `@media (max-width: 600px) {
        table.page-history tr:nth-of-type(2) td:not(:nth-of-type(7)):before {
          position: absolute !important;
          top: calc(-100% - .5em) !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
          background: rgb(133, 0, 5) !important;
          color: white !important;
          font-size: 9.5px !important;
          display: flex !important;
        }
      }`
    })
    await waitForSvelteDelegatedHandler(page, "#history-button")
    await page.getByRole("link", { name: "history", exact: true }).click()
    await expect(page.locator(".revision-list")).toBeVisible()

    const layout = await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>(".revision-list")
      const row = document.querySelector<HTMLElement>(".revision-list .revision-row")
      const fields = [...document.querySelectorAll<HTMLElement>(
        ".revision-list .revision-row .revision-type, .revision-list .revision-row .user, .revision-list .revision-row .created-at, .revision-list .revision-row .comments"
      )]
      return {
        viewport_width: window.innerWidth,
        document_width: document.documentElement.scrollWidth,
        list_display: list ? getComputedStyle(list).display : null,
        list_overflow_x: list ? getComputedStyle(list).overflowX : null,
        list_client_width: list?.clientWidth ?? 0,
        list_scroll_width: list?.scrollWidth ?? 0,
        row_bounds: row ? row.getBoundingClientRect().toJSON() : null,
        field_labels: fields.map((field) => ({
          label: field.getAttribute("data-label"),
          before: getComputedStyle(field, "::before").content,
          pseudo_position: getComputedStyle(field, "::before").position,
          pseudo_background: getComputedStyle(field, "::before").backgroundColor,
          pseudo_color: getComputedStyle(field, "::before").color,
          text_color: getComputedStyle(field).color,
          revision: field.closest(".revision-row")?.getAttribute("data-id"),
          bounds: field.getBoundingClientRect().toJSON()
        }))
      }
    })

    expect(layout.document_width).toBeLessThanOrEqual(layout.viewport_width)
    expect(layout.list_display).toBe("block")
    expect(layout.list_overflow_x).toBe("visible")
    expect(layout.list_scroll_width).toBeLessThanOrEqual(layout.list_client_width + 1)
    expect(layout.row_bounds?.x).toBeGreaterThanOrEqual(0)
    expect(layout.row_bounds?.right).toBeLessThanOrEqual(layout.viewport_width)
    expect(layout.field_labels).toHaveLength(8)
    for (const field of layout.field_labels) {
      expect(field.label).toBeTruthy()
      expect(field.before).not.toBe("none")
      expect(field.pseudo_position).toBe("static")
      expect(field.pseudo_background).toBe("rgba(0, 0, 0, 0)")
      expect(field.pseudo_color).toBe(field.text_color)
      expect(field.bounds.x).toBeGreaterThanOrEqual(0)
      expect(field.bounds.right).toBeLessThanOrEqual(layout.viewport_width)
      expect(field.bounds.width).toBeGreaterThan(layout.viewport_width * 0.7)
    }
    const firstRevisionId = layout.field_labels[0]?.revision
    const firstRevision = layout.field_labels.filter((field) => field.revision === firstRevisionId)
    for (let index = 1; index < firstRevision.length; index += 1) {
      expect(firstRevision[index - 1].bounds.bottom).toBeLessThanOrEqual(firstRevision[index].bounds.top)
    }
  }
})

test("desktop and tablet History keep author and revision actions readable", async ({ page }) => {
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  for (const width of [1440, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/authoring-history-probe")
    // Reproduce a common imported-theme pattern: named grid lines are applied
    // to the legacy History table. The SCP-JP action pane must map its semantic
    // cells back to a non-overlapping layout without replacing theme colors.
    await page.addStyleTag({
      content: `
        #action-area .revision-list .page-history tr.revision-row,
        #action-area .revision-list .page-history tr.revision-header {
          grid-template-columns: 3rem 0 4.5rem minmax(7rem, .9fr) minmax(9rem, 1fr) minmax(10rem, 1.4fr) !important;
        }
        #action-area .revision-list .page-history .revision-number { grid-column: rev-num !important; }
        #action-area .revision-list .page-history .action { grid-column: rev-actions !important; }
        #action-area .revision-list .page-history .revision-type { grid-column: rev-flags !important; }
        #action-area .revision-list .page-history .created-at { grid-column: rev-user !important; }
      `
    })
    await waitForSvelteDelegatedHandler(page, "#history-button")
    await page.locator("#history-button").click()
    await expect(page.locator(".revision-list .page-history tbody tr.revision-row").first()).toBeVisible()

    const layout = await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>(".revision-list .page-history tbody tr.revision-row")!
      const action = row.querySelector<HTMLElement>(".revision-attribute.action")!
      const links = [...action.querySelectorAll<HTMLElement>("a")]
      const user = row.querySelector<HTMLElement>(".revision-attribute.user")!
      const cells = [...row.querySelectorAll<HTMLElement>("td.revision-attribute")]
      const rowRect = row.getBoundingClientRect()
      const actionRects = links.map((link) => link.getBoundingClientRect())
      return {
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        overflowing: [...document.querySelectorAll<HTMLElement>("body *")]
          .map((element) => ({
            selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${
              [...element.classList].map((name) => `.${name}`).join("")
            }`,
            x: element.getBoundingClientRect().x,
            right: element.getBoundingClientRect().right,
            width: element.getBoundingClientRect().width,
            scrollWidth: element.scrollWidth
          }))
          .filter((element) => element.right > innerWidth + 1 || element.x < -1)
          .sort((a, b) => b.right - a.right)
          .slice(0, 8),
        row: rowRect.toJSON(),
        rowDisplay: getComputedStyle(row).display,
        user: user.getBoundingClientRect().toJSON(),
        userWhiteSpace: getComputedStyle(user).whiteSpace,
        actionRects,
        cellRects: cells.map((cell) => ({ name: cell.className, ...cell.getBoundingClientRect().toJSON() }))
      }
    })

    expect(layout.rowDisplay).toBe("grid")
    expect(layout.document, JSON.stringify(layout.overflowing)).toBeLessThanOrEqual(layout.viewport)
    expect(layout.row.x).toBeGreaterThanOrEqual(0)
    expect(layout.row.right).toBeLessThanOrEqual(layout.viewport)
    expect(layout.user.width).toBeGreaterThanOrEqual(100)
    expect(layout.actionRects.length).toBeGreaterThanOrEqual(3)
    expect(layout.actionRects[0].top).toBeCloseTo(layout.actionRects[1].top, 0)
    expect(layout.actionRects[1].top).toBeCloseTo(layout.actionRects[2].top, 0)
    for (let left = 0; left < layout.cellRects.length; left++) {
      for (let right = left + 1; right < layout.cellRects.length; right++) {
        const a = layout.cellRects[left]
        const b = layout.cellRects[right]
        const intersects = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
        expect(intersects, `${a.name} ${JSON.stringify(a)} intersects ${b.name} ${JSON.stringify(b)} at ${width}px`).toBe(false)
      }
    }
  }
})

test("mobile Files pane keeps long Japanese filenames and actions horizontally accessible", async ({ page }) => {
  const filename =
    "theme-lab-visual-fixture_日本語長名_320px_readability_and_download_controls.txt"
  await page.setViewportSize({ width: 390, height: 844 })
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto("/page-workflow-probe")
  await waitForSvelteDelegatedHandler(page, "#files-button")
  await page.locator("#files-button").click()

  const list = page.locator(".file-list-scroll")
  await expect(list).toBeVisible()
  await expect(list).toContainText(filename)
  const geometry = await page.evaluate(() => ({
    viewport_width: window.innerWidth,
    document_width: document.documentElement.scrollWidth,
    list_width: document.querySelector<HTMLElement>(".file-list-scroll")?.clientWidth,
    table_width: document.querySelector<HTMLElement>(".file-list")?.scrollWidth,
    list_tab_index: document.querySelector(".file-list-scroll")?.getAttribute("tabindex")
  }))

  expect(geometry.document_width).toBeLessThanOrEqual(geometry.viewport_width)
  expect(geometry.table_width).toBeGreaterThan(geometry.list_width ?? 0)
  expect(geometry.list_tab_index).toBe("0")
  await page.setViewportSize({ width: 320, height: 800 })
  const narrowFilename = page.locator(".file-row .file-name a").last()
  const narrowGeometry = await narrowFilename.evaluate((anchor) => {
    const range = document.createRange()
    range.selectNodeContents(anchor)
    return {line_count: range.getClientRects().length, client_width: anchor.parentElement?.clientWidth ?? 0, overflow_width: anchor.scrollWidth}
  })
  expect(narrowGeometry.line_count).toBeGreaterThan(1)
  expect(narrowGeometry.overflow_width).toBeLessThanOrEqual(narrowGeometry.client_width)
  await list.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  await expect(page.locator(".file-row a").last()).toBeVisible()
})

test("mobile edit-permission dialog keeps its message and close control in the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.goto("/authoring-history-probe")
  await waitForSvelteDelegatedHandler(page, "#history-button")
  await page.locator("#more-options-button").click()
  await expect(page.locator("#view-source-button")).toBeVisible()
  await page.locator("#edit-button").click()

  const dialog = page.locator("#odialog-container .owindow.error")
  const close = page.locator("#odialog-container .button-close-message")
  await expect(dialog).toBeVisible()
  await expect(close).toBeVisible()

  const layout = await page.evaluate(() => {
    const modal = document.querySelector<HTMLElement>("#odialog-container .owindow.error")!
    const message = modal.querySelector<HTMLElement>("#modal-title")!
    const buttonBar = modal.querySelector<HTMLElement>(".button-bar")!
    const close = modal.querySelector<HTMLElement>(".button-close-message")!
    const rect = (element: HTMLElement) => {
      const { x, y, right, bottom, width, height } = element.getBoundingClientRect()
      return { x, y, right, bottom, width, height }
    }
    return {
      viewport_width: window.innerWidth,
      document_width: document.documentElement.scrollWidth,
      modal: rect(modal),
      message: rect(message),
      message_scroll_width: message.scrollWidth,
      message_client_width: message.clientWidth,
      button_bar: rect(buttonBar),
      button_bar_scroll_width: buttonBar.scrollWidth,
      close: rect(close)
    }
  })

  expect(layout.document_width).toBeLessThanOrEqual(layout.viewport_width)
  expect(layout.modal.x).toBeGreaterThanOrEqual(0)
  expect(layout.modal.right).toBeLessThanOrEqual(layout.viewport_width)
  expect(layout.message_scroll_width).toBeLessThanOrEqual(layout.message_client_width)
  expect(layout.button_bar_scroll_width).toBeLessThanOrEqual(layout.button_bar.width + 1)
  expect(layout.close.x).toBeGreaterThanOrEqual(layout.modal.x)
  expect(layout.close.right).toBeLessThanOrEqual(layout.modal.right)
  await close.click()
  await expect(dialog).toHaveCount(0)
})

test("history ignores a stale successful diff after page navigation", async ({
  page,
  request
}) => {
  await request.get(`${FIXTURE_URL}/last-page-read-requests`)
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto("/authoring-history-probe")
  await waitForSvelteDelegatedHandler(page, "#history-button")
  await page.getByRole("link", { name: "history", exact: true }).click()
  await expect(page.locator(".revision-diff-controls")).toBeVisible()
  await page.locator(".revision-diff-controls button").nth(1).click()
  await expect
    .poll(async () => {
      const response = await request.get(`${FIXTURE_URL}/page-revision-diff-requests`)
      return (await response.json()).length
    })
    .toBe(1)

  await page.locator("#navigate-history-target").click()
  await expect(page).toHaveURL(/\/scp-173$/u)
  await expect(page.locator("#page-title")).toHaveText("SCP-173")
  await expect(page.locator(".revision-diff-controls")).toBeVisible()

  const release = await request.get(
    `${FIXTURE_URL}/release-page-revision-diff?outcome=success`
  )
  expect(await release.json()).toEqual({ released: true })
  await expect(page.locator(".revision-diff")).toHaveCount(0)
  await expect(page.locator("#odialog-container")).toHaveCount(0)
})

test("history ignores a stale failure after page navigation", async ({
  page,
  request
}) => {
  await request.get(`${FIXTURE_URL}/last-page-read-requests`)
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto("/authoring-history-probe")
  await waitForSvelteDelegatedHandler(page, "#history-button")
  await page.getByRole("link", { name: "history", exact: true }).click()
  await expect(page.locator(".revision-diff-controls")).toBeVisible()
  await page.locator(".revision-diff-controls button").nth(1).click()
  await expect
    .poll(async () => {
      const response = await request.get(`${FIXTURE_URL}/page-revision-diff-requests`)
      return (await response.json()).length
    })
    .toBe(1)

  await page.locator("#navigate-history-target").click()
  await expect(page).toHaveURL(/\/scp-173$/u)
  await expect(page.locator("#page-title")).toHaveText("SCP-173")
  await expect(page.locator(".revision-diff-controls")).toBeVisible()

  const release = await request.get(
    `${FIXTURE_URL}/release-page-revision-diff?outcome=failure`
  )
  expect(await release.json()).toEqual({ released: true })
  await expect(page.locator(".revision-diff")).toHaveCount(0)
  await expect(page.locator("#odialog-container")).toHaveCount(0)
})
