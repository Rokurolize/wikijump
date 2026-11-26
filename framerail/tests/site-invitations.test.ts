import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createTestViteServer } from "./vite-test-server.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const siteId = 23
const adminToken = "site-invitations-admin-session"
const memberToken = "site-invitations-member-session"
const invitationId = 55
const recipientEmail = "invitee@example.test"
const recipientName = "Invited Editor"
const invitationMessage = "Please join our wiki"
const createdAt = "2026-11-20T09:30:00Z"

let previousWorkingDirectory: any
let vite: any
let client: any
let originalClientRequest: any
let actions: any
let load: any
let invitationsPage: any
let invitationsSettings: any
let render: any

const deepwellCalls: any[] = []

const siteHeaders = {
  "X-Wikijump-Site-Id": String(siteId),
  "X-Wikijump-Site-Slug": "source"
}

const event = (token?: string, fields: Record<string, string> = {}) => {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)

  return {
    request: new Request("https://wikijump.test/-/admin/invitations", {
      method: "POST",
      body: data,
      headers: siteHeaders
    }),
    cookies: { get: () => token },
    locals: { requestContext: { sessionToken: token, siteId } }
  }
}

const createFields = {
  email: recipientEmail,
  recipient_name: recipientName,
  message: invitationMessage
}

const outstanding = {
  invitation_id: invitationId,
  site_id: siteId,
  email: recipientEmail,
  recipient_name: recipientName,
  sender_user_name: "Admin Editor",
  created_at: createdAt
}

const rpcError = (code: number, message: string) => ({ code, message })

before(async () => {
  previousWorkingDirectory = process.cwd()
  process.chdir(root)
  vite = await createTestViteServer()

  ;({ client } = await vite.ssrLoadModule("/src/lib/server/deepwell/index.ts"))
  originalClientRequest = client.request
  ;({ actions, load } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/admin/invitations/+page.server.ts"
  ))
  ;({ default: invitationsPage } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/admin/invitations/+page.svelte"
  ))
  ;({ default: invitationsSettings } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/admin/InvitationsSettings.svelte"
  ))
  ;({ render } = await vite.ssrLoadModule("svelte/server"))
})

after(async () => {
  if (client && originalClientRequest) client.request = originalClientRequest
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

test("the admin area links to the invitations section", () => {
  const body = render(invitationsSettings, { props: {} }).body

  assert.match(body, /id="site-invitations"/u)
  assert.match(body, /href="\/-\/admin\/invitations"/u)
  assert.match(body, /Manage invitations/u)
})

test("a permitted administrator's create submission calls the RPC with the expected arguments and shows the issued invitation", async () => {
  deepwellCalls.length = 0
  client.request = async (method: any, params: any, context: any) => {
    deepwellCalls.push({ method, params, context })
    if (method === "membership_email_invitation_create") {
      return { invitation_id: invitationId, hash: "issued-invitation-hash" }
    }
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  const result = await actions.create(event(adminToken, createFields))

  assert.equal(result.section, "created")
  assert.equal(result.invitationId, invitationId)
  assert.equal(result.email, recipientEmail)
  assert.equal(result.recipientName, recipientName)

  const createCall = deepwellCalls.find(
    (call) => call.method === "membership_email_invitation_create"
  )
  assert.deepEqual(createCall.params, {
    site_id: siteId,
    email: recipientEmail,
    recipient_name: recipientName,
    message: invitationMessage,
    to_contacts: false
  })
  assert.equal(createCall.context.sessionToken, adminToken)
  assert.equal(createCall.context.siteId, siteId)

  const body = render(invitationsPage, {
    props: { data: { invitations: [], loadError: null }, form: result }
  }).body
  assert.match(body, /role="status"/u)
  assert.match(body, /Invitation sent to/u)
  assert.match(body, /invitee@example\.test/u)
  assert.match(body, /55/u)
})

test("the invitations surface lists outstanding invitations with recipient, sender and creation time", async () => {
  deepwellCalls.length = 0
  client.request = async (method: any, params: any, context: any) => {
    deepwellCalls.push({ method, params, context })
    if (method === "membership_email_invitation_list") return [outstanding]
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  const result = await load(event(adminToken))

  assert.deepEqual(result.invitations, [outstanding])
  assert.equal(result.loadError, null)
  const listCall = deepwellCalls.find(
    (call) => call.method === "membership_email_invitation_list"
  )
  assert.deepEqual(listCall.params, { site_id: siteId })
  assert.equal(listCall.context.sessionToken, adminToken)

  const body = render(invitationsPage, {
    props: { data: result, form: null }
  }).body
  assert.match(body, /Outstanding invitations/u)
  assert.match(body, /Invited Editor/u)
  assert.match(body, /invitee@example\.test/u)
  assert.match(body, /Admin Editor/u)
  assert.match(body, /2026-11-20T09:30:00Z/u)
  assert.match(body, /name="invitation_id"/u)
  assert.match(body, />Cancel</u)
})

test("a cancel submission calls the cancel RPC and reports the revocation", async () => {
  deepwellCalls.length = 0
  client.request = async (method: any, params: any, context: any) => {
    deepwellCalls.push({ method, params, context })
    if (method === "membership_email_invitation_cancel") return true
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  const result = await actions.cancel(
    event(adminToken, { invitation_id: String(invitationId) })
  )

  assert.equal(result.section, "cancelled")
  assert.equal(result.invitationId, invitationId)
  const cancelCall = deepwellCalls.find(
    (call) => call.method === "membership_email_invitation_cancel"
  )
  assert.deepEqual(cancelCall.params, {
    site_id: siteId,
    invitation_id: invitationId
  })
  assert.equal(cancelCall.context.sessionToken, adminToken)
  assert.equal(cancelCall.context.siteId, siteId)

  const body = render(invitationsPage, {
    props: { data: { invitations: [], loadError: null }, form: result }
  }).body
  assert.match(body, /role="status"/u)
  assert.match(body, /was revoked/u)
})

test("endpoint refusals on create render as form errors with the submitted values preserved", async () => {
  for (const [token, code, message] of [
    [undefined, 3007, "Authentication required"],
    [memberToken, 3106, "Permission denied"],
    [adminToken, 4000, "membership email invitation requires recipient identity"]
  ] as const) {
    deepwellCalls.length = 0
    client.request = async (method: any, params: any, context: any) => {
      deepwellCalls.push({ method, params, context })
      assert.equal(method, "membership_email_invitation_create")
      throw rpcError(code, message)
    }

    const result = await actions.create(event(token, createFields))

    assert.equal(result.status, code === 3007 ? 401 : code === 3106 ? 403 : 400)
    assert.equal(result.data.section, "create-error")
    assert.equal(result.data.errorMessage, message)
    assert.equal(result.data.email, recipientEmail)
    assert.equal(result.data.recipient_name, recipientName)
    assert.equal(result.data.message, invitationMessage)
    const createCall = deepwellCalls.find(
      (call) => call.method === "membership_email_invitation_create"
    )
    assert.deepEqual(createCall.params, {
      site_id: siteId,
      email: recipientEmail,
      recipient_name: recipientName,
      message: invitationMessage,
      to_contacts: false
    })

    const body = render(invitationsPage, {
      props: { data: { invitations: [], loadError: null }, form: result.data }
    }).body
    assert.match(body, /error-block/u)
    assert.match(body, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"))
    assert.match(body, /value="invitee@example\.test"/u)
    assert.match(body, /value="Invited Editor"/u)
    assert.match(body, /Please join our wiki/u)
  }
})

test("endpoint refusals on cancel render as form errors with the submitted identifier preserved", async () => {
  for (const [token, code, message] of [
    [undefined, 3007, "Authentication required"],
    [memberToken, 3106, "Permission denied"]
  ] as const) {
    deepwellCalls.length = 0
    client.request = async (method: any, params: any, context: any) => {
      deepwellCalls.push({ method, params, context })
      assert.equal(method, "membership_email_invitation_cancel")
      throw rpcError(code, message)
    }

    const result = await actions.cancel(
      event(token, { invitation_id: String(invitationId) })
    )

    assert.equal(result.status, code === 3007 ? 401 : 403)
    assert.equal(result.data.section, "cancel-error")
    assert.equal(result.data.errorMessage, message)
    assert.equal(result.data.invitation_id, String(invitationId))

    const body = render(invitationsPage, {
      props: { data: { invitations: [], loadError: null }, form: result.data }
    }).body
    assert.match(body, /error-block/u)
    assert.match(body, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"))
  }
})

test("an already-canceled invitation is reported as a form error", async () => {
  client.request = async (method: any) => {
    assert.equal(method, "membership_email_invitation_cancel")
    return false
  }

  const result = await actions.cancel(
    event(adminToken, { invitation_id: String(invitationId) })
  )

  assert.equal(result.status, 404)
  assert.equal(result.data.errorMessage, "Invitation is no longer outstanding")
  assert.equal(result.data.invitation_id, String(invitationId))
})

test("a list refusal is surfaced as a load error instead of an empty silent page", async () => {
  client.request = async (method: any) => {
    assert.equal(method, "membership_email_invitation_list")
    throw rpcError(3106, "endpoint refusal")
  }

  const result = await load(event(memberToken))

  assert.deepEqual(result.invitations, [])
  assert.equal(result.loadError, "endpoint refusal")

  const body = render(invitationsPage, {
    props: { data: result, form: null }
  }).body
  assert.match(body, /error-block/u)
  assert.match(body, /endpoint refusal/u)
})
