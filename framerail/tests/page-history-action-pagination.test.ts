import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { createJiti } from "jiti"

const libRoot = fileURLToPath(new URL("../src/lib/", import.meta.url))
const superformsStub = fileURLToPath(
  new URL("./fixtures/history-action-superforms-stub.ts", import.meta.url)
)
const jiti = createJiti(import.meta.url, {
  alias: {
    $lib: libRoot,
    "sveltekit-superforms": superformsStub,
    "sveltekit-superforms/adapters": superformsStub
  }
})

type HistoryActionResult = {
  res: {
    entries: { revision_number: number }[]
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

const { pageHistoryAction } = await jiti.import<{
  pageHistoryAction: (event: unknown) => Promise<HistoryActionResult>
}>(
  fileURLToPath(
    new URL("../src/lib/server/load/page/page-revision-actions.ts", import.meta.url)
  )
)
const { client } = await jiti.import<{
  client: {
    request: (method: string, params: Record<string, unknown>) => Promise<unknown>
  }
}>(fileURLToPath(new URL("../src/lib/server/deepwell/index.ts", import.meta.url)))

const revisions = Array.from({ length: 140 }, (_, index) => ({
  revision_id: 9_000_000 + index,
  revision_number: 140 - index,
  revision_type: "regular",
  changes: index % 2 === 1 ? ["wikitext"] : [],
  created_at: "2026-01-01T00:00:00Z"
}))

const historyEvent = (body: Record<string, unknown>) => ({
  request: new Request("https://pentest.wikijump.localhost/i1354-titlelife-b?/history", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "X-Wikijump-Site-Id": "6000402",
      "X-Wikijump-Site-Slug": "i1354-titlelife-b"
    },
    body: JSON.stringify(body)
  }),
  locals: { requestContext: { siteId: 6000402, page: "start" } },
  params: { slug: "i1354-titlelife-b" },
  getClientAddress: () => "192.0.2.1"
})

async function callHistoryAction(body: Record<string, unknown>, rows = revisions) {
  const originalRequest = client.request
  const calls: { method: string; params: Record<string, unknown> }[] = []
  client.request = async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params })
    assert.equal(method, "page_revision_range")
    return rows
  }
  try {
    const result = await pageHistoryAction(historyEvent(body))
    return { result: result.res, calls }
  } finally {
    client.request = originalRequest
  }
}

test("history action slices the exact baseline shape to perPage without changing totals", async () => {
  const { result, calls } = await callHistoryAction({
    siteId: 6000402,
    pageId: 3000133336,
    includeFileRevisions: false,
    types: [],
    page: 1,
    perPage: 10
  })
  assert.equal(result.entries.length, 10)
  assert.equal(result.entries[0].revision_number, 140)
  assert.equal(result.entries[9].revision_number, 131)
  assert.deepEqual(
    [result.total, result.page, result.perPage, result.totalPages],
    [140, 1, 10, 14]
  )
  assert.deepEqual(
    calls.map(({ params }) => params.limit),
    [1000]
  )
})

test("history action returns the correct next slice on page 6", async () => {
  const { result } = await callHistoryAction({
    siteId: 6000402,
    pageId: 3000133336,
    includeFileRevisions: false,
    types: [],
    page: 6,
    perPage: 10
  })
  assert.equal(result.entries.length, 10)
  assert.equal(result.entries[0].revision_number, 90)
  assert.equal(result.entries[9].revision_number, 81)
  assert.deepEqual(
    [result.total, result.page, result.perPage, result.totalPages],
    [140, 6, 10, 14]
  )
})

test("history action respects larger perPage values while keeping the whole-set total", async () => {
  for (const [perPage, count, totalPages] of [
    [100, 100, 2],
    [200, 140, 1]
  ]) {
    const { result } = await callHistoryAction({
      siteId: 6000402,
      pageId: 3000133336,
      includeFileRevisions: false,
      types: [],
      page: 1,
      perPage
    })
    assert.equal(result.entries.length, count)
    assert.equal(result.total, 140)
    assert.equal(result.totalPages, totalPages)
  }
})

test("history action paginates the filtered set for the source type", async () => {
  const first = await callHistoryAction({
    siteId: 6000402,
    pageId: 3000133336,
    includeFileRevisions: false,
    types: ["source"],
    page: 1,
    perPage: 10
  })
  assert.equal(first.result.entries.length, 10)
  assert.equal(first.result.entries[0].revision_number, 139)
  assert.equal(first.result.entries[9].revision_number, 121)
  assert.deepEqual(
    [
      first.result.total,
      first.result.page,
      first.result.perPage,
      first.result.totalPages
    ],
    [70, 1, 10, 7]
  )

  const second = await callHistoryAction({
    siteId: 6000402,
    pageId: 3000133336,
    includeFileRevisions: false,
    types: ["source"],
    page: 2,
    perPage: 10
  })
  assert.equal(second.result.entries.length, 10)
  assert.equal(second.result.entries[0].revision_number, 119)
  assert.equal(second.result.entries[9].revision_number, 101)
  assert.equal(second.result.total, 70)
})

test("history action keeps the bounded create-type control empty", async () => {
  const { result } = await callHistoryAction({
    siteId: 6000402,
    pageId: 3000133336,
    includeFileRevisions: false,
    types: ["create"],
    page: 1,
    perPage: 10
  })
  assert.deepEqual(result.entries, [])
  assert.deepEqual(
    [result.total, result.page, result.perPage, result.totalPages],
    [0, 1, 10, 1]
  )
})

test("history action returns identical rows for create type when includeFileRevisions is true", async () => {
  const withoutFiles = await callHistoryAction({
    siteId: 6000402,
    pageId: 3000133336,
    includeFileRevisions: false,
    types: ["create"],
    page: 1,
    perPage: 10
  })
  const withFiles = await callHistoryAction({
    siteId: 6000402,
    pageId: 3000133336,
    includeFileRevisions: true,
    types: ["create"],
    page: 1,
    perPage: 10
  })
  assert.deepEqual(withFiles.result, withoutFiles.result)
})
