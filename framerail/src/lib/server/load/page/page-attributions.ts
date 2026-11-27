import { userGet, type UserGetOutput } from "$lib/server/deepwell/user"

import type { Nullable, PageAttribution, UserInfo } from "$lib/types"
import type { PageAttributionDisplay } from "$lib/page-attributions"
import type { RequestContext } from "$lib/server/request-context"

export function pageAttributionUserInfo(
  user: Nullable<UserGetOutput>
): Nullable<UserInfo> {
  if (!user?.name || !user.slug) return null

  if (user.user_type === "wikidot") {
    if (user.is_deleted) return null
    return {
      "user-id": user.user_id,
      "user-slug": user.slug,
      "user-name": user.name,
      "user-karma":
        typeof user.karma === "number" &&
        Number.isInteger(user.karma) &&
        user.karma >= 0 &&
        user.karma <= 5
          ? user.karma
          : 0,
      "user-avatar-data": `http://www.wikidot.com/avatar.php?userid=${user.user_id}&amp;size=small`,
      "user-profile-url": `http://www.wikidot.com/user:info/${user.slug}`
    }
  }

  if (user.deleted_at) return null
  return {
    "user-id": user.user_id,
    "user-slug": user.slug,
    "user-name": user.name,
    "user-karma": 0,
    "user-avatar-data": "",
    "user-profile-url": `/-/user/${user.slug}`
  }
}

export async function resolvePageAttributionDisplays(
  attributions: PageAttribution[],
  requestContext: RequestContext = {}
): Promise<PageAttributionDisplay[]> {
  if (attributions.length === 0) return []

  const userIds = [...new Set(attributions.map((attribution) => attribution.user_id))]
  const users = new Map<number, Nullable<UserInfo>>()
  await Promise.all(
    userIds.map(async (userId) => {
      let identity: Nullable<UserInfo> = null
      try {
        identity = pageAttributionUserInfo(await userGet(userId, requestContext))
      } catch {}
      users.set(userId, identity)
    })
  )

  return attributions.map((attribution) => ({
    ...attribution,
    user: users.get(attribution.user_id) ?? null
  }))
}
