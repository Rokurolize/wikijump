import {
  layoutSchema,
  pageDeleteSchema,
  pageEditSchema,
  pageMoveSchema
} from "$lib/server/load/page/page-edit-actions"
import {
  pageFileEditSchema,
  pageFileMoveSchema,
  pageFileRestoreSchema,
  pageFileUploadSchema
} from "$lib/server/load/page/page-file-actions"
import { pageParentFormSchema } from "$lib/server/load/page/page-relation-actions"
import { pageRestoreSchema } from "$lib/server/load/page/page-revision-actions"
import { pageLockSchema } from "$lib/server/load/page/page-lock-actions"
import { superValidate } from "sveltekit-superforms"
import { valibot } from "sveltekit-superforms/adapters"

import type { PageView } from "$lib/server/deepwell/views"

export const buildPageForms = async (request: Request) => {
  const [
    pageDeleteForm,
    pageEditForm,
    fileUploadForm,
    fileEditForm,
    fileMoveForm,
    fileRestoreForm,
    layoutForm,
    pageMoveForm,
    pageParentForm,
    pageLockForm,
    pageRestoreForm
  ] = await Promise.all([
    superValidate(request, valibot(pageDeleteSchema)),
    superValidate(request, valibot(pageEditSchema)),
    superValidate(request, valibot(pageFileUploadSchema)),
    superValidate(request, valibot(pageFileEditSchema)),
    superValidate(request, valibot(pageFileMoveSchema)),
    superValidate(request, valibot(pageFileRestoreSchema)),
    superValidate(request, valibot(layoutSchema)),
    superValidate(request, valibot(pageMoveSchema)),
    superValidate(request, valibot(pageParentFormSchema)),
    superValidate(request, valibot(pageLockSchema)),
    superValidate(request, valibot(pageRestoreSchema))
  ])

  return {
    pageDeleteForm,
    pageEditForm,
    fileUploadForm,
    fileEditForm,
    fileMoveForm,
    fileRestoreForm,
    layoutForm,
    pageMoveForm,
    pageParentForm,
    pageLockForm,
    pageRestoreForm
  }
}

export const buildPageErrorForms = async (request: Request, response: PageView) => {
  const [pageEditForm, pageRestoreForm] = await Promise.all([
    superValidate(request, valibot(pageEditSchema)),
    superValidate(request, valibot(pageRestoreSchema))
  ])
  if (response.type === "missing" && response.data.new_page_wikitext !== null) {
    pageEditForm.data.wikitext = response.data.new_page_wikitext
  }

  return {
    pageEditForm,
    pageRestoreForm
  }
}
