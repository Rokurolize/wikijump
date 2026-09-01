import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

test("ManageSiteGeneral does not advertise plaintext active script", async () => {
  const source = await readFile(
    new URL("../src/routes/ajax-module-connector.php/+server.ts", import.meta.url),
    "utf8"
  )
  assert.match(
    source,
    /https:\/\/d3g0gp89917ko0\.cloudfront\.net\/v--7690939296dc\/common--modules\/js\/managesite\/ManageSiteGeneralModule\.js/u
  )
  assert.doesNotMatch(
    source,
    /http:\/\/d3g0gp89917ko0\.cloudfront\.net\/v--7690939296dc\/common--modules\/js\/managesite\/ManageSiteGeneralModule\.js/u
  )
})
