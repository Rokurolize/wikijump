import { expect, test, waitForSvelteDelegatedHandler } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

// Retained live Wikidot print activation (open43-issue777): the print
// control opens a printer-friendly child window, and the child exposes a
// separate PRINT THE PAGE control. The option-bar Print button must drive
// that same activation without printing or navigating the opener.
test("anonymous Print opens the printer-friendly child window", async ({ page }) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.goto("/page-workflow-probe", { waitUntil: "domcontentloaded" })
  await waitForSvelteDelegatedHandler(page, "#print-button")
  await expect(page.locator("#print-button")).toBeVisible()

  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.locator("#print-button").click()
  ])

  // The child keeps Wikidot's exact doubled slash.
  await expect(popup).toHaveURL(/\/printer--friendly\/\/page-workflow-probe$/u)
  await expect(popup.getByRole("link", { name: "PRINT THE PAGE" })).toBeVisible()

  // The opener stays on the article with no denial dialog.
  await expect(page).toHaveURL(/\/page-workflow-probe$/u)
  await expect(page.locator("#odialog-container")).toHaveCount(0)
})
