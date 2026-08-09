import { membershipJoin } from "$lib/server/deepwell/membership"
import { failForActionError } from "$lib/server/load/page/page-action-shared"
import { executePageAction } from "$lib/server/load/page/page-action-execution"
import { resolvePageActionRequestContext } from "$lib/server/load/page/page-action-context"

import type { RequestEvent } from "@sveltejs/kit"

/**
 * Join the request-host site as the verified session actor. The browser
 * sends no membership context, leaving site, actor, policy, and policy
 * freshness to the two server authorization boundaries.
 */
export function membershipJoinAction(event: RequestEvent) {
  return executePageAction(async () => {
    const context = await resolvePageActionRequestContext(event, {
      session: "required"
    })
    return membershipJoin(context.requestContext)
  }, failForActionError)
}
