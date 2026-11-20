import {
  pageFileCreate,
  pageFileDelete,
  pageFileEdit,
  pageFileHistory,
  pageFileList,
  pageFileMove,
  pageFileRestore,
  pageFileRollback
} from "$lib/server/deepwell/page-file"
import {
  failForActionError,
  pageActionBaseSchema,
  pageMutationBaseSchema,
  readActionJson
} from "$lib/server/load/page/page-action-shared"
import { withPageFileClientAddress } from "$lib/server/deepwell/page-file-mutation-payloads"
import {
  requirePageMutationUserId,
  resolvePageActionRequestContext
} from "$lib/server/load/page/page-action-context"
import { fail } from "@sveltejs/kit"
import { superValidate, withFiles } from "sveltekit-superforms"
import { valibot } from "sveltekit-superforms/adapters"
import { boolean, file, number, object, optional, string } from "valibot"

import type { RequestEvent } from "@sveltejs/kit"

const FILE_LIST_PER_PAGE = 10
const FILE_HISTORY_DEFAULT_PER_PAGE = 20

export function fileHistoryOffset(
  offset: number | null | undefined,
  page: number | null | undefined,
  perPage: number | null | undefined
): number {
  if (offset !== null && offset !== undefined) return Math.max(0, Math.floor(offset))
  if (
    (page === null || page === undefined) &&
    (perPage === null || perPage === undefined)
  ) {
    return 0
  }
  const size = Math.max(
    Math.floor(perPage ?? FILE_HISTORY_DEFAULT_PER_PAGE) || FILE_HISTORY_DEFAULT_PER_PAGE,
    1
  )
  const current = Math.max(Math.floor(page ?? 1) || 1, 1)
  return (current - 1) * size
}

export function paginateFileList<T>(
  files: readonly T[] | null | undefined,
  page: number | null | undefined,
  perPage: number | null | undefined
): {
  files: T[]
  total: number
  page: number
  perPage: number
  totalPages: number
} {
  const list = files ?? []
  const size = Math.max(
    Math.floor(perPage ?? FILE_LIST_PER_PAGE) || FILE_LIST_PER_PAGE,
    1
  )
  const totalPages = Math.max(1, Math.ceil(list.length / size))
  const current = Math.min(Math.max(Math.floor(page ?? 1) || 1, 1), totalPages)
  const start = (current - 1) * size
  return {
    files: list.slice(start, start + size),
    total: list.length,
    page: current,
    perPage: size,
    totalPages
  }
}

export async function pageFileListAction(event: RequestEvent) {
  const { request } = event
  try {
    const requestData = await readActionJson(request, pageFileListSchema)
    const { siteId, pageId, deleted, page, perPage } = requestData
    const context = await resolvePageActionRequestContext(event, {
      submittedSiteId: siteId
    })
    const files = await pageFileList(siteId, pageId, deleted, context.requestContext)
    if (page === undefined && perPage === undefined) {
      return { res: files }
    }
    const paged = paginateFileList(files, page, perPage)
    return {
      res: paged.files,
      total: paged.total,
      page: paged.page,
      perPage: paged.perPage,
      totalPages: paged.totalPages
    }
  } catch (error) {
    return failForActionError(error)
  }
}

const pageFileListSchema = object({
  ...pageActionBaseSchema,
  deleted: optional(boolean()),
  page: optional(number()),
  perPage: optional(number())
})

export async function pageFileUploadAction(event: RequestEvent) {
  const { request, getClientAddress } = event
  const form = await superValidate(request, valibot(pageFileUploadSchema))
  if (!form.valid) {
    return withFiles(fail(400, { form }))
  }

  try {
    const { siteId, pageId, file, name, comments } = form.data
    const context = await resolvePageActionRequestContext(event, {
      submittedSiteId: siteId,
      session: "required"
    })
    const res = await pageFileCreate(
      withPageFileClientAddress(getClientAddress, {
        siteId,
        pageId,
        userId: context.sessionUserId,
        name: name === "" ? undefined : name,
        file,
        revisionComments: comments
      }),
      context.requestContext
    )

    return withFiles({ form, res })
  } catch (error) {
    return withFiles(failForActionError(error, { form }))
  }
}

export const pageFileUploadSchema = object({
  ...pageMutationBaseSchema,
  file: file(),
  name: string(),
  comments: string()
})

export async function pageFileDeleteAction(event: RequestEvent) {
  const { request } = event
  try {
    const requestData = await readActionJson(request, pageFileDeleteSchema)

    const { siteId, pageId, fileId, lastRevisionId, comments } = requestData
    const context = await resolvePageActionRequestContext(event, {
      submittedSiteId: siteId,
      session: "required"
    })
    const res = await pageFileDelete(
      {
        siteId,
        pageId,
        userId: context.sessionUserId,
        fileId,
        lastRevisionId,
        revisionComments: comments ?? ""
      },
      context.requestContext
    )
    return { res }
  } catch (error) {
    return failForActionError(error)
  }
}

const pageFileDeleteSchema = object({
  ...pageMutationBaseSchema,
  fileId: number(),
  comments: optional(string())
})

export async function pageFileEditAction(event: RequestEvent) {
  const { request, getClientAddress } = event
  const form = await superValidate(request, valibot(pageFileEditSchema))
  if (!form.valid) {
    return withFiles(fail(400, { form }))
  }

  try {
    const { siteId, pageId, lastRevisionId, fileId, file, name, comments } = form.data
    const context = await resolvePageActionRequestContext(event, {
      submittedSiteId: siteId,
      session: "required"
    })
    const res = await pageFileEdit(
      withPageFileClientAddress(getClientAddress, {
        siteId,
        pageId,
        userId: context.sessionUserId,
        fileId,
        name: name === "" ? undefined : name,
        file,
        lastRevisionId,
        revisionComments: comments
      }),
      context.requestContext
    )

    return withFiles({ form, res })
  } catch (error) {
    return withFiles(failForActionError(error, { form }))
  }
}

export const pageFileEditSchema = object({
  ...pageMutationBaseSchema,
  fileId: number(),
  file: optional(file()),
  name: string(),
  comments: string()
})

export async function pageFileMoveAction(event: RequestEvent) {
  const { request } = event
  const form = await superValidate(request, valibot(pageFileMoveSchema))
  if (!form.valid) {
    return fail(400, { form })
  }

  try {
    const { siteId, pageId, lastRevisionId, fileId, destinationPage, name, comments } =
      form.data
    const context = await resolvePageActionRequestContext(event, {
      submittedSiteId: siteId,
      session: "required"
    })
    const res = await pageFileMove(
      {
        siteId,
        currentPageId: pageId,
        destinationPage,
        userId: context.sessionUserId,
        fileId,
        lastRevisionId,
        name: name === "" ? undefined : name,
        revisionComments: comments
      },
      context.requestContext
    )

    return { form, res }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export const pageFileMoveSchema = object({
  ...pageMutationBaseSchema,
  fileId: number(),
  destinationPage: string(),
  name: string(),
  comments: string()
})

export async function pageFileRestoreAction(event: RequestEvent) {
  const { request, getClientAddress } = event
  const form = await superValidate(request, valibot(pageFileRestoreSchema))
  if (!form.valid) {
    return fail(400, { form })
  }

  try {
    const { siteId, pageId, fileId, newPage, newName, comments } = form.data
    const context = await resolvePageActionRequestContext(event, {
      submittedSiteId: siteId,
      session: "optional"
    })
    const userId = requirePageMutationUserId(context, siteId)
    const res = await pageFileRestore(
      withPageFileClientAddress(getClientAddress, {
        siteId,
        pageId,
        userId,
        fileId,
        newPage: newPage === "" ? undefined : newPage,
        newName: newName === "" ? undefined : newName,
        revisionComments: comments
      }),
      context.requestContext
    )

    return { form, res }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export const pageFileRestoreSchema = object({
  ...pageMutationBaseSchema,
  fileId: number(),
  newPage: string(),
  newName: string(),
  comments: string()
})

export async function pageFileHistoryAction(event: RequestEvent) {
  const { request } = event
  try {
    const requestData = await readActionJson(request, pageFileHistorySchema)

    const { siteId, pageId, fileId, revisionNumber, limit, offset, page, perPage } =
      requestData
    const context = await resolvePageActionRequestContext(event, {
      submittedSiteId: siteId
    })
    const res = await pageFileHistory(
      siteId,
      pageId,
      fileId,
      revisionNumber,
      limit,
      fileHistoryOffset(offset, page, perPage),
      context.requestContext
    )
    return { res }
  } catch (error) {
    return failForActionError(error)
  }
}

const pageFileHistorySchema = object({
  ...pageActionBaseSchema,
  fileId: number(),
  revisionNumber: optional(number()),
  limit: optional(number()),
  offset: optional(number()),
  page: optional(number()),
  perPage: optional(number())
})

export async function pageFileRollbackAction(event: RequestEvent) {
  const { request, getClientAddress } = event
  try {
    const requestData = await readActionJson(request, pageFileRollbackSchema)

    const { siteId, pageId, fileId, revisionNumber, lastRevisionId, comments } =
      requestData
    const context = await resolvePageActionRequestContext(event, {
      submittedSiteId: siteId,
      session: "optional"
    })
    const userId = requirePageMutationUserId(context, siteId)
    const res = await pageFileRollback(
      withPageFileClientAddress(getClientAddress, {
        siteId,
        pageId,
        userId,
        fileId,
        lastRevisionId,
        revisionNumber,
        revisionComments: comments
      }),
      context.requestContext
    )
    return { res }
  } catch (error) {
    return failForActionError(error)
  }
}

const pageFileRollbackSchema = object({
  ...pageMutationBaseSchema,
  fileId: number(),
  revisionNumber: number(),
  comments: optional(string())
})
