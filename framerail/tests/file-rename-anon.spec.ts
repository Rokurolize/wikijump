import { expect, test, waitForSvelteDelegatedHandler } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

test("anonymous Wikidot Files Edit shows the Rename permission dialog before a form", async ({
  page
}) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.goto("/page-workflow-probe", { waitUntil: "domcontentloaded" })
  await waitForSvelteDelegatedHandler(page, "#files-button")
  await page.locator("#files-button").click()

  const rows = page.locator(".file-panel .file-row")
  await expect(rows.first()).toBeVisible()
  const rowCountBefore = await rows.count()
  const editAction = rows
    .first()
    .getByRole("button", { name: /^edit$/i })
    .or(rows.first().getByRole("link", { name: /^edit$/i }))
  const mutationRequests: string[] = []
  page.on("request", (request) => {
    const search = new URL(request.url()).search
    if (["?/fileEdit", "?/fileDelete", "?/fileMove"].includes(search)) {
      mutationRequests.push(search)
    }
  })

  await editAction.click()

  const dialog = page.locator("#odialog-container .owindow.error")
  await expect(dialog).toBeVisible()
  await expect(dialog.locator(".title")).toHaveText("PERMISSION ERROR")
  await expect(dialog.locator(".modal-message-lead-in")).toHaveText("Please note:")
  await expect(dialog.locator("#modal-title")).toHaveText(
    "Sorry, you can not rename file attachment in this page."
  )
  await expect(dialog.locator("#model-message-extra")).toHaveText(
    "Only owner (creator) of this page, site administrators and perhaps selected moderators are allowed to do it."
  )
  await expect(
    dialog.getByRole("link", { name: "Sign in as Wikidot user" })
  ).toHaveAttribute("href", "#action:login")
  const close = dialog.locator(".button-close-message")
  await expect(close).toBeVisible()
  await expect(page.locator("#file-edit")).toHaveCount(0)
  await expect(rows).toHaveCount(rowCountBefore)
  expect(mutationRequests).toEqual([])

  await close.click()
  await expect(dialog).toHaveCount(0)
  await expect(rows).toHaveCount(rowCountBefore)
  expect(mutationRequests).toEqual([])
})
