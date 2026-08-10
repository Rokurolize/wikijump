import { expect, test } from "@playwright/test"

const fixtureUrl = process.env.WIKIJUMP_FILES_THEME_FIXTURE_URL

type Geometry = {
  display: string
  parentWidth: number
  width: number
}

const geometry = async (locator: import("@playwright/test").Locator) =>
  locator.evaluate<Geometry, void, HTMLElement>((element) => {
    const parent = element.parentElement
    if (!parent) throw new Error("Files geometry target has no parent")

    return {
      display: getComputedStyle(element).display,
      parentWidth: parent.getBoundingClientRect().width,
      width: element.getBoundingClientRect().width
    }
  })

const expectSameGeometry = (actual: Geometry, expected: Geometry) => {
  expect(actual.display).toBe(expected.display)
  expect(Math.abs(actual.parentWidth - expected.parentWidth)).toBeLessThan(0.5)
  expect(Math.abs(actual.width - expected.width)).toBeLessThan(0.5)
}

test("hostile .name theme rules do not resize Files names or form controls", async ({
  page
}) => {
  test.skip(!fixtureUrl, "requires a run-owned scpaiueouiuiuiui Files fixture")

  const target = new URL(fixtureUrl!)
  expect(target.hostname).toBe("scpaiueouiuiuiui.wikijump.localhost")
  expect(target.pathname).toMatch(/^\/run-owned[:_-]/u)
  target.hash ||= "_files"

  await page.goto(target.href)
  await expect(page.locator("#action-area .page-file-header")).toBeVisible()

  const fileName = page.locator(".file-row .file-attribute.file-name").first()
  await expect(fileName).toBeVisible()
  const fileNameBefore = await geometry(fileName)

  await page.getByRole("button", { name: /upload/u }).click()
  const uploadName = page.locator('#file-upload input[name="name"]')
  await expect(uploadName).toBeVisible()
  const uploadNameBefore = await geometry(uploadName)
  await page.getByRole("button", { name: /cancel/u }).click()

  await page.getByRole("link", { name: /edit/u }).first().click()
  const editName = page.locator('#file-edit input[name="name"]')
  await expect(editName).toBeVisible()
  const editNameBefore = await geometry(editName)
  await page.getByRole("button", { name: /cancel/u }).click()

  await page.addStyleTag({ content: ".name { width: 96px; }" })

  expect(await fileName.evaluate((element) => element.classList.contains("name"))).toBe(
    false
  )
  expectSameGeometry(await geometry(fileName), fileNameBefore)

  await page.getByRole("button", { name: /upload/u }).click()
  await expect(uploadName).toBeVisible()
  expect(await uploadName.evaluate((element) => element.classList.contains("name"))).toBe(
    false
  )
  expectSameGeometry(await geometry(uploadName), uploadNameBefore)
  expect((await geometry(uploadName)).width).toBeGreaterThan(96)
  await page.getByRole("button", { name: /cancel/u }).click()

  await page.getByRole("link", { name: /edit/u }).first().click()
  await expect(editName).toBeVisible()
  expect(await editName.evaluate((element) => element.classList.contains("name"))).toBe(
    false
  )
  expectSameGeometry(await geometry(editName), editNameBefore)
  expect((await geometry(editName)).width).toBeGreaterThan(96)
})
