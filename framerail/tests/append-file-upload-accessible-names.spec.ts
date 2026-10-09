import { expect, test, waitForSvelteDelegatedHandler } from "./hermetic-playwright"

const SITE_HEADERS = {
  "X-Wikijump-Site-Id": "6000005",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

test("Append and Files Upload fields expose their associated names", async ({ page }) => {
  await page.setExtraHTTPHeaders(SITE_HEADERS)
  const response = await page.goto("/page-workflow-probe")
  expect(response?.status()).toBe(200)

  await waitForSvelteDelegatedHandler(page, "#more-options-button")
  await page.locator("#more-options-button").click()
  await expect(page.locator("#page-options-bottom-2")).toBeVisible()
  await waitForSvelteDelegatedHandler(page, "#edit-append-button")
  await page.locator("#edit-append-button").click()

  const append = page.locator("#page-append-input")
  await expect(append).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Wikitext to append" })).toHaveCount(1)
  expect(
    await append.evaluate((element: HTMLTextAreaElement) =>
      Array.from(element.labels ?? []).some((label) => label.htmlFor === element.id)
    )
  ).toBe(true)
  await page.locator('label[for="page-append-input"]').click()
  await expect(append).toBeFocused()

  await waitForSvelteDelegatedHandler(page, "#files-button")
  await page.locator("#files-button").click()
  await page.getByRole("button", { name: /upload/u }).click()

  const file = page.locator("#file-upload-file-input")
  const filename = page.locator("#file-upload-name-input")
  await expect(file).toBeVisible()
  await expect(filename).toBeVisible()
  const [fileLabel, filenameLabel] = await Promise.all([
    file.evaluate((element: HTMLInputElement) =>
      element.labels?.[0]?.textContent?.trim()
    ),
    filename.evaluate((element: HTMLInputElement) =>
      element.labels?.[0]?.textContent?.trim()
    )
  ])
  expect(fileLabel).toBeTruthy()
  expect(filenameLabel).toBeTruthy()
  expect(fileLabel).not.toBe(filenameLabel)
  await expect(file).toHaveAccessibleName(fileLabel!)
  await expect(filename).toHaveAccessibleName(filenameLabel!)
  expect(
    await file.evaluate(
      (element: HTMLInputElement) => element.labels?.[0]?.control === element
    )
  ).toBe(true)
  expect(
    await filename.evaluate(
      (element: HTMLInputElement) => element.labels?.[0]?.control === element
    )
  ).toBe(true)
  await page.locator('label[for="file-upload-name-input"]').click()
  await expect(filename).toBeFocused()

  const fileChooserPromise = page.waitForEvent("filechooser")
  await page.locator('label[for="file-upload-file-input"]').click()
  const fileChooser = await fileChooserPromise
  expect(await fileChooser.element().getAttribute("id")).toBe("file-upload-file-input")

  expect(
    await page
      .locator("#file-upload [id]")
      .evaluateAll((elements) => elements.map((element) => element.id))
  ).toEqual(["file-upload-file-input", "file-upload-name-input"])
})
