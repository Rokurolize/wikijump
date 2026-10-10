import { expect, test, waitForSvelteDelegatedHandler } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}
const EDIT_META_MODULE = "edit/EditMetaModule"
const FIXTURE_EDIT_META_BODY = `<h1>Meta tags for the page</h1>
<h2>Current meta tags:</h2>
<div style="padding-left:3em;"><div>remove &lt;meta name="fixture-existing" content="unchanged-value"/&gt;</div></div>`

const appURL = (projectName: string) =>
  projectName === "webkit-https-edit-meta"
    ? `https://localhost:${process.env.PLAYWRIGHT_HTTPS_APP_PORT ?? "4373"}`
    : `http://localhost:${process.env.PLAYWRIGHT_APP_PORT ?? "4173"}`

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(
    browserName === "webkit" && testInfo.project.name === "webkit",
    "WebKit Edit Meta acceptance uses the real-TLS browser-support fixture"
  )
})

const openEditMeta = async (page: import("@playwright/test").Page, baseURL: string) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  await page.goto(`${baseURL}/scp-173`)
  await page.waitForFunction(() => {
    const content = document.querySelector("#page-content")
    return content !== null && content.firstChild?.nodeType !== Node.COMMENT_NODE
  })

  const moreOptions = page.locator("#more-options-button")
  if (await moreOptions.isVisible()) {
    await waitForSvelteDelegatedHandler(page, "#more-options-button")
    await moreOptions.click()
  }
  await waitForSvelteDelegatedHandler(page, "#edit-meta-button")
  await page.locator("#edit-meta-button").click()
  await expect(page.locator("#action-area #edit-meta-addbutton")).toBeVisible()
}

test("Edit Meta Cancel resets the draft without changing persisted rows", async ({
  page
}, testInfo) => {
  const baseURL = appURL(testInfo.project.name)
  const writes: string[] = []

  page.on("request", (request) => {
    if (request.method() === "GET" || request.method() === "HEAD") return
    const url = new URL(request.url())
    if (url.origin !== new URL(baseURL).origin) return
    const params = new URLSearchParams(request.postData() ?? "")
    const isRead =
      url.pathname === "/ajax-module-connector.php" &&
      params.get("moduleName") === EDIT_META_MODULE &&
      !params.has("action") &&
      !["saveMetaTag", "deleteMetaTag"].includes(params.get("event") ?? "")
    if (!isRead) writes.push(`${request.method()} ${url.pathname}`)
  })

  await page.route("**/ajax-module-connector.php", async (route) => {
    const params = new URLSearchParams(route.request().postData() ?? "")
    if (params.get("moduleName") !== EDIT_META_MODULE) {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", body: FIXTURE_EDIT_META_BODY })
    })
  })

  await openEditMeta(page, baseURL)
  await expect(page.locator("#action-area")).toContainText("fixture-existing")
  await expect(page.locator("#action-area")).toContainText("unchanged-value")
  await page.locator("#edit-meta-addbutton button").click()
  await expect(page.locator("#edit-meta-newtag-form")).toBeVisible()
  await page.locator('input[name="metaName"]').fill("wj-cancel-nonsaved")
  await page.locator('input[name="metaContent"]').fill("should-clear-unpersisted")

  await page.locator("#edit-meta-newtag-form button.btn-danger").click()
  await expect(page.locator("#edit-meta-newtag-form")).toHaveCount(0)
  await page.locator("#edit-meta-addbutton button").click()
  await expect(page.locator("#edit-meta-newtag-form")).toBeVisible()
  await expect(page.locator('input[name="metaName"]')).toHaveValue("")
  await expect(page.locator('input[name="metaContent"]')).toHaveValue("")
  await expect(page.locator("#action-area")).toContainText("fixture-existing")
  await expect(page.locator("#action-area")).toContainText("unchanged-value")
  expect(writes, "Cancel must not send any app write request").toEqual([])
})
