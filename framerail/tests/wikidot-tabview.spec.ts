import { expect, test } from "@playwright/test"

const headers = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

test("Wikidot-compatible tabviews are complete at the initial no-script paint", async ({
  browser
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders: headers,
    javaScriptEnabled: false
  })
  const page = await context.newPage()
  try {
    await page.goto(
      `http://localhost:${process.env.PLAYWRIGHT_APP_PORT ?? "4173"}/wikidot-tabview`,
      { waitUntil: "domcontentloaded" }
    )

    const tabview = page.locator("#page-content > .yui-navset")
    await expect(tabview).toHaveAttribute("id", /^wiki-tabview-[0-9a-f]{32}$/u)
    await expect(tabview).toHaveClass(/^yui-navset$/u)
    await expect(tabview.locator(".yui-nav > li").nth(0)).not.toHaveAttribute("title")
    await expect(tabview.locator(".yui-nav a em")).toHaveText(["First", "Second"])
    const panels = tabview.locator(".yui-content > div")
    await expect(panels.nth(0)).toHaveAttribute("id", "wiki-tab-0-0")
    await expect(panels.nth(1)).toHaveAttribute("id", "wiki-tab-0-1")
    await expect(panels.nth(0)).toHaveCSS("display", "block")
    await expect(panels.nth(1)).toHaveCSS("display", "none")
  } finally {
    await context.close()
  }
})

test("Wikidot-compatible tabviews switch panels without inline script execution", async ({
  page
}) => {
  const consoleErrors: string[] = []
  await page.setExtraHTTPHeaders(headers)
  await page.addInitScript(() => {
    window.addEventListener(
      "DOMContentLoaded",
      () => {
        const tabview = document.querySelector("#page-content > .yui-navset")
        const selected = tabview?.querySelector(":scope > .yui-nav > li.selected")
        ;(
          window as Window & {
            wikidotTabviewDomReadyProbe?: {
              className: string | null
              selectedTitle: string | null
            }
          }
        ).wikidotTabviewDomReadyProbe = {
          className: tabview?.className ?? null,
          selectedTitle: selected?.getAttribute("title") ?? null
        }
      },
      { once: true, capture: true }
    )
  })
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await page.goto("/wikidot-tabview", { waitUntil: "domcontentloaded" })

  expect(
    await page.evaluate(
      () =>
        (
          window as Window & {
            wikidotTabviewDomReadyProbe?: {
              className: string | null
              selectedTitle: string | null
            }
          }
        ).wikidotTabviewDomReadyProbe
    )
  ).toEqual({ className: "yui-navset", selectedTitle: null })

  await expect
    .poll(() =>
      page.locator("#page-content > .yui-navset").evaluate((tabview) => ({
        className: tabview.className,
        selectedTitle: tabview
          .querySelector(":scope > .yui-nav > li.selected")
          ?.getAttribute("title")
      }))
    )
    .toEqual({ className: "yui-navset yui-navset-top", selectedTitle: "active" })

  await expect
    .poll(() =>
      page
        .locator("#page-content")
        .evaluate(
          (element) =>
            Array.from(element.childNodes).filter(
              (node) => node.nodeType === Node.COMMENT_NODE
            ).length
        )
    )
    .toBe(0)

  const tabs = page.locator(".yui-navset > .yui-nav > li")
  const panels = page.locator(".yui-navset > .yui-content > div")
  await expect(page.locator(".yui-navset > .yui-nav a em")).toHaveText([
    "First",
    "Second"
  ])
  await expect(tabs.nth(0)).toHaveClass(/selected/)
  await expect(tabs.nth(0)).toHaveAttribute("title", "active")
  await expect(panels.nth(0)).toBeVisible()
  await expect(panels.nth(1)).toBeHidden()

  const firstLink = tabs.nth(0).locator("a")
  const secondLink = tabs.nth(1).locator("a")
  await firstLink.focus()
  await page.keyboard.press("ArrowRight")
  await expect(firstLink).toBeFocused()
  await expect(tabs.nth(0)).toHaveClass(/selected/)

  await secondLink.focus()
  await page.keyboard.press("Enter")
  await expect(secondLink).toBeFocused()
  await expect(tabs.nth(1)).toHaveClass(/selected/)
  await expect(tabs.nth(1)).toHaveAttribute("title", "active")
  await expect(tabs.nth(0)).not.toHaveAttribute("title", "active")

  await firstLink.focus()
  await page.keyboard.press("Space")
  await expect(tabs.nth(1)).toHaveClass(/selected/)

  await firstLink.click()

  await expect(tabs.nth(0)).toHaveClass(/selected/)
  await expect(tabs.nth(1)).not.toHaveClass(/selected/)
  await expect(panels.nth(0)).toBeVisible()
  await expect(panels.nth(1)).toBeHidden()
  expect(
    consoleErrors.filter(
      (message) =>
        message.includes("Running the JavaScript URL") ||
        (message.includes("Content Security Policy") &&
          message.includes("script-src") &&
          !message.includes("common--javascript/yahooui/tabview-min.js"))
    )
  ).toEqual([])
})
