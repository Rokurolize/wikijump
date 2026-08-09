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
 */
export const requestMembershipJoin = async (runtime) => {
  const response = await runtime.fetch("?/membershipJoin", {
    method: "POST",
    credentials: "same-origin"
  })
  const result = runtime.deserialize(await response.text())
  if (result.type === "failure") {
    throw new Error(result.data?.message ?? "Membership action failed.")
  }
  return result.data?.res
}
