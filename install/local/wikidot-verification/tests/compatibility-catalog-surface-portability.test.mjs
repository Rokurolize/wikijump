import assert from "node:assert/strict"
import test from "node:test"

import { repositoryDocumentationEvidence } from "../src/compatibility-inventory/catalog-surfaces.mjs"

test("catalog evidence keeps repository paths and drops host-local campaign receipts", () => {
  assert.deepEqual(
    repositoryDocumentationEvidence([
      "specifications/module/module-listpages.md",
      "docs/wikidot-specifications/live-observations.json",
      "install/local/wikidot-verification/artifacts/listpages-late-evidence-manifest.json",
      "/home/roku/wjlab/runtime/wikijump-standing/refresh-receipt.json"
    ]),
    [
      "docs/wikidot-specifications/specifications/module/module-listpages.md",
      "docs/wikidot-specifications/live-observations.json",
      "install/local/wikidot-verification/artifacts/listpages-late-evidence-manifest.json"
    ]
  )
})
