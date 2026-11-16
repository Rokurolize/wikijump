import { expect, test } from "./hermetic-playwright"

test("replacement article tabviews receive native initialization and keep delegated controls", async ({
  page
}) => {
  await page.setExtraHTTPHeaders(headers)
  await page.goto("/wikidot-tabview", { waitUntil: "load" })
  await expect(page.locator("#page-content > .yui-navset")).toHaveClass(/yui-navset-top/)
  await page.locator("#page-content").evaluate((content) => {
    const replacement = content
      .querySelector(".yui-navset")!
      .cloneNode(true) as HTMLElement
    replacement.classList.remove("yui-navset-top")
    replacement.querySelector("li.selected")!.removeAttribute("title")
    content.replaceChildren(replacement)
  })
  const tabview = page.locator("#page-content > .yui-navset")
  await expect(tabview).toHaveClass(/yui-navset-top/)
  await expect(tabview.locator("li.selected")).toHaveAttribute("title", "active")
  await tabview.locator(".yui-nav li a").nth(1).click()
  await expect(tabview.locator(".yui-content > div").nth(1)).toBeVisible()
  await expect(tabview.locator(".yui-content > div").nth(0)).toBeHidden()
})

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

test("Wikidot-compatible tabviews switch from parse time, before hydration", async ({
  page
}) => {
  await page.setExtraHTTPHeaders(headers)
  // A standalone document in the exact post-deepwell shape: the compat
  // script directly follows the navset and no application bundle ever
  // loads, so switching can only come from tabview-compat.js. Wikidot's
  // YUI TabView accepts clicks from DOMContentLoaded; the pre-hydration
  // window must not be dead on Wikijump.
  await page.route("**/tabview-compat-probe", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div id="dummy-ondomready-block"></div>
        <div id="page-content"><div id="wiki-tabview-0123456789abcdef0123456789abcdef" class="yui-navset"><ul class="yui-nav"><li class="selected"><a href="javascript:;"><em>First</em></a></li><li><a href="javascript:;"><em>Second</em></a></li></ul><div class="yui-content"><div id="wiki-tab-0-0" style="display: block;"><p>First panel</p></div><div id="wiki-tab-0-1" style="display:none"><p>Second panel</p></div></div></div><script type="text/javascript" src="/wikidot/scripts/tabview-compat.js"></script></div>
      </body></html>`
    })
  )
  await page.goto("/tabview-compat-probe", { waitUntil: "domcontentloaded" })

  const tabview = page.locator("#page-content > .yui-navset")
  const tabs = tabview.locator(".yui-nav > li")
  const panels = tabview.locator(".yui-content > div")
  await expect(panels.nth(0)).toBeVisible()
  await expect(panels.nth(1)).toBeHidden()

  await tabs.nth(1).locator("a").click()
  await expect(tabs.nth(1)).toHaveClass(/selected/)
  await expect(tabs.nth(1)).toHaveAttribute("title", "active")
  await expect(tabs.nth(0)).not.toHaveClass(/selected/)
  await expect(panels.nth(1)).toBeVisible()
  await expect(panels.nth(0)).toBeHidden()

  await tabs.nth(0).locator("a").click()
  await expect(tabs.nth(0)).toHaveClass(/selected/)
  await expect(tabs.nth(0)).toHaveAttribute("title", "active")
  await expect(panels.nth(0)).toBeVisible()
  await expect(panels.nth(1)).toBeHidden()
})
