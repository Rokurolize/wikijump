import { client } from "$lib/server/deepwell"

import type { RequestContext } from "$lib/server/request-context"

export type MembershipJoinOutcome = "joined" | "already_member"

/** Call the actor-bound Deepwell self-membership transition. */
export async function membershipJoin(
  context: Exclude<RequestContext, void>
): Promise<MembershipJoinOutcome> {
  return await client.request("membership_join", {}, context)
}
