import {
  pageEditLockAcquire,
  pageEditLockForceAcquire,
  pageEditLockRelease,
  pageEditLockRenew
} from "$lib/server/deepwell/page-edit-lock"
import { pageDraftGet, pageDraftRemove, pageDraftSave } from "$lib/server/deepwell/page"
import {
  failForActionError,
  readActionJson
} from "$lib/server/load/page/page-action-shared"
import {
  requirePageMutationUserId,
  resolvePageActionRequestContext
} from "$lib/server/load/page/page-action-context"
import { nullable, number, object, optional, picklist, string } from "valibot"

import type { RequestEvent } from "@sveltejs/kit"

const leaseModeSchema = picklist(["page", "append", "section"])

const acquireSchema = object({
  mode: leaseModeSchema,
  sectionIndex: optional(nullable(number()))
})

const renewSchema = object({
  lockId: number(),
  lockSecret: string(),
  mode: leaseModeSchema,
  sectionIndex: optional(nullable(number()))
})

const releaseSchema = object({
  lockId: number(),
  lockSecret: string()
})

const draftIdentitySchema = object({
  pageId: optional(number())
})

const draftSynchronizeSchema = object({
  pageId: optional(number()),
  lockId: optional(number()),
  lockSecret: optional(string()),
  mode: leaseModeSchema,
  sectionIndex: optional(nullable(number())),
  title: string(),
  wikitext: string(),
  comments: string()
})

async function pageEditLockAcquireImpl(event: RequestEvent, force: boolean) {
  const { request, params } = event
  try {
    const { mode, sectionIndex } = await readActionJson(request, acquireSchema)
    const context = await resolvePageActionRequestContext(event, {
      session: "optional"
    })
    requirePageMutationUserId(context, context.siteId)
    const input = {
      pageId: undefined,
      slug: params.slug ?? "",
      mode,
      sectionIndex: sectionIndex ?? undefined
    }
    const res = force
      ? await pageEditLockForceAcquire(input, context.requestContext)
      : await pageEditLockAcquire(input, context.requestContext)
    return { res }
  } catch (error) {
    return failForActionError(error)
  }
}

export async function pageEditLockAcquireAction(event: RequestEvent) {
  return pageEditLockAcquireImpl(event, false)
}

export async function pageEditLockForceAcquireAction(event: RequestEvent) {
  return pageEditLockAcquireImpl(event, true)
}

export async function pageEditLockRenewAction(event: RequestEvent) {
  const { request, params } = event
  try {
    const { lockId, lockSecret, mode, sectionIndex } = await readActionJson(
      request,
      renewSchema
    )
    const context = await resolvePageActionRequestContext(event, {
      session: "optional"
    })
    requirePageMutationUserId(context, context.siteId)
    const res = await pageEditLockRenew(
      {
        pageId: undefined,
        slug: params.slug ?? "",
        lockId,
        lockSecret,
        mode,
        sectionIndex: sectionIndex ?? undefined
      },
      context.requestContext
    )
    return { res }
  } catch (error) {
    return failForActionError(error)
  }
}

export async function pageEditLockReleaseAction(event: RequestEvent) {
  const { request, params } = event
  try {
    const { lockId, lockSecret } = await readActionJson(request, releaseSchema)
    const context = await resolvePageActionRequestContext(event, {
      session: "optional"
    })
    requirePageMutationUserId(context, context.siteId)
    const res = await pageEditLockRelease(
      {
        pageId: undefined,
        slug: params.slug ?? "",
        lockId,
        lockSecret
      },
      context.requestContext
    )
    return { res }
  } catch (error) {
    return failForActionError(error)
  }
}

async function resolveDraftIdentity(event: RequestEvent, pageId: number | undefined) {
  const context = await resolvePageActionRequestContext(event, {
    session: "optional"
  })
  const userId = requirePageMutationUserId(context, context.siteId)
  return {
    context,
    identity: {
      siteId: context.siteId,
      userId,
      pageId,
      slug: event.params.slug ?? ""
    }
  }
}

export async function pageEditDraftGetAction(event: RequestEvent) {
  try {
    const { pageId } = await readActionJson(event.request, draftIdentitySchema)
    const { context, identity } = await resolveDraftIdentity(event, pageId)
    const res = await pageDraftGet(identity, {
      ...context.requestContext,
      page: event.params.slug
    })
    return { res }
  } catch (error) {
    return failForActionError(error)
  }
}

export async function pageEditDraftDiscardAction(event: RequestEvent) {
  try {
    const { pageId } = await readActionJson(event.request, draftIdentitySchema)
    const { context, identity } = await resolveDraftIdentity(event, pageId)
    const res = await pageDraftRemove(identity, {
      ...context.requestContext,
      page: event.params.slug
    })
    return { res }
  } catch (error) {
    return failForActionError(error)
  }
}

export async function pageEditDraftSynchronizeAction(event: RequestEvent) {
  try {
    const input = await readActionJson(event.request, draftSynchronizeSchema)
    const { context, identity } = await resolveDraftIdentity(event, input.pageId)
    const requestContext = { ...context.requestContext, page: event.params.slug }
    await pageDraftSave(
      {
        ...identity,
        title: input.title,
        wikitext: input.wikitext,
        comments: input.comments
      },
      requestContext
    )
    if (input.lockId !== undefined && input.lockSecret !== undefined) {
      const res = await pageEditLockRenew(
        {
          pageId: undefined,
          slug: event.params.slug ?? "",
          lockId: input.lockId,
          lockSecret: input.lockSecret,
          mode: input.mode,
          sectionIndex: input.sectionIndex ?? undefined
        },
        requestContext
      )
      return { res }
    }
    return { res: { saved_draft: true } }
  } catch (error) {
    return failForActionError(error)
  }
}
