import { client } from "$lib/server/deepwell"

import type { RequestContext } from "$lib/server/request-context"

export interface SiteBanData {
  banned_until: string | null
  reason: string
}

export interface SiteBanRelation {
  relation_id: number
  relation_type: string
  dest_type: string
  dest_id: number
  from_type: string
  from_id: number
  metadata: SiteBanData
  created_by: number
  created_at: string
  overwritten_by: number | null
  overwritten_at: string | null
  deleted_by: number | null
  deleted_at: string | null
}

export interface BlockLookupUser {
  user_id: number
  name: string
}

export async function siteBanGet(
  siteId: number,
  userId: number,
  context: RequestContext = {}
): Promise<SiteBanRelation | null> {
  return client.request("site_ban_get", { site_id: siteId, user_id: userId }, context)
}

export async function userDisplayName(
  userId: number,
  context: RequestContext = {}
): Promise<BlockLookupUser | null> {
  return client.request("user_get", { user: userId }, context)
}

export async function siteBanSet(
  input: {
    siteId: number
    userId: number
    reason: string
    bannedUntil: string | null
    createdBy: number
    ipAddress: string
  },
  context: RequestContext = {}
): Promise<void> {
  return client.request(
    "site_ban_set",
    {
      site_id: input.siteId,
      user_id: input.userId,
      metadata: { banned_until: input.bannedUntil, reason: input.reason },
      created_by: input.createdBy,
      ip_address: input.ipAddress
    },
    context
  )
}

export async function siteBanRemove(
  input: {
    siteId: number
    userId: number
    reason: string
    removedBy: number
    ipAddress: string
  },
  context: RequestContext = {}
): Promise<SiteBanRelation> {
  return client.request(
    "site_ban_remove",
    {
      site_id: input.siteId,
      user_id: input.userId,
      removed_by: input.removedBy,
      reason: input.reason,
      ip_address: input.ipAddress
    },
    context
  )
}
