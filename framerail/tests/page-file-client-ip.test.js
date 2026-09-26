// @ts-nocheck
import { strict as assert } from "node:assert"
import test from "node:test"

import {
  buildPageFileCreatePayload,
  buildPageFileEditPayload,
  buildPageFileRestorePayload,
  buildPageFileRollbackPayload,
  withPageFileClientAddress
} from "../src/lib/server/deepwell/page-file-mutation-payloads.ts"
import { pageActionEvent, startPageActionHarness } from "./page-action-test-harness.js"

const CLIENT_IP = "192.0.2.14"
const SITE_ID = 17
const TRUSTED_CONTEXT = { siteId: SITE_ID, page: "main" }

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
  const harness = await startPageActionHarness()
  const { client, actions } = harness
  try {
    const calls = []
    client.request = async (method, params, context) => {
      calls.push({ method, params, context })
      if (method === "file_revision_range") {
        return [{ revision_id: 5, revision_number: 2 }]
      }
      throw new Error(`Unexpected Deepwell method ${method}`)
    }

    const requestEvent = (body, siteId = SITE_ID) =>
      pageActionEvent({
        action: "fileHistory",
        body,
        siteId,
        requestContext: { ...TRUSTED_CONTEXT }
      })

    const result = await actions.fileHistory(
      requestEvent({ siteId: SITE_ID, pageId: 42, fileId: 5 })
    )
    assert.deepEqual(result, { res: [{ revision_id: 5, revision_number: 2 }] })
    assert.deepEqual(calls, [
      {
        method: "file_revision_range",
        params: {
          site_id: SITE_ID,
          page_id: 42,
          file_id: 5,
          revision_number: -1,
          revision_direction: "before",
          limit: 20
        },
        context: TRUSTED_CONTEXT
      }
    ])

    // A request that claims a different site than the trusted context is
    // rejected before any file revision read reaches Deepwell.
    calls.length = 0
    const spoofed = await actions.fileHistory(
      requestEvent({ siteId: SITE_ID + 1, pageId: 42, fileId: 5 }, SITE_ID + 1)
    )
    assert.equal(spoofed.status, 403)
    assert.deepEqual(calls, [])
  } finally {
    await harness.close()
  }
})
