import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { createJiti } from "jiti"

const libRoot = fileURLToPath(new URL("../src/lib/", import.meta.url))
const superformsStub = fileURLToPath(
  new URL("./fixtures/file-list-action-superforms-stub.ts", import.meta.url)
)
const jiti = createJiti(import.meta.url, {
  alias: {
    $lib: libRoot,
    "sveltekit-superforms": superformsStub,
    "sveltekit-superforms/adapters": superformsStub
  }
})

type FileRevisionRow = { revision_id: number; revision_number: number; file_id: number }
type HistoryActionResult = { res: FileRevisionRow[] }

const { pageFileHistoryAction, fileHistoryOffset } = await jiti.import<{
  pageFileHistoryAction: (event: unknown) => Promise<HistoryActionResult>
  fileHistoryOffset: (
    offset: number | undefined,
    page: number | undefined,
    perPage: number | undefined
  ) => number
}>(
  fileURLToPath(
    new URL("../src/lib/server/load/page/page-file-actions.ts", import.meta.url)
  )
)
const { client } = await jiti.import<{
  client: {
    request: (method: string, params: Record<string, unknown>) => Promise<unknown>
  }
}>(fileURLToPath(new URL("../src/lib/server/deepwell/index.ts", import.meta.url)))

const FILE_ID = 152130
const revisions: FileRevisionRow[] = Array.from({ length: 1600 }, (_, index) => ({
  revision_id: 9_000_000 + index,
  revision_number: 1600 - index,
  file_id: FILE_ID
}))

const BASE = { siteId: 6000402, pageId: 3000132979, fileId: FILE_ID }

const fileHistoryEvent = (body: Record<string, unknown>) => ({
  request: new Request(
    "https://pentest.wikijump.localhost/artex-i709-permfixture?/fileHistory",
    {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Sveltekit-Action": "true",
        "Origin": "https://pentest.wikijump.localhost",
        "X-Wikijump-Site-Id": "6000402",
        "X-Wikijump-Site-Slug": "artex-i709-permfixture"
      },
      body: JSON.stringify(body)
    }
  ),
  locals: { requestContext: { siteId: 6000402, page: "artex-i709-permfixture" } },
  params: { slug: "artex-i709-permfixture" },
  getClientAddress: () => "192.0.2.1"
})

async function callFileHistory(body: Record<string, unknown>) {
  const originalRequest = client.request
  const calls: { method: string; params: Record<string, unknown> }[] = []
  client.request = async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params })
    assert.equal(method, "file_revision_range")
    const offset = Number(params.offset ?? 0)
    const limit = Number(params.limit)
    return revisions.slice(offset, offset + limit)
  }
  try {
    const result = await pageFileHistoryAction(fileHistoryEvent({ ...BASE, ...body }))
    return { result, calls }
  } finally {
    client.request = originalRequest
  }
}

const numbers = (rows: FileRevisionRow[]) => rows.map((row) => row.revision_number)

test("fileHistory with no pagination inputs keeps the offset at zero and honors limit", async () => {
  for (const [limit, count] of [
    [1, 1],
    [5, 5],
    [10, 10],
    [20, 20]
  ]) {
    const { result, calls } = await callFileHistory({ limit })
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].params, {
      site_id: 6000402,
      page_id: 3000132979,
      file_id: FILE_ID,
      revision_number: -1,
      revision_direction: "before",
      limit,
      offset: 0
    })
    assert.deepEqual(numbers(result.res), numbers(revisions.slice(0, count)))
  }
})

test("fileHistory limit=10 offsets 0/10/100/1500 return disjoint windows in order", async () => {
  const offsets = [0, 10, 100, 1500]
  const windows: number[][] = []
  for (const offset of offsets) {
    const { result, calls } = await callFileHistory({ limit: 10, offset })
    assert.equal(calls[0].params.offset, offset)
    assert.equal(calls[0].params.limit, 10)
    assert.equal(result.res.length, 10)
    assert.deepEqual(numbers(result.res), numbers(revisions.slice(offset, offset + 10)))
    windows.push(numbers(result.res))
  }
  assert.deepEqual(windows[1], numbers(revisions.slice(10, 20)))
  assert.deepEqual(windows[2], numbers(revisions.slice(100, 110)))
  assert.deepEqual(windows[3], numbers(revisions.slice(1500, 1510)))
  for (let i = 1; i < windows.length; i++) {
    assert.ok(
      windows[i].every((number) => number < windows[i - 1][windows[i - 1].length - 1]),
      `window at offset ${offsets[i]} must be older than the previous window`
    )
  }
})

test("fileHistory windows over the whole history concatenate to the full ordered history", async () => {
  const collected: number[] = []
  for (let offset = 0; offset < revisions.length; offset += 10) {
    const { result } = await callFileHistory({ limit: 10, offset })
    collected.push(...numbers(result.res))
  }
  assert.deepEqual(collected, numbers(revisions))
})

test("fileHistory limit=2 offsets and page=2/perPage=2 return the exact two-row windows", async () => {
  for (const offset of [0, 2, 5]) {
    const { result, calls } = await callFileHistory({ limit: 2, offset })
    assert.equal(calls[0].params.offset, offset)
    assert.equal(calls[0].params.limit, 2)
    assert.deepEqual(numbers(result.res), numbers(revisions.slice(offset, offset + 2)))
  }

  const paged = await callFileHistory({ limit: 2, page: 2, perPage: 2 })
  assert.equal(paged.calls[0].params.offset, 2)
  assert.equal(paged.calls[0].params.limit, 2)
  assert.deepEqual(numbers(paged.result.res), numbers(revisions.slice(2, 4)))
})

test("fileHistory offset computation prefers explicit offset and clamps page/perPage", () => {
  assert.equal(fileHistoryOffset(undefined, undefined, undefined), 0)
  assert.equal(fileHistoryOffset(0, 2, 2), 0)
  assert.equal(fileHistoryOffset(1500, 2, 2), 1500)
  assert.equal(fileHistoryOffset(undefined, 2, 2), 2)
  assert.equal(fileHistoryOffset(undefined, 3, 10), 20)
  assert.equal(fileHistoryOffset(undefined, undefined, 5), 0)
  assert.equal(fileHistoryOffset(undefined, 2, undefined), 20)
  assert.equal(fileHistoryOffset(-7, undefined, undefined), 0)
  assert.equal(fileHistoryOffset(undefined, 0, 0), 0)
})
