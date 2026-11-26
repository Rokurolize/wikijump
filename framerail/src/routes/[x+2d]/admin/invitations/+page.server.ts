import { fail } from "@sveltejs/kit"

import {
  isNotAuthenticatedError,
  isPermissionDeniedError
} from "$lib/server/deepwell/public-error"
import {
  membershipEmailInvitationCancel,
  membershipEmailInvitationCreate,
  membershipEmailInvitationList
} from "$lib/server/deepwell/membership"
import { normalizeActionError } from "$lib/server/load/action-error"
import { loadSiteInfo } from "$lib/server/load/site-info"
import { getRequestContext } from "$lib/server/request-context"

import type { RequestContext } from "$lib/server/request-context"
import type { Actions, PageServerLoad } from "./$types"

function requestSiteContext(
  request: Request,
  cookies: { get: (name: string) => string | undefined },
  locals: App.Locals
): { siteId: number; context: Exclude<RequestContext, void> } {
  const { siteId } = loadSiteInfo(request.headers)
  const sessionToken = cookies.get("wikijump_token")
  const storedContext = getRequestContext(locals)
  return { siteId, context: { ...(storedContext ?? {}), sessionToken, siteId } }
}

function fieldText(fields: FormData, name: string): string {
  const value = fields.get(name)
  return typeof value === "string" ? value.trim() : ""
}

function formError<T extends Record<string, unknown>, S extends string>(
  error: unknown,
  fields: T,
  section: S
) {
  const body = { section, ...fields }
  if (isNotAuthenticatedError(error)) {
    return fail(401, { ...body, errorMessage: "Authentication required" })
  }
  if (isPermissionDeniedError(error)) {
    return fail(403, { ...body, errorMessage: "Permission denied" })
  }
  return fail(400, { ...body, errorMessage: normalizeActionError(error).message })
}

export const load: PageServerLoad = async ({ request, cookies, locals }) => {
  const { siteId, context } = requestSiteContext(request, cookies, locals)
  try {
    return {
      invitations: await membershipEmailInvitationList(siteId, context),
      loadError: null
    }
  } catch (error) {
    return { invitations: [], loadError: normalizeActionError(error).message }
  }
}

export const actions = {
  create: async ({ request, cookies, locals }) => {
    const fields = await request.formData()
    const email = fieldText(fields, "email")
    const recipientName = fieldText(fields, "recipient_name")
    const message = fieldText(fields, "message")
    const { siteId, context } = requestSiteContext(request, cookies, locals)

    try {
      const issued = await membershipEmailInvitationCreate(
        siteId,
        email,
        recipientName,
        message,
        context
      )
      return {
        section: "created" as const,
        invitationId: issued.invitation_id,
        email,
        recipientName
      }
    } catch (error) {
      return formError(
        error,
        { email, recipient_name: recipientName, message },
        "create-error"
      )
    }
  },

  cancel: async ({ request, cookies, locals }) => {
    const fields = await request.formData()
    const rawId = fieldText(fields, "invitation_id")
    const invitationId = Number(rawId)
    const { siteId, context } = requestSiteContext(request, cookies, locals)

    if (!Number.isInteger(invitationId) || invitationId <= 0) {
      return fail(400, {
        section: "cancel-error" as const,
        invitation_id: rawId,
        errorMessage: "Invalid invitation identifier"
      })
    }

    try {
      const canceled = await membershipEmailInvitationCancel(
        siteId,
        invitationId,
        context
      )
      if (!canceled) {
        return fail(404, {
          section: "cancel-error" as const,
          invitation_id: rawId,
          errorMessage: "Invitation is no longer outstanding"
        })
      }
      return { section: "cancelled" as const, invitationId }
    } catch (error) {
      return formError(error, { invitation_id: rawId }, "cancel-error")
    }
  }
} satisfies Actions
