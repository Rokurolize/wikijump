import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { createJiti } from "jiti"

const ref = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const stub = ref("./fixtures/superforms-stub.ts")
const jiti = createJiti(import.meta.url, {
  alias: {
    $lib: ref("../src/lib/"),
    "sveltekit-superforms": stub,
    "sveltekit-superforms/adapters": stub
  }
})

type Res = {
  res: { file_id: number }[]
  total?: number
  page?: number
  perPage?: number
  totalPages?: number
}
const { pageFileListAction } = await jiti.import<{
  pageFileListAction: (e: unknown) => Promise<Res>
}>(ref("../src/lib/server/load/page.ts"))
const { client } = await jiti.import<{
  client: { request: (m: string, p: object) => Promise<unknown> }
}>(ref("../src/lib/server/deepwell/index.ts"))

const rows = [147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 167].map((file_id) => ({
  file_id
}))
const ids = (r: { file_id: number }[]) => r.map((f) => f.file_id)
const env = (r: Res) => [r.total, r.page, r.perPage, r.totalPages]

async function call(body: object, data = rows) {
  const original = client.request
  const params: object[] = []
  client.request = async (method, p) => {
    params.push({ method, ...p })
    return data
  }
  const req = new Request("https://t.wikijump.localhost/p?/fileList", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ siteId: 1, pageId: 2, deleted: false, ...body })
  })
  try {
    return { result: await pageFileListAction({ request: req }), params }
  } finally {
    client.request = original
  }
}

test("unpaged callers keep the full vector and legacy shape", async () => {
  const { result } = await call({})
  assert.deepEqual(result.res, rows)
  assert.equal(result.total, undefined)
})

test("p1/pp10 slices to ten rows and adds the envelope", async () => {
  const { result, params } = await call({ page: 1, perPage: 10 })
  assert.deepEqual(ids(result.res), ids(rows.slice(0, 10)))
  assert.deepEqual(env(result), [11, 1, 10, 2])
  assert.deepEqual(params, [
    { method: "page_get_files", site_id: 1, page_id: 2, deleted: false }
  ])
})

test("p2/pp10 returns the last row after the deleted filter", async () => {
  const { result } = await call({ deleted: true, page: 2, perPage: 3 }, rows.slice(0, 4))
  assert.deepEqual(ids(result.res), [150])
  assert.deepEqual(env(result), [4, 2, 3, 2])
})

test("out-of-range page clamps to the last available slice", async () => {
  const { result } = await call({ page: 99, perPage: 10 })
  assert.deepEqual(ids(result.res), [167])
  assert.deepEqual(env(result), [11, 2, 10, 2])
})
