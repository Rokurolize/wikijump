import { expect, test } from "@playwright/test"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

const generatedCss = (page: import("@playwright/test").Page) =>
  page
    .locator("head style[data-wikidot-generated-css]")
    .evaluateAll((styles) => styles.map((style) => style.textContent))

const generatedCssClones = (page: import("@playwright/test").Page) =>
  page
    .locator("head style[data-wikidot-generated-css-clone]")
    .evaluateAll((styles) => styles.map((style) => style.textContent))

test("page CSS keeps its cascade position when it already imports a styleFrame theme", async ({
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

  await expect(page.locator("link[data-wikidot-style-preloaded]")).toHaveCount(0)
  await expect(page.locator("#cascade-probe")).toHaveCSS("color", "rgb(0, 0, 255)")
})

test("Wikidot page links use document navigation without promoting interwiki styleFrame CSS to the parent", async ({
  page
}) => {
  const pageErrors: string[] = []
  let themeRequestCount = 0
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await page.route("**/navigation-style-b-theme.css", async (route) => {
    themeRequestCount += 1
    await route.fulfill({
      body: "body { background-color: rgb(1, 2, 3); } #side-bar { display: none !important; }",
      contentType: "text/css"
    })
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
  const themeIndex = destinationHtml.indexOf("navigation-style-b-theme.css")
  const inlineStyleIndex = destinationHtml.indexOf("%23page-title%7Bdisplay%3Anone%7D")
  const generatedStyleIndex = destinationHtml.indexOf(
    ".generated-style-b-one { color: blue; }"
  )
  const headEndIndex = destinationHtml.indexOf("</head>")
  expect(themeIndex).toBeGreaterThan(headEndIndex)
  expect(inlineStyleIndex).toBeGreaterThan(headEndIndex)
  expect(generatedStyleIndex).toBeGreaterThan(0)
  expect(generatedStyleIndex).toBeLessThan(headEndIndex)
  expect(destinationHtml.slice(0, headEndIndex)).not.toContain(
    "data-wikidot-style-preloaded"
  )

  await page.goto("/navigation-style-a")
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
  expect(pageErrors).toEqual([])
  await expect(page.locator("#skrollr-body")).toHaveAttribute("data-sveltekit-reload", "")
  await expect(page.locator("head [data-wikidot-style-preloaded]")).toHaveCount(0)
  expect(await generatedCss(page)).toEqual([".generated-style-a { color: red; }"])

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
  await expect(page.locator("head [data-wikidot-style-preloaded]")).toHaveCount(0)
  await expect(page.locator("#page-title")).not.toHaveCSS("display", "none")
  await expect(page.locator("#side-bar")).not.toHaveCSS("display", "none")
  expect(themeRequestCount).toBe(0)
  await expect(page).toHaveURL(/\/navigation-style-b$/u)
  await expect(page.locator("head style[data-wikidot-generated-css]")).toHaveCount(2)
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
  expect(await generatedCssClones(page)).toEqual([])

  await page.goto("/navigation-style-b")
  await expect(page.locator("head style[data-wikidot-generated-css]")).toHaveCount(2)
  await expect(page.locator("head style[data-wikidot-generated-css-clone]")).toHaveCount(
    0
  )
  expect(await generatedCss(page)).toEqual(clickedStyleB)
  expect(await generatedCssClones(page)).toEqual([])

  await page.goto("/navigation-style-c")
  await expect(page.locator("head style[data-wikidot-generated-css]")).toHaveCount(2)
  await page.evaluate(() => {
    ;(
      window as Window & {
        wikijumpNavigationSentinel?: string
      }
    ).wikijumpNavigationSentinel = "client-runtime-alive"
  })
  await page.locator("#navigate-style-d").click()
  await expect(page).toHaveURL(/\/navigation-style-d$/u)
  await expect(page.locator("head style[data-wikidot-generated-css]")).toHaveCount(1)
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
  expect(await generatedCssClones(page)).toEqual([])
  await page.goto("/navigation-style-d")
  await expect(page.locator("head style[data-wikidot-generated-css]")).toHaveCount(1)
  await expect(page.locator("head style[data-wikidot-generated-css-clone]")).toHaveCount(
    0
  )
  expect(await generatedCss(page)).toEqual(clickedStyleD)
  expect(await generatedCssClones(page)).toEqual([])
})
