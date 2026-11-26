import { fail } from "@sveltejs/kit"

import {
  isNotAuthenticatedError,
  isPermissionDeniedError
} from "$lib/server/deepwell/public-error"
import { siteClone } from "$lib/server/deepwell/site-clone"
import { siteOrigin } from "$lib/server/deepwell/site"
import { failForActionError } from "$lib/server/load/action-error"
import { loadSiteInfo } from "$lib/server/load/site-info"
import { getRequestContext } from "$lib/server/request-context"

import type { Actions, PageServerLoad } from "./$types"

export const load: PageServerLoad = async () => ({})

function fieldText(fields: FormData, name: string): string {
  const value = fields.get(name)
  return typeof value === "string" ? value.trim() : ""
}

export const actions = {
  default: async ({ request, cookies, locals, getClientAddress }) => {
    const fields = await request.formData()
    const slug = fieldText(fields, "slug")
    const title = fieldText(fields, "title")
    const { siteId } = loadSiteInfo(request.headers)
    const sessionToken = cookies.get("wikijump_token")
    const storedContext = getRequestContext(locals)
    const context = { ...(storedContext ?? {}), sessionToken, siteId }

    try {
      const result = await siteClone(siteId, slug, getClientAddress(), context)

      let origin = ""
      try {
        origin = await siteOrigin(result.site_id, context)
      } catch {
        origin = ""
      }

      return {
        success: true as const,
        slug,
        title,
        siteId: result.site_id,
        origin
      }
    } catch (error) {
      if (isNotAuthenticatedError(error)) {
        return fail(401, {
          success: false as const,
          slug,
          title,
          message: "Authentication required"
        })
      }
      if (isPermissionDeniedError(error)) {
        return fail(403, {
          success: false as const,
          slug,
          title,
          message: "Permission denied"
        })
      }
      return failForActionError(error, { success: false as const, slug, title }, 400)
    }
  }
} satisfies Actions
