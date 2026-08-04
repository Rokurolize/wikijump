import { strict as assert } from "node:assert"
import { readFile } from "node:fs/promises"
import test from "node:test"

const pageActionsSourceUrl = new URL(
  "../src/lib/server/load/page/page-relation-actions.ts",
  import.meta.url
)
const parentPaneSourceUrl = new URL(
  "../src/routes/[slug]/[...extra]/ParentPane.svelte",
  import.meta.url
)

const exportedFunction = (source, name, nextName) => {
  const start = source.indexOf(`export async function ${name}(`)
  assert.notEqual(start, -1, name)
  const end = source.indexOf(`export async function ${nextName}(`, start)
  assert.notEqual(end, -1, nextName)
  return source.slice(start, end)
}

test("parent lookup derives the target site from trusted request context", async () => {
  const source = await readFile(pageActionsSourceUrl, "utf8")
  const action = exportedFunction(source, "pageParentGetAction", "pageVoteListAction")

  assert.doesNotMatch(action, /const \{ siteId, pageId, slug \} = requestData/u)
  assert.match(action, /const \{ pageId, slug \} = requestData/u)
  assert.match(action, /resolvePageActionRequestContext\(event\)/u)
  assert.match(action, /pageParentGet\(context\.siteId, pageId, slug/u)
})

test("parent lookup pane sends only the page selector", async () => {
  const source = await readFile(parentPaneSourceUrl, "utf8")
  const start = source.indexOf("async function fetchParents()")
  const end = source.indexOf("\n  $effect", start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const fetchParents = source.slice(start, end)

  assert.doesNotMatch(fetchParents, /siteId/u)
  assert.match(fetchParents, /pageId: data\.page\?\.page_id/u)
  assert.match(fetchParents, /slug: data\.page\?\.slug/u)
})
