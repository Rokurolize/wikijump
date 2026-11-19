import { calls } from "./stubs/deepwell.ts"
import { pageFileEdit } from "../../src/lib/server/deepwell/pageFile.ts"

await pageFileEdit(
  6000001,
  3000000046,
  -1,
  88,
  "r4a3-renamed.svg",
  undefined,
  108,
  "r4a3 edit probe",
  false,
  "127.0.0.1"
)

const editCall = calls.find((call) => call.method === "file_edit")
const result = {
  methods: calls.map((call) => call.method),
  params: editCall?.params ?? null
}

document.getElementById("result")!.textContent = JSON.stringify(result)
;(globalThis as unknown as { __result: typeof result }).__result = result
