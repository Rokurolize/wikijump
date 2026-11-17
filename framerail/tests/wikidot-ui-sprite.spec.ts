import { expect, test } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

test("UI sprite symbols are injected and resolve for icon uses", async ({ page }) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  const response = await page.goto(
    `http://localhost:${process.env.PLAYWRIGHT_APP_PORT}/`,
    { waitUntil: "domcontentloaded" }
  )
  expect(response?.status()).toBe(200)

  const symbolCount = await page.locator("svg symbol[id^='wj-']").count()
  expect(symbolCount).toBeGreaterThan(0)

  const rendered = await page.evaluate(() => {
    const symbol = document.querySelector("symbol#wj-downarrow")
    if (!symbol) return null
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("width", "24")
    svg.setAttribute("height", "24")
    svg.style.position = "fixed"
    svg.style.top = "0"
    svg.style.left = "0"
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use")
    use.setAttribute("href", "#wj-downarrow")
    svg.appendChild(use)
    document.body.appendChild(svg)
    const box = use.getBoundingClientRect()
    return {
      symbolId: symbol.id,
      width: box.width,
      height: box.height
    }
  })

  expect(rendered).not.toBeNull()
  console.log("sprite evidence:", JSON.stringify({ symbolCount, rendered }))
  expect(rendered?.width).toBeGreaterThan(0)
  expect(rendered?.height).toBeGreaterThan(0)
})
