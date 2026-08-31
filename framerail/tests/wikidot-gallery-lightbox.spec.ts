import { expect, test } from "@playwright/test"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="white"/></svg>'

const installImageFixture = async (page) => {
  await page.route("**/gallery-*.webp", async (route) => {
    if (route.request().url().endsWith("gallery-image-broken.webp")) {
      await route.fulfill({ status: 404, contentType: "text/plain", body: "missing" })
      return
    }
    if (route.request().url().endsWith("gallery-image-one.webp")) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    await route.fulfill({ status: 200, contentType: "image/svg+xml", body: SVG })
  })
}

test("Wikidot Gallery viewer preserves loading, navigation, keyboard, and close boundaries", async ({
  page
}) => {
  await installImageFixture(page)
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.goto("/gallery-lightbox")

  await expect(page.locator("#jquery-lightbox")).toHaveCount(0)
  await page.locator("#gallery-viewer-one").click()
  await expect(page.locator("#jquery-overlay")).toBeVisible()
  await expect(page.locator("#lightbox-loading")).toBeVisible()
  await expect(page.locator("#lightbox-image")).toBeHidden()

  await expect(page.locator("#lightbox-image")).toBeVisible()
  await expect(page.locator("#lightbox-loading")).toBeHidden()
  await expect(page.locator("#lightbox-image-details-currentNumber")).toHaveText(
    "image 1 of 2"
  )
  await expect(page.locator("#lightbox-nav-btnPrev")).toBeHidden()
  await expect(page.locator("#lightbox-nav-btnNext")).toBeVisible()
  await expect(page.locator("#lightbox-image")).toHaveAttribute(
    "src",
    /gallery-image-one\.webp$/u
  )

  await page.keyboard.press("ArrowRight")
  await expect(page.locator("#lightbox-image")).toHaveAttribute(
    "src",
    /gallery-image-two\.webp$/u
  )
  await expect(page.locator("#lightbox-image-details-currentNumber")).toHaveText(
    "image 2 of 2"
  )
  await expect(page.locator("#lightbox-nav-btnPrev")).toBeVisible()
  await expect(page.locator("#lightbox-nav-btnNext")).toBeHidden()

  await page.keyboard.press("p")
  await expect(page.locator("#lightbox-image")).toHaveAttribute(
    "src",
    /gallery-image-one\.webp$/u
  )
  await page.keyboard.press("Escape")
  await expect(page.locator("#jquery-overlay")).toHaveCount(0)
  await expect(page.locator("#jquery-lightbox")).toHaveCount(0)
})

test("Wikidot Gallery disabled viewers and custom links stay inert while image failure stays loading", async ({
  page
}) => {
  await installImageFixture(page)
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.goto("/gallery-lightbox")

  await page.locator("#gallery-viewer-disabled").click()
  await expect(page).toHaveURL(/\/gallery-image-disabled\.webp$/u)
  await expect(page.locator("#jquery-lightbox")).toHaveCount(0)
  await page.goto("/gallery-lightbox")

  await page.locator("#gallery-viewer-failure").click()
  await expect(page.locator("#lightbox-loading")).toBeVisible()
  await page.waitForTimeout(100)
  await expect(page.locator("#lightbox-loading")).toBeVisible()
  await expect(page.locator("#lightbox-image")).toBeHidden()
  await page.keyboard.press("x")
  await expect(page.locator("#jquery-lightbox")).toHaveCount(0)

  await page.locator("#gallery-custom-link").click()
  await expect(page).toHaveURL(/\/main$/u)
  await expect(page.locator("#jquery-lightbox")).toHaveCount(0)
})
