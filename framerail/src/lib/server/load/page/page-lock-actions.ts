import {
  pageLockCreate,
  pageLockHistory,
  pageLockRemove
} from "$lib/server/deepwell/page"
import {
  failForActionError,
  pageActionBaseSchema,
  readActionJson
} from "$lib/server/load/page/page-action-shared"
import { resolvePageActionRequestContext } from "$lib/server/load/page/page-action-context"
import { PageLockType } from "$lib/types"
import { fail, superValidate } from "sveltekit-superforms"
import { valibot } from "sveltekit-superforms/adapters"
import { boolean, object, optional, string, enum as vEnum } from "valibot"

import type { RequestEvent } from "@sveltejs/kit"

export async function pageLockCreateAction(event: RequestEvent) {
  const { request, getClientAddress } = event
  const form = await superValidate(request, valibot(pageLockSchema))
  if (!form.valid) {
    return fail(400, { form })
  }

  try {
    const { siteId, pageId, lockType, reason, expiresAt, overrideExisting } = form.data
    const context = await resolvePageActionRequestContext(event, {
      submittedSiteId: siteId,
      session: "required"
    })
    await pageLockCreate(
      pageId,
      lockType,
      reason,
      expiresAt,
      overrideExisting,
      getClientAddress(),
      context.requestContext
    )
    return { form }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export const pageLockSchema = object({
  ...pageActionBaseSchema,
  lockType: optional(vEnum(PageLockType), PageLockType.PermissionOnly),
  reason: string(),
  expiresAt: optional(string()),
  overrideExisting: optional(boolean(), false)
})

export async function pageLockRemoveAction(event: RequestEvent) {
  const { request, getClientAddress } = event
  try {
    const { siteId, pageId } = await readActionJson(request, pageIdActionSchema)
    const context = await resolvePageActionRequestContext(event, {
      submittedSiteId: siteId,
      session: "required"
    })
    await pageLockRemove(pageId, getClientAddress(), context.requestContext)
    return {}
  } catch (error) {
    return failForActionError(error)
  }
}

export async function pageLockHistoryAction(event: RequestEvent) {
  const { request } = event
  try {
    const { siteId, pageId } = await readActionJson(request, pageIdActionSchema)
    const context = await resolvePageActionRequestContext(event, {
      submittedSiteId: siteId
    })
    const res = await pageLockHistory(pageId, context.requestContext)
    return { res }
  } catch (error) {
    return failForActionError(error)
  }
}

const pageIdActionSchema = object(pageActionBaseSchema)
