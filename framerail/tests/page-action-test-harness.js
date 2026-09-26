import { fileURLToPath } from "node:url"

import { createTestViteServer } from "./vite-test-server.js"

/**
 * Shared harness for behavioral page-action boundary tests.
 *
 * Tests that need to prove a trusted-route property must invoke the real
 * server action and observe the Deepwell transport call, rather than
 * matching the action's source text. This helper owns the Vite SSR
 * bootstrap, the Deepwell client stub boundary, and the RequestEvent shape
 * those actions read.
 */
export const PAGE_ACTION_ROOT = fileURLToPath(new URL("..", import.meta.url))

export const startPageActionHarness = async () => {
  const previousWorkingDirectory = process.cwd()
  process.chdir(PAGE_ACTION_ROOT)
  const vite = await createTestViteServer()

  const { client } = await vite.ssrLoadModule("/src/lib/server/deepwell/index.ts")
  const originalClientRequest = client.request
  const { actions } = await vite.ssrLoadModule(
    "/src/routes/[slug]/[...extra]/+page.server.ts"
  )

  return {
    client,
    actions,
    async close() {
      client.request = originalClientRequest
      await vite.close()
      process.chdir(previousWorkingDirectory)
    }
  }
}

/**
 * Builds the RequestEvent a SvelteKit page action receives after wws has
 * set its trusted internal headers and middleware has stored the request
 * context.
 */
export const pageActionEvent = ({
  action,
  body,
  siteId,
  siteSlug = "test",
  sessionToken = null,
  requestContext,
  clientAddress = "192.0.2.91",
  params = { slug: "main" }
}) => ({
  request: new Request(`https://wikijump.test/main?/${action}`, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "content-type": "application/json",
      "X-Wikijump-Site-Id": String(siteId),
      "X-Wikijump-Site-Slug": siteSlug
    }
  }),
  getClientAddress: () => clientAddress,
  params,
  cookies: { get: () => sessionToken },
  locals: { requestContext }
})
