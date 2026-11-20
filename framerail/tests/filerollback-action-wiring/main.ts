import { actions } from "../../src/routes/[slug]/[...extra]/+page.server.ts"

const names = Object.keys(actions)
const result = {
  names,
  hasFileRollback: Object.hasOwn(actions, "fileRollback"),
  fileRollbackTag:
    typeof actions.fileRollback === "function" ? actions.fileRollback() : null
}

document.getElementById("result")!.textContent = JSON.stringify(result)
;(globalThis as unknown as { __result: typeof result }).__result = result
