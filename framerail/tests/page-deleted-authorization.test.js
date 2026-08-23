import { strict as assert } from "node:assert"
import { readFile } from "node:fs/promises"
import test from "node:test"

const pageRpcSourceUrl = new URL("../src/lib/server/deepwell/page.ts", import.meta.url)
const pageActionsSourceUrl = new URL(
  "../src/lib/server/load/page/page-revision-actions.ts",
  import.meta.url
)
const errorRouteSourceUrl = new URL("../src/routes/+error.svelte", import.meta.url)

const exportedFunction = (source, name, nextName) => {
  const start = source.indexOf(`export async function ${name}(`)
  assert.notEqual(start, -1, name)
  const end = source.indexOf(`export async function ${nextName}(`, start)
  assert.notEqual(end, -1, nextName)
  return source.slice(start, end)
}

test("deleted-page actions use the authenticated route context", async () => {
  const source = await readFile(pageActionsSourceUrl, "utf8")
  const action = exportedFunction(source, "pageDeletedGetAction", "pageRestoreAction")

  assert.match(
    action,
    /resolvePageActionRequestContext\(event, \{[\s\S]*session: "required"/u
  )
  assert.match(action, /pageDeletedGet\(context\.requestContext\)/u)
  assert.doesNotMatch(action, /requestData|submittedSiteId|siteId|slug/u)
})

test("deleted-page restore loader submits a form-compatible empty POST body", async () => {
  const source = await readFile(errorRouteSourceUrl, "utf8")
  assert.match(source, /fetch\(`\?\/deletedGet`, \{\s*method: "POST",\s*body: ""\s*\}\)/u)
})

test("deleted-page RPC derives both selectors from trusted request context", async () => {
  const source = await readFile(pageRpcSourceUrl, "utf8")
  const rpc = exportedFunction(source, "pageDeletedGet", "pageRestore")

  assert.match(rpc, /requestContext\?\.siteId/u)
  assert.match(rpc, /requestContext\?\.page/u)
  assert.match(
    rpc,
    /client\.request\([\s\S]*"page_get_deleted"[\s\S]*requestContext\s*\)/u
  )
  assert.doesNotMatch(rpc, /export async function pageDeletedGet\(\s*siteId: number/u)
  assert.doesNotMatch(rpc, /export async function pageDeletedGet\([^)]*slug: string/u)
})
