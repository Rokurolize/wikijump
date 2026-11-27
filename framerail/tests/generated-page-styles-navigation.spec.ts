import { expect, test } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

const bareGeneratedStyleSnapshots = (page: import("@playwright/test").Page) =>
  page
    .locator("head style")
    .evaluateAll((styles) =>
      styles
        .filter((style) => style.attributes.length === 0)
        .map((style) => ({ outerHTML: style.outerHTML, textContent: style.textContent }))
    )

const generatedCss = async (page: import("@playwright/test").Page) =>
  (await bareGeneratedStyleSnapshots(page)).map((style) => style.textContent)

const generatedCssOuterHtml = async (page: import("@playwright/test").Page) =>
  (await bareGeneratedStyleSnapshots(page)).map((style) => style.outerHTML)

const generatedCssCount = async (page: import("@playwright/test").Page) =>
  (await generatedCss(page)).length

test("page CSS keeps its cascade position when it imports a styleFrame theme", async ({
  page
}) => {
  await page.route("**/navigation-style-duplicate-theme.css", async (route) => {
    await route.fulfill({
      body: "#cascade-probe { color: rgb(255, 0, 0); }",
      contentType: "text/css"
    })
  })
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.goto("/navigation-style-duplicate")

  await expect(
    page.locator("head link[href*='navigation-style-duplicate-theme']")
  ).toHaveCount(0)
  await expect(page.locator("#cascade-probe")).toHaveCSS("color", "rgb(0, 0, 255)")
})

test("Wikidot page links use document navigation and keep styleFrame CSS out of the page", async ({
  page
}) => {
  const pageErrors: string[] = []
  const themeRequests: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/navigation-style-b-theme.css")) {
      themeRequests.push(request.url())
    }
  })
  await page.route(/\/navigation-style-[a-d]\/_app\//u, async (route) => {
    const url = new URL(route.request().url())
    url.pathname = url.pathname.slice(url.pathname.indexOf("/_app/"))
    await route.continue({ url: url.href })
  })
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  const destinationResponse = await page.request.get("/navigation-style-b", {
    headers: SITE_HEADERS
  })
  const destinationHtml = await destinationResponse.text()
  expect(destinationResponse.ok()).toBe(true)
  const head = destinationHtml.slice(0, destinationHtml.indexOf("</head>"))
  expect(head).not.toContain("navigation-style-b-theme.css")
  expect(head).not.toContain("#page-title{display:none}")
  expect(head).toContain(".generated-style-b-one { color: blue; }")

  await page.goto("/navigation-style-a")
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
  expect(pageErrors).toEqual([])
  await expect(page.locator("#skrollr-body")).toHaveAttribute("data-sveltekit-reload", "")
  expect(await generatedCss(page)).toEqual([".generated-style-a { color: red; }"])
  expect(await generatedCssOuterHtml(page)).toEqual([
    "<style>.generated-style-a { color: red; }</style>"
  ])

  await page.evaluate(() => {
    ;(
      window as Window & {
        wikijumpNavigationSentinel?: string
      }
    ).wikijumpNavigationSentinel = "client-runtime-alive"
  })
  const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded" })
  const click = page.locator("#navigate-style-b").evaluate((link: HTMLAnchorElement) => {
    link.click()
  })
  await Promise.all([click, navigation])
  await expect(page.locator("#page-title")).not.toHaveCSS("display", "none")
  await expect(page.locator("#side-bar")).not.toHaveCSS("display", "none")
  expect(themeRequests).toEqual([])
  await expect(page).toHaveURL(/\/navigation-style-b$/u)
  await expect.poll(() => generatedCssCount(page)).toBe(2)
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & {
            wikijumpNavigationSentinel?: string
          }
        ).wikijumpNavigationSentinel
    )
  ).toBeUndefined()
  expect(
    await page.evaluate(
      () =>
        (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming)
          .type
    )
  ).toBe("navigate")
  expect(pageErrors).toEqual([])

  const clickedStyleB = await generatedCss(page)
  expect(clickedStyleB).toEqual([
    ".generated-style-b-one { color: blue; }",
    ".generated-style-b-two { color: green; }"
  ])

  await page.goto("/navigation-style-b")
  await expect.poll(() => generatedCssCount(page)).toBe(2)
  expect(await generatedCss(page)).toEqual(clickedStyleB)

  await page.goto("/navigation-style-c")
  await expect.poll(() => generatedCssCount(page)).toBe(2)
  await page.evaluate(() => {
    ;(
      window as Window & {
        wikijumpNavigationSentinel?: string
      }
    ).wikijumpNavigationSentinel = "client-runtime-alive"
  })
  await page.locator("#navigate-style-d").click()
  await expect(page).toHaveURL(/\/navigation-style-d$/u)
  await expect.poll(() => generatedCssCount(page)).toBe(1)
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & {
            wikijumpNavigationSentinel?: string
          }
        ).wikijumpNavigationSentinel
    )
  ).toBeUndefined()
  expect(
    await page.evaluate(
      () =>
        (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming)
          .type
    )
  ).toBe("navigate")

  const clickedStyleD = await generatedCss(page)
  expect(clickedStyleD).toEqual([".generated-style-d { color: black; }"])
  await page.goto("/navigation-style-d")
  await expect.poll(() => generatedCssCount(page)).toBe(1)
  expect(await generatedCss(page)).toEqual(clickedStyleD)
})
