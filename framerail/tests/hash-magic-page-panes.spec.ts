import { expect, test } from "@playwright/test"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

type HashMagicTimelineEntry = {
  actionAreaDisplay: string | null
  event: string
  hash: string
  pane: "files" | "history" | "loading" | "none"
  performanceNow: number
}

type HashMagicWindow = Window & {
  __hashMagicTimeline?: HashMagicTimelineEntry[]
}

const installHashMagicTimeline = async (page: import("@playwright/test").Page) => {
  await page.addInitScript(() => {
    const target = window as HashMagicWindow
    const timeline: HashMagicTimelineEntry[] = []
    target.__hashMagicTimeline = timeline
    let lastSignature = ""

    const snapshot = (event: string): HashMagicTimelineEntry => {
      const actionArea = document.querySelector<HTMLElement>("#action-area")
      let pane: HashMagicTimelineEntry["pane"] = "none"
      if (actionArea?.querySelector(".page-revision-header")) pane = "history"
      else if (actionArea?.querySelector(".page-file-header")) pane = "files"
      else if (actionArea?.querySelector(".pane-loading")) pane = "loading"

      return {
        actionAreaDisplay: actionArea ? getComputedStyle(actionArea).display : null,
        event,
        hash: location.hash,
        pane,
        performanceNow: performance.now()
      }
    }

    const record = (event: string) => {
      const entry = snapshot(event)
      const signature = JSON.stringify([entry.hash, entry.pane, entry.actionAreaDisplay])
      if (event === "mutation" && signature === lastSignature) return
      lastSignature = signature
      timeline.push(entry)
    }

    document.addEventListener(
      "DOMContentLoaded",
      () => {
        record("DOMContentLoaded")
        new MutationObserver(() => record("mutation")).observe(document.documentElement, {
          attributes: true,
          childList: true,
          subtree: true
        })
      },
      { once: true }
    )
    addEventListener("load", () => record("load"), { once: true })
    addEventListener("hashchange", () => record("hashchange"))
    addEventListener("popstate", () => record("popstate"))
  })
}

const timeline = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as HashMagicWindow).__hashMagicTimeline ?? [])

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await installHashMagicTimeline(page)
})

test("Hash Magic opens history and files only during document initialization", async ({
  page
}) => {
  await page.goto("/scp-173#_HiStOrY/p/2")
  await expect(page.locator("#action-area .page-revision-header")).toBeVisible()
  await expect(page).toHaveURL(/\/scp-173#_HiStOrY\/p\/2$/u)

  const initialTimeline = await timeline(page)
  expect(initialTimeline).toContainEqual(
    expect.objectContaining({ event: "DOMContentLoaded", pane: "none" })
  )
  expect(initialTimeline.some((entry) => entry.pane === "loading")).toBe(true)
  expect(initialTimeline.at(-1)).toMatchObject({ pane: "history" })

  await page.evaluate(() => {
    location.hash = "_files"
  })
  await page.waitForTimeout(250)
  await expect(page.locator("#action-area .page-revision-header")).toBeVisible()
  await expect(page.locator("#action-area .page-file-header")).toHaveCount(0)

  await page.locator("#action-area .action-area-close").click()
  await expect(page.locator("#action-area")).toHaveClass(/hidden/u)
  await expect(page).toHaveURL(/#_files$/u)

  await page.evaluate(() => {
    location.hash = "_files"
  })
  await page.waitForTimeout(100)
  await expect(page.locator("#action-area")).toHaveClass(/hidden/u)

  await page.reload()
  await expect(page.locator("#action-area .page-file-header")).toBeVisible()
  await expect(page).toHaveURL(/#_files$/u)
})

test("same-document hash history is inert but full-document navigation evaluates it", async ({
  page
}) => {
  await page.goto("/scp-173")
  await expect(page.locator("#action-area")).toHaveClass(/hidden/u)

  await page.evaluate(() => {
    location.hash = "_history"
  })
  await page.waitForTimeout(250)
  await expect(page.locator("#action-area")).toHaveClass(/hidden/u)

  await page.goBack()
  await expect(page).toHaveURL(/\/scp-173$/u)
  await expect(page.locator("#action-area")).toHaveClass(/hidden/u)

  await page.goForward()
  await expect(page).toHaveURL(/\/scp-173#_history$/u)
  await page.waitForTimeout(250)
  await expect(page.locator("#action-area")).toHaveClass(/hidden/u)

  await page.goto("/main")
  await page.evaluate(() => {
    ;(
      window as Window & { hashMagicDocumentSentinel?: string }
    ).hashMagicDocumentSentinel = "source-document"
    const link = document.createElement("a")
    link.id = "hash-magic-full-document-link"
    link.href = "/scp-173#_history"
    link.textContent = "History destination"
    document.querySelector("#page-content")?.append(link)
  })

  await page.locator("#hash-magic-full-document-link").click()
  await page.waitForURL(/\/scp-173#_history$/u)
  await expect(page.locator("#action-area .page-revision-header")).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        (window as Window & { hashMagicDocumentSentinel?: string })
          .hashMagicDocumentSentinel
    )
  ).toBeUndefined()
  expect(
    await page.evaluate(
      () =>
        (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming)
          .type
    )
  ).toBe("navigate")
})
