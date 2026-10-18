import { expect, test, waitForSvelteDelegatedHandler } from "./hermetic-playwright"

const AUTHENTICATED_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki",
  cookie: "wikijump_token=fixture-owner-session-token",
  origin: `http://localhost:${process.env.PLAYWRIGHT_APP_PORT ?? "4173"}`
}

test("file rename form fields expose their associated labels", async ({
  page
}) => {
  await page.setExtraHTTPHeaders(AUTHENTICATED_HEADERS)
  await page.goto("/page-workflow-probe", { waitUntil: "domcontentloaded" })
  await waitForSvelteDelegatedHandler(page, "#files-button")
  await page.locator("#files-button").click()
  await expect(page.locator(".file-panel .file-row").first()).toBeVisible()
  await page
    .locator(".file-panel .file-row")
    .first()
    .locator(".file-attribute.action a", { hasText: "Edit" })
    .click()

  const form = page.locator("form#file-edit")
  await expect(form).toBeVisible()
  for (const id of ["file-edit-file-input", "file-edit-name-input"] as const) {
    const input = form.locator(`#${id}`)
    await expect(input).toBeVisible()
    expect(
      await input.evaluate(
        (element: HTMLInputElement) => element.labels?.[0]?.control === element
      )
    ).toBe(true)
    const name = await input.evaluate(
      (element: HTMLInputElement) => element.labels?.[0]?.textContent?.trim()
    )
    expect(name).toBeTruthy()
    await expect(input).toHaveAccessibleName(name!)
  }
  expect(
    await form
      .locator("[id]")
      .evaluateAll((elements) => elements.map((element) => element.id))
  ).toEqual(["file-edit-file-input", "file-edit-name-input"])

  await form.locator('label[for="file-edit-name-input"]').click()
  await expect(form.locator("#file-edit-name-input")).toBeFocused()
})
