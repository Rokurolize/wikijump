import { client } from "$lib/server/deepwell"

import type { RequestContext } from "$lib/server/request-context"

export type MembershipJoinOutcome = "joined" | "already_member"

export interface WikidotMembersListModuleOutput {
  status: string
  body: string
}

export async function wikidotMembersListModule(
  siteId: number,
  parameters: Record<string, string>,
  context: RequestContext = {}
): Promise<WikidotMembersListModuleOutput> {
  return client.request(
    "wikidot_members_list_module",
    { site_id: siteId, parameters },
    context
  )
}

/** Call the actor-bound Deepwell self-membership transition. */
export async function membershipJoin(
  pageId: number,
  lastRevisionId: number,
  actionIndex: number,
  actionFingerprint: string,
  context: Exclude<RequestContext, void>
): Promise<MembershipJoinOutcome> {
  return await client.request(
    "membership_join",
    {
      page_id: pageId,
      last_revision_id: lastRevisionId,
      action_index: actionIndex,
      action_fingerprint: actionFingerprint
    },
    context
  )
}
