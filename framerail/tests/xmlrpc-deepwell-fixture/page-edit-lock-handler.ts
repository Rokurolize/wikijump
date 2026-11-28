import { fixtureState, pageById, requestContextHeaders } from "./context.ts"
import { pages } from "./data.ts"
import { sendRpcError } from "./response.ts"

const resolvePage = (reference: any): any =>
  typeof reference === "string" ? pages[reference] : pageById(reference)

const hasFixtureWriteContext = (
  rpcRequest: any,
  request: import("node:http").IncomingMessage
) =>
  request.headers["x-deepwell-session-token"] === "fixture-session-token" &&
  request.headers["x-deepwell-site-id"] === "6000005" &&
  request.headers["x-deepwell-page"] === resolvePage(rpcRequest.params.page)?.slug

export const handlePageEditLockRpc = ({
  rpcRequest,
  request,
  response
}: {
  rpcRequest: any
  request: import("node:http").IncomingMessage
  response: import("node:http").ServerResponse
}) => {
  if (rpcRequest.method === "page_edit_lock_acquire") {
    if (
      !resolvePage(rpcRequest.params.page) ||
      typeof rpcRequest.params.mode !== "string" ||
      !hasFixtureWriteContext(rpcRequest, request)
    ) {
      return undefined
    }
    const page = resolvePage(rpcRequest.params.page)
    fixtureState.pageWriteRequests.pageEditLockAcquire.push({
      headers: requestContextHeaders(request),
      params: rpcRequest.params
    })
    const held = fixtureState.editLocks[page.slug]
    if (held) {
      return {
        result: {
          grant: null,
          conflicts: [
            {
              user_id: held.user_id,
              mode: held.mode,
              section_index: held.section_index,
              seconds_remaining: 840
            }
          ]
        }
      }
    }
    const lockId = fixtureState.counters.nextEditLockId++
    const secret = `fixture-edit-lock-secret-${lockId}`
    fixtureState.editLocks[page.slug] = {
      lock_id: lockId,
      secret,
      user_id: fixtureState.authenticatedUser.user_id,
      mode: rpcRequest.params.mode,
      section_index: rpcRequest.params.section_index ?? null,
      base_revision_id: page.revision_id
    }
    return {
      result: {
        grant: {
          lock_id: lockId,
          "lock_secret": secret,
          base_revision_id: page.revision_id,
          expires_at: "2999-01-01T00:00:00Z"
        },
        conflicts: []
      }
    }
  }

  if (rpcRequest.method === "page_edit_lock_force_acquire") {
    const page = resolvePage(rpcRequest.params.page)
    if (!page || typeof rpcRequest.params.mode !== "string") return undefined
    delete fixtureState.editLocks[page.slug]
    const lockId = fixtureState.counters.nextEditLockId++
    const secret = `fixture-edit-lock-secret-${lockId}`
    fixtureState.editLocks[page.slug] = {
      lock_id: lockId,
      secret,
      user_id: fixtureState.authenticatedUser.user_id,
      mode: rpcRequest.params.mode,
      section_index: rpcRequest.params.section_index ?? null,
      base_revision_id: page.revision_id
    }
    return {
      result: {
        grant: {
          lock_id: lockId,
          "lock_secret": secret,
          base_revision_id: page.revision_id,
          expires_at: "2999-01-01T00:00:00Z"
        },
        conflicts: []
      }
    }
  }

  if (rpcRequest.method === "page_edit_lock_renew") {
    const page = resolvePage(rpcRequest.params.page)
    if (!page || typeof rpcRequest.params.lock_id !== "number") return undefined
    const held = fixtureState.editLocks[page.slug]
    if (
      !held ||
      held.lock_id !== rpcRequest.params.lock_id ||
      held.secret !== rpcRequest.params["lock_secret"]
    ) {
      sendRpcError(
        response,
        rpcRequest.id,
        4304,
        "Fixture page edit lock is held by another editor"
      )
      return { responded: true }
    }
    return {
      result: {
        lock_id: held.lock_id,
        "lock_secret": held.secret,
        base_revision_id: held.base_revision_id,
        lock_recreated: false,
        expires_at: "2999-01-01T00:00:00Z"
      }
    }
  }

  if (rpcRequest.method === "page_edit_lock_release") {
    if (
      !resolvePage(rpcRequest.params.page) ||
      typeof rpcRequest.params.lock_id !== "number" ||
      !hasFixtureWriteContext(rpcRequest, request)
    ) {
      return undefined
    }
    const page = resolvePage(rpcRequest.params.page)
    fixtureState.pageWriteRequests.pageEditLockRelease.push({
      headers: requestContextHeaders(request),
      params: rpcRequest.params
    })
    const held = fixtureState.editLocks[page.slug]
    if (
      !held ||
      held.lock_id !== rpcRequest.params.lock_id ||
      held.secret !== rpcRequest.params["lock_secret"]
    ) {
      return { result: false }
    }
    delete fixtureState.editLocks[page.slug]
    return { result: true }
  }

  return undefined
}
