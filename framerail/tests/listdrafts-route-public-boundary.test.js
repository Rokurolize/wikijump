import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const read = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")

test("the public AMC route wires ListDrafts to its empty renderer", async () => {
  const [route, renderer] = await Promise.all([
    read("src/routes/ajax-module-connector.php/+server.ts"),
    read("src/lib/server/wikidot-site-tools.js")
  ])

  assert.match(route, /renderWikidotListDrafts/u)
  assert.match(
    route,
    /moduleName === "list\/ListDraftsModule"[\s\S]*renderWikidotListDrafts\(\)/u
  )
  assert.match(renderer, /class="list-drafts-box"/u)
})
