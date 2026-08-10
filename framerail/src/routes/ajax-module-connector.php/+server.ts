import { handleAjaxModuleConnectorRequest } from "$lib/server/ajax-module-connector.js"
import {
  renderWikidotPageFiles,
  renderWikidotPageRevisionList,
  renderWikidotPageRevisionSource,
  renderWikidotPageRevisionVersion,
  renderWikidotViewSource
} from "$lib/server/ajax-module-connector-page-reads.js"
import { authGetSession } from "$lib/server/auth/get-session"
import { client } from "$lib/server/deepwell"
import { wikidotForumModule } from "$lib/server/deepwell/forum"
import { wikidotMembersListModule } from "$lib/server/deepwell/membership"
import { pageFileList } from "$lib/server/deepwell/page-file"
import {
  pageEdit,
  pageGet,
  pageHistory,
  pageRevision,
  pageRevisionById,
  pageViewPermission,
  pageParentUpdate,
  siteToolsOrphanedPages,
  siteToolsWantedPages,
  wikidotPageDiscussionCreate,
  wikidotSiteChangesModule
} from "$lib/server/deepwell/page"
import {
  renderWikidotOrphanedPages,
  renderWikidotSiteTools,
  renderWikidotWantedPages
} from "$lib/server/wikidot-site-tools.js"
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
    pageExists: (slug: string) =>
      pageViewPermission(siteId, slug, {
        ...requestContext,
        page: slug
      }),
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
    createPageDiscussion: ({ pageId }: { siteId: number; pageId: number }) =>
      wikidotPageDiscussionCreate(siteId, pageId, {
        ...requestContext,
        page: pageId
      }),
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
      ) as Promise<WikidotListPagesModuleOutput>,
    renderForumModule: ({
      siteId,
      moduleName,
      parameters
    }: {
      siteId: number
      moduleName: string
      parameters: Record<string, string>
    }) => wikidotForumModule(siteId, moduleName, parameters, requestContext),
    renderSiteChangesModule: ({
      siteId,
      pageId,
      page,
      perpage,
      categoryId,
      options
    }: {
      siteId: number
      pageId: string
      page: string
      perpage: string
      categoryId: string
      options: string
    }) =>
      wikidotSiteChangesModule(
        siteId,
        { pageId, page, perpage, categoryId, options },
        requestContext
      ),
    renderMembersList: ({
      siteId,
      parameters
    }: {
      siteId: number
      parameters: Record<string, string>
    }) => wikidotMembersListModule(siteId, parameters, requestContext),
    renderSiteToolsModule: async ({
      siteId,
      moduleName
    }: {
      siteId: number
      moduleName: string
      parameters: Record<string, string>
    }) => {
      if (moduleName === "sitetools/SiteToolsModule") {
        return { status: "ok", body: renderWikidotSiteTools() }
      }
      if (moduleName === "sitetools/WantedPagesModule") {
        const targets = await siteToolsWantedPages(siteId, requestContext)
        return { status: "ok", body: renderWikidotWantedPages(targets) }
      }
      if (moduleName === "sitetools/OrphanedPagesModule") {
        const pages = await siteToolsOrphanedPages(siteId, requestContext)
        return { status: "ok", body: renderWikidotOrphanedPages(pages) }
      }
      return { status: "not_ok", body: "" }
    },
    renderPageReadModule: async ({
      siteId,
      moduleName,
      parameters
    }: {
      siteId: number
      moduleName: string
      parameters: Record<string, string>
    }) => {
      if (
        moduleName === "history/PageSourceModule" ||
        moduleName === "history/PageVersionModule"
      ) {
        const revisionId = Number.parseInt(parameters.revision_id, 10)
        const revision = await pageRevisionById(
          siteId,
          revisionId,
          moduleName === "history/PageVersionModule",
          moduleName === "history/PageSourceModule",
          requestContext
        )
        if (!revision) throw new Error("History target revision is missing")
        return {
          status: "ok",
          body:
            moduleName === "history/PageSourceModule"
              ? renderWikidotPageRevisionSource(revision)
              : renderWikidotPageRevisionVersion(revision)
        }
      }

      const pageId = Number.parseInt(parameters.page_id, 10)
      const pageRequestContext = { ...requestContext, page: pageId }
      if (moduleName === "history/PageRevisionListModule") {
        const revisions = await pageHistory(
          siteId,
          pageId,
          -1,
          Number.parseInt(parameters.perpage, 10),
          pageRequestContext
        )
        return {
          status: "ok",
          body: renderWikidotPageRevisionList(revisions)
        }
      }
      if (moduleName === "viewsource/ViewSourceModule") {
        const revision = await pageRevision(
          siteId,
          pageId,
          undefined,
          false,
          true,
          pageRequestContext
        )
        if (!revision) throw new Error("ViewSource target page is missing")
        return {
          status: "ok",
          body: renderWikidotViewSource(revision.wikitext ?? "")
        }
      }

      const [page, files] = await Promise.all([
        pageGet(siteId, pageId, pageRequestContext) as Promise<{ slug: string } | null>,
        pageFileList(siteId, pageId, false, pageRequestContext)
      ])
      if (!page) throw new Error("PageFiles target page is missing")
      return {
        status: "ok",
        body: renderWikidotPageFiles(page.slug, files)
      }
    }
  })
}
