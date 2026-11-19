import defaults from "$lib/defaults"
import { discussionUpdateValue } from "$lib/admin-forum.js"
import { licenseUpdateValue } from "$lib/admin/admin-license"
import { navigationUpdateValues } from "$lib/admin/admin-navigation"
import { isWikidotSiteLanguage } from "$lib/admin/wikidot-site-languages"
import { isGoogleAnalyticsProfile } from "$lib/site-settings.js"

import { authGetSession } from "$lib/server/auth/get-session"
import {
  siteBanGet,
  siteBanRemove,
  siteBanSet,
  userDisplayName
} from "$lib/server/deepwell/blocks"
import {
  customDomainCreate,
  customDomainList,
  customDomainRemove,
  siteDomain
} from "$lib/server/deepwell/domain"
import {
  getDecoratedRolePermissions,
  listSiteRoles,
  roleCreate,
  roleDelete,
  roleUpdateInfo,
  roleUpdatePermissions,
  type DecoratedRolePermission,
  type RoleModel,
  type RolePermission
} from "$lib/server/deepwell/role"
import {
  categoryLicenseUpdate,
  categoryNavigationUpdate,
  siteAccessPolicyUpdate,
  categoryDiscussionUpdate,
  categoryAutonumberUpdate,
  categoryRatingUpdate,
  categoryTemplateUpdate,
  categoryThemeUpdate,
  siteAnalyticsUpdate,
  siteForumNestingUpdate,
  siteIconsUpdate,
  siteMembershipUpdate,
  siteToolbarsUpdate,
  siteUpdate
} from "$lib/server/deepwell/admin"
import {
  membershipApplicationList,
  membershipApplicationReview
} from "$lib/server/deepwell/membership"
import { translate } from "$lib/server/deepwell/translate"
import {
  failForActionError,
  PageActionContextMismatchError,
  requireActionSession
} from "$lib/server/load/action-error"
import { adminView, type PreloadDataAsync } from "$lib/server/deepwell/views"
import { loadSiteInfo } from "$lib/server/load/site-info"
import { Layout } from "$lib/types"
import { error } from "@sveltejs/kit"
import { fail, superValidate } from "sveltekit-superforms"
import { valibot } from "sveltekit-superforms/adapters"
import {
  boolean,
  custom,
  literal,
  integer,
  maxValue,
  minValue,
  nullable,
  number,
  object,
  optional,
  pipe,
  string,
  maxLength,
  regex,
  enum as vEnum
} from "valibot"

import type { ThemeSetting, TranslateKeys } from "$lib/types"
import type { Cookies, RequestEvent } from "@sveltejs/kit"

export async function loadAdminPage(
  request: Request,
  cookies: Cookies,
  preloadData: PreloadDataAsync
) {
  const { siteId } = loadSiteInfo(request.headers)
  const sessionToken = cookies.get("wikijump_token")

  const parentData = await preloadData()
  const locales = parentData.locales

  const response = await adminView(siteId, locales, sessionToken)

  let translateKeys: TranslateKeys = {
    ...defaults.translateKeys,
    "footer-license-unless": {
      license: parentData.license_name,
      "license_url": parentData.license_url
    },
    "admin-unauthorized": {},
    "error-api.GENERIC": {}
  }

  const errorStatusByResponseType: Record<
    Awaited<ReturnType<typeof adminView>>["type"],
    number | null
  > = {
    site_found: null,
    admin_permissions: 401
  }
  const errorStatus = errorStatusByResponseType[response.type]

  if (errorStatus === null) {
    translateKeys = {
      ...translateKeys,

      "edit": {},
      "save": {},
      "cancel": {},

      "site-info.name": {},
      "site-info.slug": {},
      "site-info.tagline": {},
      "site-info.description": {},
      "site-info.default-page": {},
      "site-info.locale": {},
      "site-info.layout": {},
      "wiki-page-layout.default": {},
      "wiki-page-layout.wikidot": {},
      "wiki-page-layout.wikijump": {}
    }
  }

  const internationalization = await translate(locales, translateKeys)

  if (errorStatus !== null) {
    // The error body is serialized verbatim into this route's
    // __data.json response, so it carries only what the admin error
    // page renders. The admin forms below are built from site settings
    // and must never be part of an unauthorized response.
    error(errorStatus, {
      view: response.type,
      html: response.type === "admin_permissions" ? response.data.html : undefined,
      internationalization
    } as App.Error)
  }

  const adminForm = await superValidate(
    {
      name: parentData.site.name,
      slug: parentData.site.slug,
      tagline: parentData.site.tagline,
      description: parentData.site.description,
      defaultPage: parentData.site.default_page,
      welcomePage: parentData.site.welcome_page,
      locale: parentData.site.locale,
      expectedSettingsRevision: parentData.site.settings_revision,
      siteId: parentData.site.site_id
    },
    valibot(adminSchema)
  )
  const accessPolicyForm = await superValidate(
    {
      siteId,
      expectedSettingsRevision: parentData.site.settings_revision,
      accessPolicy: parentData.site_settings.access_policy ?? "open"
    },
    valibot(accessPolicySchema)
  )
  const navigationForm = await superValidate(request, valibot(navigationSchema))
  const licenseForm = await superValidate(request, valibot(licenseSchema))
  const templateForm = await superValidate(request, valibot(templateSchema))
  const ratingForm = await superValidate(request, valibot(ratingSchema))
  const siteIconsForm = await superValidate(request, valibot(siteIconsSchema))
  const forumNestingForm = await superValidate(request, valibot(forumNestingSchema))
  const discussionForm = await superValidate(request, valibot(discussionSchema))
  const analyticsForm = await superValidate(request, valibot(analyticsSchema))
  const toolbarForm = await superValidate(request, valibot(toolbarSchema))
  const membershipForm = await superValidate(
    {
      siteId,
      expectedSettingsRevision: parentData.site.settings_revision,
      applicationEnabled: parentData.site_settings.membership.application_enabled,
      passwordEnabled: parentData.site_settings.membership.password_enabled,
      password: ""
    },
    valibot(membershipSchema)
  )
  const membershipReviewForm = await superValidate(
    request,
    valibot(membershipReviewSchema)
  )
  const themeForm = await superValidate(request, valibot(themeSchema))
  const autonumberForm = await superValidate(request, valibot(autonumberSchema))
  const layoutForm = await superValidate(request, valibot(layoutSchema))
  const membershipApplications =
    response.type === "site_found" && sessionToken
      ? await membershipApplicationList(siteId, { sessionToken, siteId })
      : []

  const adminContext = sessionToken ? { sessionToken, siteId } : null
  const [siteAuthority, customDomains, roles] = adminContext
    ? await Promise.all([
        siteDomain(siteId, adminContext),
        customDomainList(siteId, adminContext),
        listSiteRoles(siteId, adminContext)
      ])
    : ["", [], []]
  const rolePermissions: DecoratedRolePermission[][] = adminContext
    ? await Promise.all(
        roles.map((role) =>
          getDecoratedRolePermissions(siteId, role.role_id, adminContext)
        )
      )
    : []

  const domainForm = await superValidate(
    { siteId, domain: "", wwwRedirect: false },
    valibot(domainSchema)
  )
  const roleForm = await superValidate(
    { siteId, name: "", description: "", parentRoleId: roles[0]?.role_id ?? 0 },
    valibot(roleSchema)
  )
  const blockLookupForm = await superValidate(
    { siteId, userId: 0 },
    valibot(blockLookupSchema)
  )

  const viewData = {
    view: response.type,
    html: response.type === "admin_permissions" ? response.data.html : undefined,
    internationalization,
    adminForm,
    accessPolicyForm,
    navigationForm,
    licenseForm,
    templateForm,
    ratingForm,
    siteIconsForm,
    forumNestingForm,
    discussionForm,
    analyticsForm,
    toolbarForm,
    membershipForm,
    membershipReviewForm,
    membershipApplications,
    themeForm,
    autonumberForm,
    layoutForm,
    domainForm,
    roleForm,
    blockLookupForm,
    siteAuthority,
    customDomains,
    roles,
    rolePermissions,
    categories: response.type === "site_found" ? response.data.categories : [],
    pageTemplates: response.type === "site_found" ? response.data.page_templates : []
  }

  return { ...parentData, ...viewData }
}

export async function accessPolicyAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const form = await superValidate(request, valibot(accessPolicySchema))
  if (!form.valid) return fail(400, { form })

  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, {
      form,
      message: "user does not have permission to edit access policy"
    })
  }

  try {
    const siteId = loadTrustedAdminSiteId(request, form.data.siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    const res = await siteAccessPolicyUpdate(
      siteId,
      form.data.expectedSettingsRevision,
      session.user_id,
      getClientAddress(),
      form.data.accessPolicy,
      { sessionToken, siteId }
    )
    return { form, res }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export async function domainCreateAction({ request, cookies }: RequestEvent) {
  const form = await superValidate(request, valibot(domainSchema))
  if (!form.valid) return fail(400, { form })

  if (form.data.domain.trim().length === 0) {
    return fail(400, { form, message: "A domain name is required." })
  }

  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, {
      form,
      message: "user does not have permission to edit custom domains"
    })
  }

  try {
    const siteId = loadTrustedAdminSiteId(request, form.data.siteId)
    requireActionSession(await authGetSession(sessionToken))
    await customDomainCreate(
      siteId,
      form.data.domain.trim().toLowerCase(),
      form.data.wwwRedirect,
      { sessionToken, siteId }
    )
    return { form, res: true }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export async function domainRemoveAction({ request, cookies }: RequestEvent) {
  const data = await request.formData()
  const form = {
    siteId: submittedInteger(data, "siteId"),
    domain: submittedText(data, "domain")
  }
  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, {
      ...form,
      message: "user does not have permission to edit custom domains"
    })
  }

  try {
    const siteId = loadTrustedAdminSiteId(request, form.siteId)
    const context = { sessionToken, siteId }
    const domains = await customDomainList(siteId, context)
    if (!domains.some((entry) => entry.domain === form.domain)) {
      throw new PageActionContextMismatchError("Permission denied.")
    }
    await customDomainRemove(form.domain, context)
    return { ...form, res: true }
  } catch (error) {
    return failForActionError(error, form)
  }
}

export async function roleCreateAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const form = await superValidate(request, valibot(roleSchema))
  if (!form.valid) return fail(400, { form })
  if (form.data.name.trim().length === 0 || form.data.parentRoleId <= 0) {
    return fail(400, { form, message: "A name and parent role are required." })
  }

  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, {
      form,
      message: "user does not have permission to manage roles"
    })
  }

  try {
    const siteId = loadTrustedAdminSiteId(request, form.data.siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    const context = { sessionToken, siteId }
    await requireSiteRole(siteId, form.data.parentRoleId, context)
    const res = await roleCreate(
      {
        siteId,
        name: form.data.name.trim(),
        description: form.data.description.trim(),
        parentRoleId: form.data.parentRoleId,
        creatingUserId: session.user_id,
        ipAddress: getClientAddress()
      },
      context
    )
    return { form, res }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export async function roleDeleteAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const data = await request.formData()
  const form = {
    siteId: submittedInteger(data, "siteId"),
    roleId: submittedInteger(data, "roleId"),
    reparentChildren: data.get("reparentChildren") === "true"
  }
  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, {
      ...form,
      message: "user does not have permission to manage roles"
    })
  }

  try {
    const siteId = loadTrustedAdminSiteId(request, form.siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    const context = { sessionToken, siteId }
    const role = await requireSiteRole(siteId, form.roleId, context)
    if (role.is_virtual) {
      throw new PageActionContextMismatchError("Permission denied.")
    }
    const res = await roleDelete(
      {
        siteId,
        roleId: form.roleId,
        deletingUserId: session.user_id,
        reparentChildren: form.reparentChildren,
        ipAddress: getClientAddress()
      },
      context
    )
    return { ...form, res }
  } catch (error) {
    return failForActionError(error, form)
  }
}

export async function roleUpdateInfoAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const data = await request.formData()
  const form = {
    siteId: submittedInteger(data, "siteId"),
    roleId: submittedInteger(data, "roleId"),
    name: submittedText(data, "name"),
    description: submittedText(data, "description")
  }
  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, {
      ...form,
      message: "user does not have permission to manage roles"
    })
  }

  try {
    const siteId = loadTrustedAdminSiteId(request, form.siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    const context = { sessionToken, siteId }
    const role = await requireSiteRole(siteId, form.roleId, context)
    if (role.is_virtual) {
      throw new PageActionContextMismatchError("Permission denied.")
    }
    if (
      form.name.length === 0 ||
      form.name.length > 100 ||
      form.description.length > 500
    ) {
      return fail(400, { ...form, message: "Invalid role details." })
    }
    const res = await roleUpdateInfo(
      {
        siteId,
        roleId: form.roleId,
        name: form.name,
        description: form.description,
        updatingUserId: session.user_id,
        ipAddress: getClientAddress()
      },
      context
    )
    return { ...form, res }
  } catch (error) {
    return failForActionError(error, form)
  }
}

export async function rolePermissionsUpdateAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const data = await request.formData()
  const form = {
    siteId: submittedInteger(data, "siteId"),
    roleId: submittedInteger(data, "roleId"),
    permissions: data.get("permissions")
  }
  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, { message: "user does not have permission to manage roles" })
  }

  try {
    const siteId = loadTrustedAdminSiteId(request, form.siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    const context = { sessionToken, siteId }
    await requireSiteRole(siteId, form.roleId, context)
    let permissions: RolePermission[]
    try {
      permissions = parseRolePermissions(form.permissions)
    } catch {
      return fail(400, { siteId, roleId: form.roleId, message: "Invalid permissions." })
    }
    await roleUpdatePermissions(
      {
        siteId,
        roleId: form.roleId,
        permissions,
        cascadeRemovals: true,
        updatingUserId: session.user_id,
        ipAddress: getClientAddress()
      },
      context
    )
    return { siteId, roleId: form.roleId, res: true }
  } catch (error) {
    return failForActionError(error, { siteId: form.siteId, roleId: form.roleId })
  }
}

export async function blockLookupAction({ request, cookies }: RequestEvent) {
  const form = await superValidate(request, valibot(blockLookupSchema))
  if (!form.valid) return fail(400, { form })
  if (form.data.userId <= 0) {
    return fail(400, { form, message: "A user ID is required." })
  }

  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, {
      form,
      message: "user does not have permission to view site blocks"
    })
  }

  try {
    const siteId = loadTrustedAdminSiteId(request, form.data.siteId)
    const context = { sessionToken, siteId }
    const [user, ban] = await Promise.all([
      userDisplayName(form.data.userId, context),
      siteBanGet(siteId, form.data.userId, context)
    ])
    return { form, user, ban }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export async function blockSetAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const data = await request.formData()
  const form = {
    siteId: submittedInteger(data, "siteId"),
    userId: submittedInteger(data, "userId"),
    reason: submittedText(data, "reason"),
    bannedUntil: submittedText(data, "bannedUntil")
  }
  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, {
      ...form,
      message: "user does not have permission to manage blocks"
    })
  }

  try {
    const siteId = loadTrustedAdminSiteId(request, form.siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    if (form.userId <= 0 || form.reason.length === 0 || form.reason.length > 200) {
      return fail(400, { ...form, message: "Invalid block details." })
    }
    if (form.bannedUntil !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(form.bannedUntil)) {
      return fail(400, { ...form, message: "Invalid expiration date." })
    }
    await siteBanSet(
      {
        siteId,
        userId: form.userId,
        reason: form.reason,
        bannedUntil: form.bannedUntil === "" ? null : form.bannedUntil,
        createdBy: session.user_id,
        ipAddress: getClientAddress()
      },
      { sessionToken, siteId }
    )
    return { ...form, res: true }
  } catch (error) {
    return failForActionError(error, form)
  }
}

export async function blockRemoveAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const data = await request.formData()
  const form = {
    siteId: submittedInteger(data, "siteId"),
    userId: submittedInteger(data, "userId"),
    reason: submittedText(data, "reason")
  }
  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, {
      ...form,
      message: "user does not have permission to manage blocks"
    })
  }

  try {
    const siteId = loadTrustedAdminSiteId(request, form.siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    if (form.userId <= 0 || form.reason.length === 0 || form.reason.length > 200) {
      return fail(400, { ...form, message: "Invalid block details." })
    }
    const res = await siteBanRemove(
      {
        siteId,
        userId: form.userId,
        reason: form.reason,
        removedBy: session.user_id,
        ipAddress: getClientAddress()
      },
      { sessionToken, siteId }
    )
    return { ...form, res }
  } catch (error) {
    return failForActionError(error, form)
  }
}

function submittedText(data: FormData, name: string): string {
  const value = data.get(name)
  return typeof value === "string" ? value.trim() : ""
}

function submittedInteger(data: FormData, name: string): number {
  const value = Number(data.get(name))
  return Number.isSafeInteger(value) ? value : -1
}

async function requireSiteRole(
  siteId: number,
  roleId: number,
  context: { sessionToken: string; siteId: number }
): Promise<RoleModel> {
  const roles = await listSiteRoles(siteId, context)
  const role = roles.find((entry) => entry.role_id === roleId)
  if (!role) {
    throw new PageActionContextMismatchError("Permission denied.")
  }
  return role
}

function parseRolePermissions(value: FormDataEntryValue | null): RolePermission[] {
  if (typeof value !== "string") {
    throw new Error("Invalid permissions.")
  }
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid permissions.")
  }
  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Invalid permissions.")
    }
    const permission = entry as Record<string, unknown>
    if (
      typeof permission.resource_type !== "string" ||
      typeof permission.action !== "string" ||
      (permission.resource_category !== null &&
        typeof permission.resource_category !== "string" &&
        typeof permission.resource_category !== "number")
    ) {
      throw new Error("Invalid permissions.")
    }
    return {
      resource_type: permission.resource_type,
      resource_category: permission.resource_category as string | number | null,
      action: permission.action
    }
  })
}

export async function siteIconsAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const form = await superValidate(request, valibot(siteIconsSchema))
  if (!form.valid) return fail(400, { form })

  let siteId: number
  try {
    siteId = loadTrustedAdminSiteId(request, form.data.siteId)
  } catch (error) {
    return failForActionError(error, { form })
  }

  const sessionToken = cookies.get("wikijump_token")
  const session = await authGetSession(sessionToken)
  if (!sessionToken || !session) {
    return fail(401, {
      form,
      message: "user does not have permission to edit this site's icons"
    })
  }

  try {
    const res = await siteIconsUpdate(
      siteId,
      form.data.expectedSettingsRevision,
      session.user_id,
      getClientAddress(),
      {
        faviconSource: emptyToNull(form.data.faviconSource),
        iosIconSource: emptyToNull(form.data.iosIconSource),
        windowsTileSource: emptyToNull(form.data.windowsTileSource)
      },
      { sessionToken, siteId }
    )
    return { form, res }
  } catch (error) {
    const details = error as {
      message?: string
      code?: string
      data?: Record<string, unknown>
    }
    return fail(500, {
      form,
      message: details.message,
      code: details.code,
      data: details.data
    })
  }
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function forumNestingAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const form = await superValidate(request, valibot(forumNestingSchema))
  if (!form.valid) return fail(400, { form })

  let siteId: number
  try {
    siteId = loadTrustedAdminSiteId(request, form.data.siteId)
  } catch (error) {
    return failForActionError(error, { form })
  }

  const sessionToken = cookies.get("wikijump_token")
  const session = await authGetSession(sessionToken)
  if (!sessionToken || !session) {
    return fail(401, {
      form,
      message: "user does not have permission to edit this site's forum settings"
    })
  }

  try {
    const res = await siteForumNestingUpdate(
      siteId,
      form.data.expectedSettingsRevision,
      session.user_id,
      getClientAddress(),
      form.data.maxNestLevel,
      { sessionToken, siteId }
    )
    return { form, res }
  } catch (error) {
    const details = error as {
      message?: string
      code?: string
      data?: Record<string, unknown>
    }
    return fail(500, {
      form,
      message: details.message,
      code: details.code,
      data: details.data
    })
  }
}

export async function discussionAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const form = await superValidate(request, valibot(discussionSchema))
  if (!form.valid) return fail(400, { form })

  let siteId: number
  try {
    siteId = loadTrustedAdminSiteId(request, form.data.siteId)
  } catch (error) {
    return failForActionError(error, { form })
  }

  const sessionToken = cookies.get("wikijump_token")
  const session = await authGetSession(sessionToken)
  if (!sessionToken || !session) {
    return fail(401, {
      form,
      message: "user does not have permission to edit this site's discussion settings"
    })
  }

  try {
    const res = await categoryDiscussionUpdate(
      siteId,
      form.data.categoryId,
      session.user_id,
      getClientAddress(),
      discussionUpdateValue(form.data),
      { sessionToken, siteId }
    )
    return { form, res }
  } catch (error) {
    const details = error as {
      message?: string
      code?: string
      data?: Record<string, unknown>
    }
    return fail(500, {
      form,
      message: details.message,
      code: details.code,
      data: details.data
    })
  }
}

export async function templateAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const form = await superValidate(request, valibot(templateSchema))
  if (!form.valid) return fail(400, { form })

  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, {
      form,
      message: "user does not have permission to edit this site's page templates"
    })
  }

  const { siteId, categoryId, templatePageId } = form.data
  try {
    const trustedSiteId = loadTrustedAdminSiteId(request, siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    const res = await categoryTemplateUpdate(
      {
        siteId: trustedSiteId,
        categoryId,
        userId: session.user_id,
        userIpAddr: getClientAddress(),
        templatePageId
      },
      { sessionToken, siteId: trustedSiteId }
    )
    return { form, res }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export async function licenseAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const form = await superValidate(request, valibot(licenseSchema))
  if (!form.valid) return fail(400, { form })

  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, {
      form,
      message: "user does not have permission to edit this site's license"
    })
  }

  const { siteId, categoryId } = form.data
  const { license, licenseOther } = licenseUpdateValue(form.data)
  try {
    const trustedSiteId = loadTrustedAdminSiteId(request, siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    const res = await categoryLicenseUpdate(
      {
        siteId: trustedSiteId,
        categoryId,
        userId: session.user_id,
        userIpAddr: getClientAddress(),
        license,
        licenseOther
      },
      { sessionToken, siteId: trustedSiteId }
    )
    return { form, res }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export async function ratingAction({ request, getClientAddress, cookies }: RequestEvent) {
  const form = await superValidate(request, valibot(ratingSchema))
  if (!form.valid) return fail(400, { form })

  let siteId: number
  try {
    siteId = loadTrustedAdminSiteId(request, form.data.siteId)
  } catch (error) {
    return failForActionError(error, { form })
  }

  const sessionToken = cookies.get("wikijump_token")
  const session = await authGetSession(sessionToken)
  if (!sessionToken || !session) {
    return fail(401, {
      form,
      message: "user does not have permission to edit this site's rating settings"
    })
  }

  const { categoryId, inherit, enabled, permission, visibility, ratingType } = form.data
  try {
    const res = await categoryRatingUpdate(
      siteId,
      categoryId,
      session.user_id,
      getClientAddress(),
      inherit ? null : enabled,
      inherit ? null : permission,
      inherit ? null : visibility,
      inherit ? null : ratingType,
      { sessionToken, siteId }
    )
    return { form, res }
  } catch (error) {
    const details = error as {
      message?: string
      code?: string
      data?: Record<string, unknown>
    }
    return fail(500, {
      form,
      message: details.message,
      code: details.code,
      data: details.data
    })
  }
}

export async function navigationAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const form = await superValidate(request, valibot(navigationSchema))
  if (!form.valid) return fail(400, { form })

  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, {
      form,
      message: "user does not have permission to edit this site's navigation"
    })
  }

  const { siteId, categoryId } = form.data
  const { topBarPage, sideBarPage } = navigationUpdateValues(form.data)
  try {
    const trustedSiteId = loadTrustedAdminSiteId(request, siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    const res = await categoryNavigationUpdate(
      {
        siteId: trustedSiteId,
        categoryId,
        userId: session.user_id,
        userIpAddr: getClientAddress(),
        topBarPage,
        sideBarPage
      },
      { sessionToken, siteId: trustedSiteId }
    )
    return { form, res }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export async function analyticsAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const form = await superValidate(request, valibot(analyticsSchema))
  if (!form.valid) return fail(400, { form })
  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, { form, message: "user does not have permission to edit analytics" })
  }
  try {
    const siteId = loadTrustedAdminSiteId(request, form.data.siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    const res = await siteAnalyticsUpdate(
      siteId,
      form.data.expectedSettingsRevision,
      session.user_id,
      getClientAddress(),
      form.data.enabled,
      form.data.profile,
      { sessionToken, siteId }
    )
    return { form, res }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export async function toolbarAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const form = await superValidate(request, valibot(toolbarSchema))
  if (!form.valid) return fail(400, { form })
  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, { form, message: "user does not have permission to edit toolbars" })
  }
  try {
    const siteId = loadTrustedAdminSiteId(request, form.data.siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    const res = await siteToolbarsUpdate(
      siteId,
      form.data.expectedSettingsRevision,
      session.user_id,
      getClientAddress(),
      form.data.top,
      form.data.bottom,
      form.data.promote,
      { sessionToken, siteId }
    )
    return { form, res }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export async function membershipAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const form = await superValidate(request, valibot(membershipSchema))
  if (!form.valid) return fail(400, { form })
  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, {
      form,
      message: "user does not have permission to edit membership"
    })
  }
  try {
    const siteId = loadTrustedAdminSiteId(request, form.data.siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    const res = await siteMembershipUpdate(
      siteId,
      form.data.expectedSettingsRevision,
      session.user_id,
      getClientAddress(),
      form.data.applicationEnabled,
      form.data.passwordEnabled,
      form.data.password.trim() === "" ? null : form.data.password,
      { sessionToken, siteId }
    )
    return { form, res }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export async function membershipReviewAction({
  request,
  cookies,
  getClientAddress
}: RequestEvent) {
  const form = await superValidate(request, valibot(membershipReviewSchema))
  if (!form.valid) return fail(400, { form })
  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, {
      form,
      message: "user does not have permission to review membership applications"
    })
  }
  try {
    const siteId = loadTrustedAdminSiteId(request, form.data.siteId)
    requireActionSession(await authGetSession(sessionToken))
    const res = await membershipApplicationReview(
      siteId,
      form.data.userId,
      form.data.decision,
      form.data.reply,
      getClientAddress(),
      { sessionToken, siteId }
    )
    return { form, res }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export async function themeAction({ request, getClientAddress, cookies }: RequestEvent) {
  const form = await superValidate(request, valibot(themeSchema))
  if (!form.valid) return fail(400, { form })
  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, { form, message: "user does not have permission to edit themes" })
  }
  const theme: ThemeSetting =
    form.data.themeType === "built_in"
      ? { type: "built_in", id: form.data.builtinId }
      : form.data.themeType === "external"
        ? { type: "external", url: form.data.externalUrl }
        : form.data.themeType === "custom"
          ? { type: "custom", css: form.data.customCss }
          : { type: "inherit" }
  try {
    const siteId = loadTrustedAdminSiteId(request, form.data.siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    const res = await categoryThemeUpdate(
      siteId,
      form.data.categoryId,
      form.data.expectedSettingsRevision,
      session.user_id,
      getClientAddress(),
      theme,
      { sessionToken, siteId }
    )
    return { form, res }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export async function autonumberAction({
  request,
  getClientAddress,
  cookies
}: RequestEvent) {
  const form = await superValidate(request, valibot(autonumberSchema))
  if (!form.valid) return fail(400, { form })
  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, {
      form,
      message: "user does not have permission to edit autonumbering"
    })
  }
  try {
    const siteId = loadTrustedAdminSiteId(request, form.data.siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    const res = await categoryAutonumberUpdate(
      siteId,
      form.data.categoryId,
      form.data.expectedSettingsRevision,
      session.user_id,
      getClientAddress(),
      form.data.enabled,
      { sessionToken, siteId }
    )
    return { form, res }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export async function layoutAction({ request, getClientAddress, cookies }: RequestEvent) {
  const form = await superValidate(request, valibot(layoutSchema))
  if (!form.valid) return fail(400, { form })
  const sessionToken = cookies.get("wikijump_token")
  if (!sessionToken) {
    return fail(401, { form, message: "user does not have permission to edit layout" })
  }
  try {
    const siteId = loadTrustedAdminSiteId(request, form.data.siteId)
    const session = requireActionSession(await authGetSession(sessionToken))
    const res = await siteUpdate(
      {
        siteId,
        expectedSettingsRevision: form.data.expectedSettingsRevision,
        userId: session.user_id,
        userIpAddr: getClientAddress(),
        name: undefined,
        slug: undefined,
        tagline: undefined,
        description: undefined,
        defaultPage: undefined,
        welcomePage: undefined,
        locale: undefined,
        layout: form.data.layout
      },
      { sessionToken, siteId }
    )
    return { form, res }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

export async function adminAction({ request, getClientAddress, cookies }: RequestEvent) {
  const form = await superValidate(request, valibot(adminSchema))

  if (!form.valid) {
    return fail(400, { form })
  }

  const sessionToken = cookies.get("wikijump_token")
  const ipAddress = getClientAddress()

  try {
    if (form.data.action === "edit") {
      if (!sessionToken) {
        return fail(401, {
          form,
          message: "user does not have permission to edit this site"
        })
      }
      const session = requireActionSession(await authGetSession(sessionToken))

      const {
        name,
        slug,
        tagline,
        description,
        defaultPage,
        welcomePage,
        locale,
        siteId,
        expectedSettingsRevision
      } = form.data
      const trustedSiteId = loadTrustedAdminSiteId(request, siteId)

      const res = await siteUpdate(
        {
          siteId: trustedSiteId,
          expectedSettingsRevision,
          userId: session.user_id,
          userIpAddr: ipAddress,
          name,
          slug,
          tagline,
          description,
          defaultPage,
          welcomePage,
          locale,
          layout: undefined
        },
        { sessionToken, siteId: trustedSiteId }
      )

      return { form, res }
    }

    return { form, res: null }
  } catch (error) {
    return failForActionError(error, { form })
  }
}

function loadTrustedAdminSiteId(request: Request, submittedSiteId: number): number {
  const { siteId } = loadSiteInfo(request.headers)
  if (submittedSiteId !== siteId) {
    throw new PageActionContextMismatchError("Permission denied.")
  }
  return siteId
}

const adminSchema = object({
  name: string(),
  slug: string(),
  tagline: string(),
  description: string(),
  defaultPage: string(),
  welcomePage: string(),
  locale: pipe(string(), custom(isWikidotSiteLanguage, "Unsupported site language")),
  expectedSettingsRevision: pipe(number(), integer(), minValue(0)),
  siteId: number(),
  action: optional(nullable(literal("edit")))
})

const accessPolicySchema = object({
  siteId: number(),
  expectedSettingsRevision: pipe(number(), integer(), minValue(0)),
  accessPolicy: vEnum({
    OPEN: "open",
    CLOSED: "closed",
    PRIVATE: "private"
  })
})

const layoutSchema = object({
  siteId: number(),
  expectedSettingsRevision: pipe(number(), integer(), minValue(0)),
  layout: nullable(vEnum(Layout))
})

const analyticsSchema = object({
  siteId: number(),
  expectedSettingsRevision: pipe(number(), integer(), minValue(0)),
  enabled: boolean(),
  profile: pipe(
    string(),
    custom(
      (value) => value === "" || isGoogleAnalyticsProfile(value),
      "Wrong analytics key"
    )
  )
})

const toolbarSchema = object({
  siteId: number(),
  expectedSettingsRevision: pipe(number(), integer(), minValue(0)),
  top: boolean(),
  bottom: boolean(),
  promote: boolean()
})

const membershipSchema = object({
  siteId: number(),
  expectedSettingsRevision: pipe(number(), integer(), minValue(0)),
  applicationEnabled: boolean(),
  passwordEnabled: boolean(),
  password: pipe(string(), maxLength(50))
})

const membershipReviewSchema = object({
  siteId: number(),
  userId: number(),
  decision: vEnum({ ACCEPT: "accept", DECLINE: "decline" }),
  reply: pipe(string(), maxLength(200))
})

const themeSchema = object({
  siteId: number(),
  categoryId: number(),
  expectedSettingsRevision: pipe(number(), integer(), minValue(0)),
  themeType: vEnum({
    INHERIT: "inherit",
    BUILT_IN: "built_in",
    EXTERNAL: "external",
    CUSTOM: "custom"
  }),
  builtinId: pipe(number(), integer(), minValue(1)),
  externalUrl: string(),
  customCss: pipe(string(), maxLength(65_535))
})

const autonumberSchema = object({
  siteId: number(),
  categoryId: number(),
  expectedSettingsRevision: pipe(number(), integer(), minValue(0)),
  enabled: boolean()
})

const navigationSchema = object({
  siteId: number(),
  categoryId: number(),
  inherit: boolean(),
  topBarPage: string(),
  sideBarPage: string()
})

const licenseSchema = object({
  siteId: number(),
  categoryId: number(),
  inherit: boolean(),
  license: string(),
  licenseOther: pipe(string(), maxLength(300))
})

const templateSchema = object({
  siteId: number(),
  categoryId: number(),
  templatePageId: nullable(number())
})

const ratingSchema = object({
  siteId: number(),
  categoryId: number(),
  inherit: boolean(),
  enabled: boolean(),
  permission: vEnum({ REGISTERED: "registered", MEMBERS: "members" }),
  visibility: vEnum({ VISIBLE: "visible", ANONYMOUS: "anonymous" }),
  ratingType: vEnum({ PLUS: "plus", PLUS_MINUS: "plus_minus", STARS: "stars" })
})

const siteIconsSchema = object({
  siteId: number(),
  expectedSettingsRevision: pipe(number(), integer(), minValue(0)),
  faviconSource: optional(string(), ""),
  iosIconSource: optional(string(), ""),
  windowsTileSource: optional(string(), "")
})

const forumNestingSchema = object({
  siteId: number(),
  expectedSettingsRevision: pipe(number(), integer(), minValue(0)),
  maxNestLevel: pipe(number(), integer(), minValue(0), maxValue(10))
})

const discussionSchema = object({
  siteId: number(),
  categoryId: number(),
  state: vEnum({ DEFAULT: "default", ENABLE: "enable", DISABLE: "disable" })
})

const domainSchema = object({
  siteId: number(),
  domain: pipe(string(), maxLength(253), regex(/^[A-Za-z0-9.-]*$/)),
  wwwRedirect: boolean()
})

const roleSchema = object({
  siteId: number(),
  name: pipe(string(), maxLength(100)),
  description: pipe(string(), maxLength(500)),
  parentRoleId: number()
})

const blockLookupSchema = object({
  siteId: number(),
  userId: number()
})
