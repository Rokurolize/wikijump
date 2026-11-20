import { calls } from "./stubs/deepwell.ts"
import { actions } from "../../src/routes/[slug]/[...extra]/+page.server.ts"

const clientAddress = "203.0.113.7"

const request = new Request("http://localhost/?/fileEdit", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    siteId: 6000001,
    pageId: 3000000046,
    lastRevisionId: 108,
    fileId: 88,
    name: "r4a3-renamed.svg",
    comments: "r4a3 edit probe"
  })
})

await actions.fileEdit({
  request,
  cookies: { get: () => undefined },
  getClientAddress: () => clientAddress
} as never)

const editCall = calls.find((call) => call.method === "file_edit")
const result = {
  methods: calls.map((call) => call.method),
  params: editCall?.params ?? null
}

document.getElementById("result")!.textContent = JSON.stringify(result)
;(globalThis as unknown as { __result: typeof result }).__result = result
