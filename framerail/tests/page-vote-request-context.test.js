// @ts-nocheck
import assert from "node:assert/strict"
import { after, before, test } from "node:test"

import { pageActionEvent, startPageActionHarness } from "./page-action-test-harness.js"

const SITE_ID = 17
const SESSION_TOKEN = "vote-session"
const TRUSTED_CONTEXT = {
  siteId: SITE_ID,
  page: "main",
  sessionToken: SESSION_TOKEN
}

let client
let actions
let closeHarness

before(async () => {
  const harness = await startPageActionHarness()
  client = harness.client
  actions = harness.actions
  closeHarness = () => harness.close()
})

after(async () => {
  await closeHarness?.()
})

const installedSession = () => ({
  session_token: SESSION_TOKEN,
  user_id: 91,
  created_at: "2026-08-10T00:00:00Z",
  expires_at: "2026-08-11T00:00:00Z",
  ip_address: "192.0.2.91",
  user_agent: "page request context test",
  restricted: false
})

const requestEvent = (action, overrides = {}) =>
  pageActionEvent({
    action,
    siteId: SITE_ID,
    sessionToken: SESSION_TOKEN,
    requestContext: { ...TRUSTED_CONTEXT },
    ...overrides
  })

test("vote mutation actions forward the trusted route request context", async () => {
  const calls = []
  client.request = async (method, params, context) => {
    calls.push({ method, params, context })
    if (method === "session_get") return installedSession()
    if (method === "vote_set") return { page_id: 42, value: 1, score: 1 }
    if (method === "vote_remove") return { page_id: 42, value: null, score: 0 }
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  // A submitted site selector is ignored: the actor and site come from the
  // wws-owned headers plus the stored trusted request context.
  const cast = await actions.voteCast(
    requestEvent("voteCast", { body: { pageId: 42, value: 1, siteId: 999 } })
  )
  assert.deepEqual(cast, { res: { page_id: 42, value: 1, score: 1 } })

  const cancel = await actions.voteCancel(
    requestEvent("voteCancel", { body: { pageId: 42, siteId: 999 } })
  )
  assert.deepEqual(cancel, { res: { page_id: 42, value: null, score: 0 } })

  assert.deepEqual(
    calls.map(({ method }) => method),
    ["session_get", "vote_set", "session_get", "vote_remove"]
  )
  assert.deepEqual(calls[1].params, { page_id: 42, value: 1 })
  assert.deepEqual(calls[3].params, { page_id: 42 })
  for (const mutation of [calls[1], calls[3]]) {
    assert.deepEqual(mutation.context, TRUSTED_CONTEXT)
  }

  // A request that claims a different site than the trusted context is
  // rejected before any mutation reaches Deepwell.
  calls.length = 0
  const spoofed = await actions.voteCast(
    requestEvent("voteCast", {
      body: { pageId: 42, value: 1 },
      siteId: SITE_ID + 1
    })
  )
  assert.equal(spoofed.status, 403)
  assert.deepEqual(calls, [])
})

test("page score actions use only trusted route context", async () => {
  const calls = []
  client.request = async (method, params, context) => {
    calls.push({ method, params, context })
    if (method === "page_get_score") return { page_id: 42, score: 7 }
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  const result = await actions.score(requestEvent("score"))
  assert.deepEqual(result, { res: { page_id: 42, score: 7 } })
  assert.deepEqual(calls, [
    {
      method: "page_get_score",
      params: { site_id: SITE_ID, page: "main" },
      context: TRUSTED_CONTEXT
    }
  ])

  // A caller cannot select the scored page through the request body.
  calls.length = 0
  const bodySelected = await actions.score(
    requestEvent("score", { body: { pageId: 1, siteId: 1, page: "attacker" } })
  )
  assert.deepEqual(bodySelected, { res: { page_id: 42, score: 7 } })
  assert.deepEqual(calls[0].params, { site_id: SITE_ID, page: "main" })

  calls.length = 0
  const spoofed = await actions.score(requestEvent("score", { siteId: SITE_ID + 1 }))
  assert.equal(spoofed.status, 403)
  assert.deepEqual(calls, [])
})

test("legacy wiki actions derive the actor, client address, and revision binding from the trusted route", async () => {
  const calls = []
  client.request = async (method, params, context) => {
    calls.push({ method, params, context })
    if (method === "session_get") return installedSession()
    if (method === "wikidot_legacy_rate") return { page_id: 42, score: 1 }
    if (method === "wikidot_legacy_set_tags") return { revision_id: 91 }
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  const actionFingerprint = "0123456789abcdef0123456789abcdef"
  const rate = await actions.legacyRate(
    requestEvent("legacyRate", {
      body: {
        pageId: 42,
        lastRevisionId: 90,
        actionIndex: 3,
        actionFingerprint,
        value: 99,
        siteId: 999
      }
    })
  )
  assert.deepEqual(rate, { res: { page_id: 42, score: 1 } })

  const setTags = await actions.legacySetTags(
    requestEvent("legacySetTags", {
      body: {
        pageId: 42,
        lastRevisionId: 90,
        actionIndex: 3,
        actionFingerprint,
        tags: ["forged"],
        alterations: ["+forged"]
      }
    })
  )
  assert.deepEqual(setTags, { res: { revision_id: 91 } })

  assert.deepEqual(
    calls.map(({ method }) => method),
    ["session_get", "wikidot_legacy_rate", "session_get", "wikidot_legacy_set_tags"]
  )
  assert.deepEqual(calls[1].params, {
    page_id: 42,
    last_revision_id: 90,
    action_index: 3,
    action_fingerprint: actionFingerprint
  })
  assert.deepEqual(calls[3].params, {
    page_id: 42,
    last_revision_id: 90,
    action_index: 3,
    action_fingerprint: actionFingerprint,
    user_id: 91,
    ip_address: "192.0.2.91"
  })
  for (const mutation of [calls[1], calls[3]]) {
    assert.deepEqual(mutation.context, TRUSTED_CONTEXT)
  }

  // A request that claims a different site than the trusted context is
  // rejected before any legacy mutation reaches Deepwell.
  calls.length = 0
  const spoofed = await actions.legacyRate(
    requestEvent("legacyRate", {
      body: { pageId: 42, lastRevisionId: 90, actionIndex: 3, actionFingerprint },
      siteId: SITE_ID + 1
    })
  )
  assert.equal(spoofed.status, 403)
  assert.deepEqual(calls, [])
})
