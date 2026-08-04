import { strict as assert } from "node:assert"
import { readFile } from "node:fs/promises"
import test from "node:test"

const pageRpcSourceUrl = new URL("../src/lib/server/deepwell/page.ts", import.meta.url)
const pageActionsSourceUrl = new URL(
  "../src/lib/server/load/page/page-relation-actions.ts",
  import.meta.url
)
const votePaneSourceUrl = new URL(
  "../src/routes/[slug]/[...extra]/VotePane.svelte",
  import.meta.url
)

const exportedFunction = (source, name, nextName) => {
  const start = source.indexOf(`export async function ${name}(`)
  assert.notEqual(start, -1, name)
  const end = source.indexOf(`export async function ${nextName}(`, start)
  assert.notEqual(end, -1, nextName)
  return source.slice(start, end)
}

test("vote mutation actions forward the trusted route request context", async () => {
  const source = await readFile(pageActionsSourceUrl, "utf8")
  const cases = [
    ["pageVoteCastAction", "pageVoteRemoveAction", "pageVoteCast"],
    ["pageVoteRemoveAction", "pageScoreAction", "pageVoteRemove"]
  ]

  for (const [name, nextName, callee] of cases) {
    const body = exportedFunction(source, name, nextName)
    assert.match(
      body,
      /resolvePageActionRequestContext\(event, \{[\s\S]*session: "required"/u
    )
    assert.match(body, new RegExp(`${callee}\\([\\s\\S]*?context\\.requestContext`, "u"))
    assert.doesNotMatch(body, /submittedSiteId|siteId/u)
  }
})

test("page score actions use only trusted route context", async () => {
  const source = await readFile(pageActionsSourceUrl, "utf8")
  const start = source.indexOf("export async function pageScoreAction(")
  const end = source.indexOf("\nconst pageIdActionSchema", start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const body = source.slice(start, end)

  assert.match(body, /resolvePageActionRequestContext\(event\)/u)
  assert.match(body, /pageScore\(context\.requestContext\)/u)
  assert.doesNotMatch(body, /readActionJson|pageIdActionSchema|siteId|pageId|slug/u)
})

test("vote mutation RPCs derive actor and site from request context", async () => {
  const source = await readFile(pageRpcSourceUrl, "utf8")
  const cases = [
    ["pageVoteCast", "pageVoteRemove", "vote_set"],
    ["pageVoteRemove", "pageRerender", "vote_remove"]
  ]

  for (const [name, nextName, method] of cases) {
    const body = exportedFunction(source, name, nextName)
    assert.match(body, /requestContext: RequestContext/u)
    assert.match(body, new RegExp(`"${method}"`, "u"))
    assert.match(body, /client\.request\([\s\S]*requestContext\s*\)/u)
    assert.doesNotMatch(body, /userId|user_id/u)
  }
})

test("page score RPCs derive the target from request context", async () => {
  const source = await readFile(pageRpcSourceUrl, "utf8")
  const start = source.indexOf("export async function pageScore(")
  assert.notEqual(start, -1)
  const body = source.slice(start)

  assert.match(body, /requestContext: RequestContext/u)
  assert.match(body, /requestContext\?\.siteId/u)
  assert.match(body, /requestContext\?\.page/u)
  assert.match(body, /"page_get_score"/u)
  assert.match(body, /client\.request\([\s\S]*requestContext\s*\)/u)
  assert.doesNotMatch(body, /siteId: number|pageId: Optional<number>|slug: string/u)
})

test("vote mutation panes send only the selected page", async () => {
  const source = await readFile(votePaneSourceUrl, "utf8")
  const castStart = source.indexOf("async function castVote")
  const castEnd = source.indexOf("\n  async function cancelVote", castStart)
  const cancelStart = castEnd
  const cancelEnd = source.indexOf("\n  async function fetchVoteRating", cancelStart)
  assert.notEqual(castStart, -1)
  assert.notEqual(castEnd, -1)
  assert.notEqual(cancelEnd, -1)

  for (const body of [
    source.slice(castStart, castEnd),
    source.slice(cancelStart, cancelEnd)
  ]) {
    assert.doesNotMatch(body, /siteId/u)
    assert.match(body, /pageId: data\.page\?\.page_id/u)
  }
})

test("page score pane sends no client-selected target", async () => {
  const source = await readFile(votePaneSourceUrl, "utf8")
  const start = source.indexOf("async function fetchVoteRating")
  const end = source.indexOf("\n  function starAsset", start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const body = source.slice(start, end)

  assert.match(body, /method: "POST"/u)
  assert.doesNotMatch(body, /siteId|pageId|body:/u)
})
