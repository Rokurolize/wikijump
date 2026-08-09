// @ts-nocheck
import { strict as assert } from "node:assert"
import test from "node:test"

import {
  requestLegacyRate,
  requestLegacyRateCancel,
  requestLegacyScore,
  requestLegacySetTags
} from "../src/lib/wikidot/wikidot-legacy-action-request.js"
import { requestMembershipJoin } from "../src/lib/wikidot/wikidot-membership-action-request.js"

const success = (res) => ({ type: "success", data: { res } })

const requestRecorder = (result = success(null)) => {
  const requests = []
  return {
    fetch: async (url, init) => {
      requests.push({ url, init })
      return { text: async () => "serialized" }
    },
    deserialize: () => result,
    requests
  }
}

test("set-tags submits only the server registry index and revision binding", async () => {
  const recorder = requestRecorder(success({ revision_id: 91 }))
  await requestLegacySetTags(recorder, {
    pageId: 42,
    lastRevisionId: 90,
    actionIndex: 3,
    actionFingerprint: "0123456789abcdef0123456789abcdef",
    tags: ["forged"],
    alterations: ["+forged"]
  })

  assert.equal(recorder.requests.length, 1)
  const [{ url, init }] = recorder.requests
  assert.equal(url, "?/legacySetTags")
  assert.equal(init.method, "POST")
  assert.equal(init.credentials, "same-origin")
  assert.deepEqual(JSON.parse(init.body), {
    actionIndex: 3,
    actionFingerprint: "0123456789abcdef0123456789abcdef",
    lastRevisionId: 90,
    pageId: 42
  })
})

test("Rate requests submit only the server registry binding", async () => {
  const recorder = requestRecorder(success({ page_vote_id: 5 }))
  const fingerprint = "0123456789abcdef0123456789abcdef"
  await requestLegacyRate(recorder, {
    pageId: 42,
    lastRevisionId: 90,
    actionIndex: 3,
    actionFingerprint: fingerprint,
    value: -1,
    score: 500,
    count: 80,
    revisionId: 90,
    userId: 7,
    siteId: 2
  })
  await requestLegacyRateCancel(recorder, {
    pageId: 42,
    lastRevisionId: 90,
    actionIndex: 4,
    actionFingerprint: fingerprint,
    score: 500
  })
  await requestLegacyScore(recorder)

  assert.deepEqual(
    recorder.requests.map(({ url, init }) => [url, init.body && JSON.parse(init.body)]),
    [
      [
        "?/legacyRate",
        {
          actionFingerprint: fingerprint,
          actionIndex: 3,
          lastRevisionId: 90,
          pageId: 42
        }
      ],
      [
        "?/legacyRate",
        {
          actionFingerprint: fingerprint,
          actionIndex: 4,
          lastRevisionId: 90,
          pageId: 42
        }
      ],
      ["?/score", undefined]
    ]
  )
})

test("server action failures remain observable to the action state machine", async () => {
  const recorder = requestRecorder({
    type: "failure",
    data: { message: "Permission denied.", code: "permission", data: null }
  })

  await assert.rejects(
    requestLegacyRate(recorder, {
      pageId: 42,
      lastRevisionId: 90,
      actionIndex: 0,
      actionFingerprint: "0123456789abcdef0123456789abcdef"
    }),
    /Permission denied\./u
  )
})

test("Join submits only the server registry and revision binding", async () => {
  const recorder = requestRecorder(success({ outcome: "joined" }))
  const fingerprint = "0123456789abcdef0123456789abcdef"
  await requestMembershipJoin(recorder, {
    pageId: 42,
    lastRevisionId: 90,
    actionIndex: 3,
    actionFingerprint: fingerprint,
    userId: 91,
    siteId: 42,
    policy: "open",
    policyRevision: 7,
    invitationToken: "secret"
  })

  assert.deepEqual(
    recorder.requests.map(({ url, init }) => [url, init.method, JSON.parse(init.body)]),
    [
      [
        "?/membershipJoin",
        "POST",
        {
          actionFingerprint: fingerprint,
          actionIndex: 3,
          lastRevisionId: 90,
          pageId: 42
        }
      ]
    ]
  )
})
