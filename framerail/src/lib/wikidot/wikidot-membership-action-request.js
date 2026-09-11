/**
 * Submit the request-bound membership transition. Site, actor, policy, and
 * token state are deliberately absent; the server derives them from the
 * page action context and verified session.
 *
 * @param {{
 *   fetch(
 *     input: string,
 *     init?: RequestInit
 *   ): Promise<{ text(): Promise<string> }>
 *   deserialize(value: string): {
 *     type: string
 *     data?: { res?: unknown; message?: string }
 *   }
 * }} runtime
 * @param {{
 *   pageId: number
 *   lastRevisionId: number
 *   actionIndex: number
 *   actionFingerprint: string
 * }} input
 */
export const requestMembershipJoin = async (runtime, input) => {
  const response = await runtime.fetch("?/membershipJoin", {
    method: "POST",
    credentials: "same-origin",
    body: JSON.stringify({
      actionFingerprint: input.actionFingerprint,
      actionIndex: input.actionIndex,
      lastRevisionId: input.lastRevisionId,
      pageId: input.pageId
    })
  })
  const result = runtime.deserialize(await response.text())
  if (result.type === "failure") {
    throw new Error(result.data?.message ?? "Membership action failed.")
  }
  return result.data?.res
}

/**
 * @param {Parameters<typeof requestMembershipJoin>[0]} runtime
 * @param {{
 *   pageId: number
 *   lastRevisionId: number
 *   actionIndex: number
 *   actionFingerprint: string
 *   password: string
 * }} input
 */
export const requestMembershipPassword = async (runtime, input) => {
  const response = await runtime.fetch("?/membershipPassword", {
    method: "POST",
    credentials: "same-origin",
    body: JSON.stringify({
      actionFingerprint: input.actionFingerprint,
      actionIndex: input.actionIndex,
      lastRevisionId: input.lastRevisionId,
      pageId: input.pageId,
      password: input.password
    })
  })
  const result = runtime.deserialize(await response.text())
  if (result.type === "failure") {
    throw new Error(result.data?.message ?? "Membership action failed.")
  }
  return result.data?.res
}

/**
 * @param {Parameters<typeof requestMembershipJoin>[0]} runtime
 * @param {{
 *   pageId: number
 *   lastRevisionId: number
 *   actionIndex: number
 *   actionFingerprint: string
 *   comment: string
 * }} input
 */
export const requestMembershipApplication = async (runtime, input) => {
  const response = await runtime.fetch("?/membershipApplication", {
    method: "POST",
    credentials: "same-origin",
    body: JSON.stringify({
      actionFingerprint: input.actionFingerprint,
      actionIndex: input.actionIndex,
      comment: input.comment,
      lastRevisionId: input.lastRevisionId,
      pageId: input.pageId
    })
  })
  const result = runtime.deserialize(await response.text())
  if (result.type === "failure") {
    throw new Error(result.data?.message ?? "Membership action failed.")
  }
  return result.data?.res
}

/**
 * Accept the invitation named by the current page route. The opaque hash is
 * deliberately absent from the browser payload; the server resolves it from
 * the request route before calling Deepwell.
 *
 * @param {Parameters<typeof requestMembershipJoin>[0]} runtime
 * @param {{
 *   pageId: number
 *   lastRevisionId: number
 *   actionIndex: number
 *   actionFingerprint: string
 * }} input
 */
export const requestMembershipEmailInvitation = async (runtime, input) => {
  const response = await runtime.fetch("?/membershipEmailInvitation", {
    method: "POST",
    credentials: "same-origin",
    body: JSON.stringify({
      actionFingerprint: input.actionFingerprint,
      actionIndex: input.actionIndex,
      lastRevisionId: input.lastRevisionId,
      pageId: input.pageId
    })
  })
  const result = runtime.deserialize(await response.text())
  if (result.type === "failure") {
    throw new Error(result.data?.message ?? "Membership action failed.")
  }
  return result.data?.res
}
