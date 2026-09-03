// @ts-nocheck
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createServer as createViteServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))

let previousWorkingDirectory
let vite
let client
let originalClientRequest
let rootActions
let slugActions

before(async () => {
  previousWorkingDirectory = process.cwd()
  process.chdir(root)
  vite = await createViteServer({
    root,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true }
  })

  ;({ client } = await vite.ssrLoadModule("/src/lib/server/deepwell/index.ts"))
  originalClientRequest = client.request
  ;({ actions: rootActions } = await vite.ssrLoadModule("/src/routes/+page.server.ts"))
  ;({ actions: slugActions } = await vite.ssrLoadModule(
    "/src/routes/[slug]/[...extra]/+page.server.ts"
  ))
})

after(async () => {
  if (client && originalClientRequest) client.request = originalClientRequest
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

const membershipEvent = () => ({
  request: new Request("https://wikijump.test/?/membershipJoin", {
    method: "POST",
    body: JSON.stringify({
      pageId: 42,
      lastRevisionId: 90,
      actionIndex: 3,
      actionFingerprint: "0123456789abcdef0123456789abcdef"
    }),
    headers: {
      "content-type": "application/json",
      "X-Wikijump-Site-Id": "17",
      "X-Wikijump-Site-Slug": "test"
    }
  }),
  params: { slug: "main" },
  cookies: { get: () => "membership-session" },
  locals: {
    requestContext: {
      siteId: 17,
      page: "main",
      sessionToken: "membership-session"
    }
  }
})

test("root and slug page routes bind actor-verified membership Join", async () => {
  const calls = []
  client.request = async (method, params, context) => {
    calls.push({ method, params, context })
    if (method === "session_get") {
      return {
        session_token: "membership-session",
        user_id: 91,
        created_at: "2026-08-10T00:00:00Z",
        expires_at: "2026-08-11T00:00:00Z",
        ip_address: "192.0.2.91",
        user_agent: "membership route test",
        restricted: false
      }
    }
    if (method === "membership_join") return "joined"
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  for (const actions of [rootActions, slugActions]) {
    assert.equal(typeof actions.membershipJoin, "function")
    assert.deepEqual(await actions.membershipJoin(membershipEvent()), { res: "joined" })
  }

  assert.deepEqual(
    calls,
    [rootActions, slugActions].flatMap(() => [
      {
        method: "session_get",
        params: ["membership-session"],
        context: undefined
      },
      {
        method: "membership_join",
        params: {
          page_id: 42,
          last_revision_id: 90,
          action_index: 3,
          action_fingerprint: "0123456789abcdef0123456789abcdef"
        },
        context: {
          siteId: 17,
          page: "main",
          sessionToken: "membership-session"
        }
      }
    ])
  )
})

test("malformed and unauthenticated membership Join requests fail without mutation", async () => {
  const calls = []
  client.request = async (method, params, context) => {
    calls.push({ method, params, context })
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  const joinEvent = (body, sessionToken = "membership-session") => ({
    request: new Request("https://wikijump.test/?/membershipJoin", {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "X-Wikijump-Site-Id": "17",
        "X-Wikijump-Site-Slug": "test"
      }
    }),
    params: { slug: "main" },
    cookies: { get: () => sessionToken },
    locals: {
      requestContext: {
        siteId: 17,
        page: "main",
        sessionToken
      }
    }
  })

  const fingerprint = "0123456789abcdef0123456789abcdef"
  for (const body of [
    { pageId: 42, lastRevisionId: 90, actionIndex: -1, actionFingerprint: fingerprint },
    { pageId: 42, lastRevisionId: 90, actionIndex: 3 },
    { pageId: 42, lastRevisionId: 90, actionIndex: 1.5, actionFingerprint: fingerprint }
  ]) {
    const result = await rootActions.membershipJoin(joinEvent(body))
    assert.equal(result.status, 400)
  }

  const missingSession = await rootActions.membershipJoin(
    joinEvent(
      { pageId: 42, lastRevisionId: 90, actionIndex: 3, actionFingerprint: fingerprint },
      null
    )
  )
  assert.equal(missingSession.status, 401)

  assert.deepEqual(
    calls.filter(({ method }) => method === "membership_join"),
    [],
    "validation failures must not reach the mutation endpoint"
  )
})
