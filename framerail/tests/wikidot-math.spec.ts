import { expect, test } from "@playwright/test"

const MATH_SOURCE = String.raw`\begin{equation} x^2 + y^2 = z^2 \end{equation}`

test("Wikidot block math stays visible with its legacy equation identity", async ({
  page
}) => {
  await page.setExtraHTTPHeaders({
    "X-Wikijump-Site-Id": "6000005",
    "X-Wikijump-Site-Slug": "scp-wiki"
  })

  await page.goto("/wikidot-code-math", { waitUntil: "domcontentloaded" })

  const equation = page.locator("#page-content div.math-equation#equation-1")
  await expect(equation).toBeVisible()
  await expect(equation).toHaveText(MATH_SOURCE)
  await expect(page.locator("#page-content .equation-number")).toHaveText("(1)")
  await expect(page.locator("#page-content .code pre > code")).toHaveText(
    'fn main() { println!("oracle"); }'
  )

  await page.waitForLoadState("networkidle")
  await expect(equation).toBeVisible()
  await expect(equation).toHaveAttribute("id", "equation-1")
  await expect
    .poll(() => equation.evaluate((element) => getComputedStyle(element).display))
    .toBe("block")
})
