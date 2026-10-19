import { fail } from "@sveltejs/kit"

import { siteCreate } from "$lib/server/deepwell/site"
import { failForActionError } from "$lib/server/load/action-error"
import { executePageAction } from "$lib/server/load/page/page-action-execution"
import { resolvePageActionRequestContext } from "$lib/server/load/page/page-action-context"
import {
  NEW_SITE_PAGE_SLUG,
  NEW_SITE_PLATFORM_SLUG,
  NewSiteSubmissionError,
  parseNewSiteSubmission
} from "$lib/server/load/page/page-newsite-validation.js"

import type { RequestEvent } from "@sveltejs/kit"

/**
 * Refs #2052. Handle the www/new-site special-page creation form
 * (`?/newSite`).
 *
 * The special-page scope is enforced server-side on the trusted
 * request-host site identity plus the page route: this action refuses to
 * create sites from any ordinary wiki page. Authentication is required
 * before any validation or mutation, and slug conflicts/reservations
 * remain Deepwell's atomic authority (`SiteService::check_conflicts`).
 */
export function newSitePageAction(event: RequestEvent) {
  return executePageAction(async () => {
    const context = await resolvePageActionRequestContext(event, {
      session: "required"
    })

    if (
      context.siteSlug !== NEW_SITE_PLATFORM_SLUG ||
      event.params.slug !== NEW_SITE_PAGE_SLUG
    ) {
      throw new NewSiteSubmissionError(
        "Site creation is only available on the www/new-site special page."
      )
    }

    const fields = Object.fromEntries(await event.request.formData())
    const input = parseNewSiteSubmission(fields)
    const outcome = await siteCreate(
      input,
      event.getClientAddress(),
      context.requestContext
    )

    return { slug: outcome.slug, site_id: outcome.site_id }
  }, failForNewSiteError)
}

function failForNewSiteError(error: unknown) {
  if (error instanceof NewSiteSubmissionError) {
    return fail(400, { message: error.message })
  }
  return failForActionError(error)
}
