import assert from "node:assert/strict"
import { createServer as createHttpServer } from "node:http"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createTestViteServer } from "./vite-test-server.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const siteId = 23
const adminToken = "site-backup-admin-session"
const memberToken = "site-backup-member-session"
const archiveHex = "000102ff"

let previousWorkingDirectory: any
let previousDeepwellHost: any
let previousDeepwellPort: any
let previousDeepwellToken: any
let vite: any
let deepwellServer: any
let server: any
let baseUrl: any
let backupComponent: any
let render: any

const deepwellCalls: any[] = []

const siteHeaders = {
  "X-Wikijump-Site-Id": String(siteId),
  "X-Wikijump-Site-Slug": "test"
}

const session = (token: string, userId: number) => ({
  session_token: token,
  user_id: userId,
  created_at: "2026-01-02T03:04:05Z",
  expires_at: "2027-01-02T03:04:05Z",
  ip_address: "192.0.2.10",
  user_agent: "site-backup-test",
  restricted: false
})

const rpcError = (id: number, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message }
})

const download = (token?: string) =>
  fetch(`${baseUrl}/-/admin/backup`, {
    headers: token ? { ...siteHeaders, cookie: `wikijump_token=${token}` } : siteHeaders
  })

before(async () => {
  previousWorkingDirectory = process.cwd()
  process.chdir(root)
  previousDeepwellHost = process.env.DEEPWELL_HOST
  previousDeepwellPort = process.env.DEEPWELL_PORT
  previousDeepwellToken = process.env.DEEPWELL_RPC_TOKEN

  deepwellServer = createHttpServer((request, response) => {
    let body = ""
    request.on("data", (chunk) => {
      body += chunk
    })
    request.on("end", () => {
      const rpcRequest = JSON.parse(body)
      const sessionToken = request.headers["x-deepwell-session-token"]
      deepwellCalls.push({
        method: rpcRequest.method,
        params: rpcRequest.params,
        sessionToken,
        siteId: request.headers["x-deepwell-site-id"]
      })
      response.setHeader("content-type", "application/json")

      if (rpcRequest.method === "session_get") {
        const token = rpcRequest.params[0]
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpcRequest.id,
            result: token === adminToken ? session(token, 41) : session(token, 42)
          })
        )
        return
      }

      assert.equal(rpcRequest.method, "site_backup_export")
      if (sessionToken === adminToken) {
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpcRequest.id,
            result: archiveHex
          })
        )
      } else if (sessionToken === memberToken) {
        response.end(JSON.stringify(rpcError(rpcRequest.id, 3106, "permission denied")))
      } else {
        response.end(JSON.stringify(rpcError(rpcRequest.id, 3007, "not authenticated")))
      }
    })
  })
  await new Promise((resolve) => deepwellServer.listen(0, "127.0.0.1", resolve))
  const deepwellAddress = deepwellServer.address()
  assert.equal(typeof deepwellAddress, "object")
  process.env.DEEPWELL_HOST = "127.0.0.1"
  process.env.DEEPWELL_PORT = String(deepwellAddress.port)
  process.env.DEEPWELL_RPC_TOKEN = "0".repeat(64)

  vite = await createTestViteServer()
  ;({ default: backupComponent } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/admin/BackupSettings.svelte"
  ))
  ;({ render } = await vite.ssrLoadModule("svelte/server"))

  server = createHttpServer((request, response) => vite.middlewares(request, response))
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.equal(typeof address, "object")
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
  if (deepwellServer) await new Promise((resolve) => deepwellServer.close(resolve))
  if (vite) await vite.close()
  if (previousDeepwellHost === undefined) delete process.env.DEEPWELL_HOST
  else process.env.DEEPWELL_HOST = previousDeepwellHost
  if (previousDeepwellPort === undefined) delete process.env.DEEPWELL_PORT
  else process.env.DEEPWELL_PORT = previousDeepwellPort
  if (previousDeepwellToken === undefined) delete process.env.DEEPWELL_RPC_TOKEN
  else process.env.DEEPWELL_RPC_TOKEN = previousDeepwellToken
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

test("a permitted administrator receives archive bytes as a download", async () => {
  deepwellCalls.length = 0

  const response = await download(adminToken)

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "application/x-tar")
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="test-backup.tar"'
  )
  assert.equal(response.headers.get("content-length"), "4")
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 1, 2, 255])

  const backupCall = deepwellCalls.find((call) => call.method === "site_backup_export")
  assert.deepEqual(backupCall.params, { site: siteId })
  assert.equal(backupCall.sessionToken, adminToken)
  assert.equal(backupCall.siteId, String(siteId))
})

test("a user without site edit permission is refused by the endpoint result", async () => {
  deepwellCalls.length = 0

  const response = await download(memberToken)

  assert.equal(response.status, 403)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(await response.text(), "Permission denied\n")

  const backupCall = deepwellCalls.find((call) => call.method === "site_backup_export")
  assert.equal(backupCall.sessionToken, memberToken)
  assert.equal(backupCall.siteId, String(siteId))
})

test("an anonymous request reaches the endpoint and reflects its authentication refusal", async () => {
  deepwellCalls.length = 0

  const response = await download()

  assert.equal(response.status, 401)
  assert.equal(await response.text(), "Authentication required\n")

  const backupCall = deepwellCalls.find((call) => call.method === "site_backup_export")
  assert.equal(backupCall.sessionToken, undefined)
  assert.equal(backupCall.siteId, String(siteId))
})

test("the admin backup section links to the download route", () => {
  const body = render(backupComponent, { props: {} }).body

  assert.match(body, /id="site-backup"/u)
  assert.match(body, /href="\/-\/admin\/backup"/u)
  assert.match(body, /Download site backup archive/u)
})
