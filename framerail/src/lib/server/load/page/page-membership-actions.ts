import { membershipJoin } from "$lib/server/deepwell/membership"
import {
  failForActionError,
  readActionJson
} from "$lib/server/load/page/page-action-shared"
import { executePageAction } from "$lib/server/load/page/page-action-execution"
import { resolvePageActionRequestContext } from "$lib/server/load/page/page-action-context"
import { integer, minValue, number, object, pipe, string } from "valibot"

import type { RequestEvent } from "@sveltejs/kit"

/**
 * Join the request-host site as the verified session actor. The browser
 * sends no membership context, leaving site, actor, policy, and policy
 * freshness to the two server authorization boundaries.
 */
const membershipJoinSchema = object({
  pageId: number(),
  lastRevisionId: number(),
  actionIndex: pipe(number(), integer(), minValue(0)),
  actionFingerprint: string()
})

export function membershipJoinAction(event: RequestEvent) {
  return executePageAction(async () => {
    const { pageId, lastRevisionId, actionIndex, actionFingerprint } =
      await readActionJson(event.request, membershipJoinSchema)
    const context = await resolvePageActionRequestContext(event, {
      session: "required"
    })
    return membershipJoin(
      pageId,
      lastRevisionId,
      actionIndex,
      actionFingerprint,
      context.requestContext
    )
  }, failForActionError)
}
