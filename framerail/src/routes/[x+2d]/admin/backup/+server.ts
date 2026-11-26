import {
  isNotAuthenticatedError,
  isPermissionDeniedError
} from "$lib/server/deepwell/public-error"
import { siteBackupExport } from "$lib/server/deepwell/site-backup"
import { loadSiteInfo } from "$lib/server/load/site-info"
import { getRequestContext } from "$lib/server/request-context"

import type { RequestHandler } from "./$types"

const backupFilename = (siteId: number, siteSlug: string) => {
  const slug = siteSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
  return `${slug || `site-${siteId}`}-backup.tar`
}

const refusal = (status: 401 | 403, message: string) =>
  new Response(`${message}\n`, {
    status,
    headers: { "cache-control": "no-store" }
  })

export const GET: RequestHandler = async ({ request, locals }) => {
  const { siteId, siteSlug } = loadSiteInfo(request.headers)
  const storedContext = getRequestContext(locals)

  try {
    const archive = await siteBackupExport(siteId, {
      ...(storedContext ?? {}),
      siteId
    })
    const filename = backupFilename(siteId, siteSlug)
    return new Response(archive, {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": archive.length.toString(),
        "content-type": "application/x-tar"
      }
    })
  } catch (error) {
    if (isNotAuthenticatedError(error)) return refusal(401, "Authentication required")
    if (isPermissionDeniedError(error)) return refusal(403, "Permission denied")
    throw error
  }
}
