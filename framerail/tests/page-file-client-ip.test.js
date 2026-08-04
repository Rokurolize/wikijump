import { strict as assert } from "node:assert"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  buildPageFileCreatePayload,
  buildPageFileEditPayload,
  buildPageFileRestorePayload,
  buildPageFileRollbackPayload,
  withPageFileClientAddress
} from "../src/lib/server/deepwell/page-file-mutation-payloads.ts"

const CLIENT_IP = "192.0.2.14"

test("file mutation actions forward getClientAddress through the Deepwell transport", async () => {
  const cases = [
    [
      "file_create",
      buildPageFileCreatePayload,
      {
        siteId: 1,
        pageId: 2,
        userId: 3,
        name: "example.txt",
        pendingBlobId: "pending-create",
        revisionComments: "create",
        bypassFilter: false
      }
    ],
    [
      "file_edit",
      buildPageFileEditPayload,
      {
        siteId: 1,
        pageId: 2,
        userId: 3,
        fileId: 4,
        lastRevisionId: 5,
        name: undefined,
        pendingBlobId: "pending-edit",
        revisionComments: "edit",
        bypassFilter: false
      }
    ],
    [
      "file_restore",
      buildPageFileRestorePayload,
      {
        siteId: 1,
        pageId: 2,
        userId: 3,
        fileId: 4,
        newPage: undefined,
        newName: undefined,
        revisionComments: "restore",
        bypassFilter: false
      }
    ],
    [
      "file_rollback",
      buildPageFileRollbackPayload,
      {
        siteId: 1,
        pageId: 2,
        userId: 3,
        fileId: 4,
        lastRevisionId: 5,
        revisionNumber: 6,
        revisionComments: "rollback",
        bypassFilter: false
      }
    ]
  ]
  const requestCalls = []
  const fakeDeepwellRequest = async (method, params) => {
    requestCalls.push({ method, params })
  }

  for (const [method, buildPayload, input] of cases) {
    const actionInput = withPageFileClientAddress(() => CLIENT_IP, input)
    await fakeDeepwellRequest(method, buildPayload(actionInput))
  }

  assert.deepEqual(
    requestCalls.map(({ method, params }) => [method, params.ip_address]),
    [
      ["file_create", CLIENT_IP],
      ["file_edit", CLIENT_IP],
      ["file_restore", CLIENT_IP],
      ["file_rollback", CLIENT_IP]
    ]
  )
})

test("file revision reads forward the routed request context to Deepwell", async () => {
  const pageFileSource = await readFile(
    new URL("../src/lib/server/deepwell/page-file.ts", import.meta.url),
    "utf8"
  )
  const pageFileHistory = pageFileSource.slice(
    pageFileSource.indexOf("export async function pageFileHistory")
  )
  const pageFileRevision = pageFileSource.slice(
    pageFileSource.indexOf("export async function pageFileRevision")
  )

  assert.match(pageFileHistory, /requestContext: RequestContext/u)
  assert.match(
    pageFileHistory,
    /client\.request\([\s\S]*?"file_revision_range"[\s\S]*?requestContext\s*\)/u
  )
  assert.match(pageFileRevision, /requestContext: RequestContext/u)
  assert.match(
    pageFileRevision,
    /client\.request\([\s\S]*?"file_revision_get"[\s\S]*?requestContext\s*\)/u
  )

  const pageActionsSource = await readFile(
    new URL("../src/lib/server/load/page/page-file-actions.ts", import.meta.url),
    "utf8"
  )
  const pageFileHistoryAction = pageActionsSource.slice(
    pageActionsSource.indexOf("export async function pageFileHistoryAction")
  )
  assert.match(pageFileHistoryAction, /resolvePageActionRequestContext/u)
  assert.match(
    pageFileHistoryAction,
    /pageFileHistory\([\s\S]*?context\.requestContext\s*\)/u
  )
})
