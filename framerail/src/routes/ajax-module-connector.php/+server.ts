import { handleAjaxModuleConnectorRequest } from "$lib/server/ajax-module-connector.js"
import { authGetSession } from "$lib/server/auth/get-session"
import { client } from "$lib/server/deepwell"
import { pageEdit, pageParentUpdate } from "$lib/server/deepwell/page"
import { resolvePageMutationUserId } from "$lib/server/load/local-authoring-actor"
import { loadSiteInfo } from "$lib/server/load/site-info"

import type { RequestHandler } from "./$types"

interface WikidotListPagesModuleOutput {
  body: string
}

const pageSlugFromReferer = (request: Request): string | undefined => {
  const referer = request.headers.get("referer")
  if (!referer) return undefined

  try {
    const refererUrl = new URL(referer)
    const requestUrl = new URL(request.url)
    if (refererUrl.origin !== requestUrl.origin) return undefined
    const [slug] = refererUrl.pathname.split("/").filter(Boolean)
    return slug ? decodeURIComponent(slug) : undefined
  } catch {
    return undefined
  }
}

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
  const { siteId, siteSlug } = loadSiteInfo(request.headers)
  const sessionToken = cookies.get("wikijump_token")
  const sourcePage = pageSlugFromReferer(request)
  const requestContext = {
    sessionToken,
    siteId,
    page: sourcePage
  }
  let userIdPromise: Promise<number | undefined> | undefined
  const resolveNewPageUserId = () => {
    userIdPromise ??= (async () => {
      const session = sessionToken ? await authGetSession(sessionToken) : undefined
      return resolvePageMutationUserId(session?.user_id, siteSlug, siteId, siteId)
    })()
    return userIdPromise
  }

  return handleAjaxModuleConnectorRequest(request, {
    siteId,
    canCreateNewPage: async () => (await resolveNewPageUserId()) !== undefined,
    createNewPage: async ({
      slug,
      title,
      wikitext,
      tags,
      parentPage
    }: {
      slug: string
      title: string
      wikitext: string
      tags: string[]
      parentPage: string
    }) => {
      const userId = await resolveNewPageUserId()
      if (userId === undefined) {
        throw new Error("NewPage autosave requires a page mutation actor")
      }
      const created = await pageEdit(
        {
          siteId,
          pageId: undefined,
          userId,
          userIpAddr: getClientAddress(),
          slug,
          lastRevisionId: undefined,
          revisionComments: "",
          wikitext,
          title,
          altTitle: "",
          tags,
          layout: null
        },
        requestContext
      )
      if (parentPage && created.page_id !== undefined) {
        await pageParentUpdate(siteId, slug, userId, [parentPage], undefined, {
          ...requestContext,
          page: slug
        })
      }
    },
    renderListPages: ({
      siteId,
      moduleBody,
      parameters
    }: {
      siteId: number
      moduleBody: string
      parameters: Record<string, string>
    }) =>
      Promise.resolve(
        client.request(
          "wikidot_list_pages_module",
          {
            site_id: siteId,
            module_body: moduleBody,
            parameters
          },
          { siteId }
        )
      ) as Promise<WikidotListPagesModuleOutput>
  })
}
