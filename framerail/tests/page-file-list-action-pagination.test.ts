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

type FileRow = { file_id: number }
type FileListActionResult = {
  res: FileRow[]
  total?: number
  page?: number
  perPage?: number
  totalPages?: number
}

const { pageFileListAction } = await jiti.import<{
  pageFileListAction: (event: unknown) => Promise<FileListActionResult>
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

const files = Array.from({ length: 496 }, (_, index) => ({
  file_id: 2 + index * 7,
  name: `i600_rep_content_hash_${index}.txt`
}))

const fileListEvent = (body: Record<string, unknown>) => ({
  request: new Request("https://pentest.wikijump.localhost/start?/fileList", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "X-Sveltekit-Action": "true",
      "Origin": "https://pentest.wikijump.localhost",
      "X-Wikijump-Site-Id": "6000402",
      "X-Wikijump-Site-Slug": "pentest"
    },
    body: JSON.stringify(body)
  }),
  locals: { requestContext: { siteId: 6000402, page: "start" } },
  params: { slug: "start" },
  getClientAddress: () => "192.0.2.1"
})

async function callFileListAction(body: Record<string, unknown>, rows = files) {
  const originalRequest = client.request
  const calls: { method: string; params: Record<string, unknown> }[] = []
  client.request = async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params })
    return rows
  }
  try {
    const result = await pageFileListAction(fileListEvent(body))
    return { result, calls }
  } finally {
    client.request = originalRequest
  }
}

test("fileList action slices the exact baseline shape to perPage over the full set", async () => {
  const { result, calls } = await callFileListAction({
    siteId: 6000402,
    pageId: 3000132367,
    deleted: false,
    page: 1,
    perPage: 10
  })
  assert.equal(result.res.length, 10)
  assert.deepEqual(
    result.res.map((file) => file.file_id),
    files.slice(0, 10).map((file) => file.file_id)
  )
  assert.deepEqual(
    [result.total, result.page, result.perPage, result.totalPages],
    [496, 1, 10, 50]
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, "page_get_files")
  assert.deepEqual(calls[0].params, {
    site_id: 6000402,
    page_id: 3000132367,
    deleted: false
  })
})

test("fileList action returns the correct next slice on page 2", async () => {
  const { result } = await callFileListAction({
    siteId: 6000402,
    pageId: 3000132367,
    deleted: false,
    page: 2,
    perPage: 10
  })
  assert.equal(result.res.length, 10)
  assert.deepEqual(
    result.res.map((file) => file.file_id),
    files.slice(10, 20).map((file) => file.file_id)
  )
  assert.deepEqual(
    [result.total, result.page, result.perPage, result.totalPages],
    [496, 2, 10, 50]
  )
})

test("fileList action keeps the total over the filtered deleted set", async () => {
  const deletedFiles = files.slice(0, 23)
  const { result, calls } = await callFileListAction(
    {
      siteId: 6000402,
      pageId: 3000132367,
      deleted: true,
      page: 3,
      perPage: 10
    },
    deletedFiles
  )
  assert.equal(result.res.length, 3)
  assert.deepEqual(
    result.res.map((file) => file.file_id),
    deletedFiles.slice(20, 23).map((file) => file.file_id)
  )
  assert.deepEqual(
    [result.total, result.page, result.perPage, result.totalPages],
    [23, 3, 10, 3]
  )
  assert.equal(calls[0].params.deleted, true)
})

test("fileList action preserves the unpaged response for legacy callers", async () => {
  const { result } = await callFileListAction({
    siteId: 6000402,
    pageId: 3000132367,
    deleted: false
  })
  assert.equal(result.res.length, 496)
  assert.deepEqual(result.res, files)
  assert.equal(result.total, undefined)
})

test("fileList action clamps out-of-range and invalid paging values", async () => {
  const { result: last } = await callFileListAction({
    siteId: 6000402,
    pageId: 3000132367,
    deleted: false,
    page: 999,
    perPage: 50
  })
  assert.deepEqual(
    last.res.map((file) => file.file_id),
    files.slice(450, 496).map((file) => file.file_id)
  )
  assert.deepEqual(
    [last.total, last.page, last.perPage, last.totalPages],
    [496, 10, 50, 10]
  )

  const { result: first } = await callFileListAction({
    siteId: 6000402,
    pageId: 3000132367,
    deleted: false,
    page: 0,
    perPage: 0
  })
  assert.equal(first.res.length, 10)
  assert.deepEqual([first.page, first.perPage, first.totalPages], [1, 10, 50])
})
