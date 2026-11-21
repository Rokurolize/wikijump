import { calls } from "./stubs/server.ts"
import { actions } from "../../src/routes/[slug]/[...extra]/+page.server.ts"

const request = new Request("http://localhost/?/fileRollback", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    siteId: 6000001,
    pageId: 3000000046,
    fileId: 88,
    revisionNumber: 1,
    lastRevisionId: 108,
    comments: "rollback probe"
  })
})

let error: string | null = null
try {
  await actions.fileRollback({
    request,
    cookies: { get: () => undefined }
  } as never)
} catch (e) {
  error = String(e)
}

const rollbackCall = calls.find((call) => call.method === "file_rollback")
const result = {
  error,
  rollback: rollbackCall?.params ?? null
}

document.getElementById("result")!.textContent = JSON.stringify(result)
;(globalThis as unknown as { __result: typeof result }).__result = result
