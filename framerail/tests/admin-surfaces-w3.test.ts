import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createTestViteServer } from "./vite-test-server.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const siteId = 23
const sessionToken = "admin-surfaces-session"
const ipAddress = "192.0.2.63"

const customDomain = {
  domain: "wiki.example.com",
  site_id: siteId,
  created_at: "2026-01-02T03:04:05Z",
  www_redirect: true
}
const role = {
  role_id: 7,
  site_id: siteId,
  name: "Moderator",
  description: "Handles the forums",
  from_wikidot: false,
  is_virtual: false,
  parent_role_id: null,
  created_at: "2026-01-02T03:04:05Z",
  updated_at: null,
  deleted_at: null
}
const decoratedPermission = {
  permission: { resource_type: "page", resource_category: null, action: "view" },
  active: true,
  addable: false,
  removable: true
}
const siteBan = {
  relation_id: 99,
  relation_type: "site-ban",
  dest_type: "site",
  dest_id: siteId,
  from_type: "user",
  from_id: 42,
  metadata: { banned_until: null, reason: "Spamming" },
  created_by: 41,
  created_at: "2026-02-03T04:05:06Z",
  overwritten_by: null,
  overwritten_at: null,
  deleted_by: null,
  deleted_at: null
}

let previousWorkingDirectory: any
let vite: any
let render: any
let readable: any
let client: any
let originalClientRequest: any
let actions: any
let loadAdminPage: any
let domainComponent: any
let rolesComponent: any
let blocksComponent: any
let serverModule: any

const parentData = async () => ({
  site: {
    site_id: siteId,
    settings_revision: 4,
    slug: "test",
    name: "Test Wiki",
    tagline: "",
    description: "",
    default_page: "start",
    welcome_page: "welcome",
    locale: "en",
    layout: "wikidot"
  },
  site_settings: {
    access_policy: "open",
    membership: {
      application_enabled: false,
      password_enabled: false,
      password_configured: false
    }
  },
  promoted_sites: [],
  site_file_domain: "test.wjfiles.localhost",
  license_name: "CC BY-SA 3.0",
  license_url: "https://creativecommons.org/licenses/by-sa/3.0/",
  locales: ["en-US", "en"]
})

const adminViewData = () => ({
  site_domain: "test.wikijump.dev.localhost",
  custom_domains: [customDomain],
  roles: [role],
  role_permissions: [decoratedPermission]
})

const installRpcMock = (calls: any[], data = adminViewData()) => {
  client.request = async (method: string, params: any, context: any) => {
    calls.push({ method, params, context })
    if (method === "admin_view") {
      return { type: "site_found", data: { categories: [], page_templates: [] } }
    }
    if (method === "translate") return {}
    if (method === "membership_application_list") return []
    if (method === "site_domain") return data.site_domain
    if (method === "custom_domain_list") return data.custom_domains
    if (method === "list_site_roles") return data.roles
    if (method === "get_decorated_role_permissions") return data.role_permissions
    if (method === "session_get") return { user_id: 41 }
    if (method === "user_get") return { user_id: 42, name: "Test User" }
    if (method === "site_ban_get") return siteBan
    if (method === "custom_domain_create") return undefined
    if (method === "custom_domain_remove") return undefined
    if (method === "role_create") return role
    if (method === "role_delete") return role
    if (method === "role_update_info") return role
    if (method === "role_update_permissions") return undefined
    if (method === "site_ban_set") return undefined
    if (method === "site_ban_remove") return siteBan
    throw new Error(`Unexpected Deepwell method ${method}`)
  }
}

const adminData = async (calls: any[], data = adminViewData()) => {
  installRpcMock(calls, data)
  const request = new Request("https://wikijump.test/--/admin", {
    headers: {
      "X-Wikijump-Site-Id": String(siteId),
      "X-Wikijump-Site-Slug": "test"
    }
  })
  return loadAdminPage(request, { get: () => sessionToken }, parentData)
}

const actionEvent = (
  action: string,
  fields: Record<string, unknown>,
  token: string | null = sessionToken
) => {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const item of value) data.append(name, String(item))
    } else {
      data.set(name, String(value))
    }
  }
  return {
    request: new Request(`https://wikijump.test/--/admin?/${action}`, {
      method: "POST",
      body: data,
      headers: {
        "X-Wikijump-Site-Id": String(siteId),
        "X-Wikijump-Site-Slug": "test"
      }
    }),
    cookies: { get: () => token },
    getClientAddress: () => ipAddress
  }
}

const requestContext = (data: any) => {
  const page = {
    data,
    error: null,
    form: null,
    params: {},
    route: { id: "/[x+2d]/admin" },
    state: {},
    status: 200,
    url: new URL("https://wikijump.test/--/admin")
  }
  const updated = readable(false)
  return new Map([
    ["__request__", { page }],
    [
      "__svelte__",
      {
        page: readable(page),
        navigating: readable(null),
        updated: { subscribe: updated.subscribe, check: async () => false }
      }
    ]
  ])
}

before(async () => {
  previousWorkingDirectory = process.cwd()
  process.chdir(root)
  vite = await createTestViteServer()
  ;({ render } = await vite.ssrLoadModule("svelte/server"))
  ;({ readable } = await vite.ssrLoadModule("svelte/store"))
  ;({ client } = await vite.ssrLoadModule("/src/lib/server/deepwell/index.ts"))
  originalClientRequest = client.request
  actions = await vite.ssrLoadModule("/src/lib/server/load/admin.ts")
  ;({ loadAdminPage } = actions)
  ;({ default: domainComponent } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/admin/CustomDomainSettings.svelte"
  ))
  ;({ default: rolesComponent } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/admin/PermissionsSettings.svelte"
  ))
  ;({ default: blocksComponent } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/admin/BlocksSettings.svelte"
  ))
  serverModule = await vite.ssrLoadModule("/src/routes/[x+2d]/admin/+page.server.ts")
})

after(async () => {
  if (client && originalClientRequest) client.request = originalClientRequest
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

test("admin surfaces load from the real domain and role endpoints", async () => {
  const calls: any[] = []
  const data = await adminData(calls)
  assert.deepEqual(
    calls.map((call) => call.method),
    [
      "admin_view",
      "translate",
      "membership_application_list",
      "site_domain",
      "custom_domain_list",
      "list_site_roles",
      "get_decorated_role_permissions"
    ]
  )
  assert.deepEqual(calls.find((call) => call.method === "site_domain").params, [siteId])
  assert.deepEqual(calls.find((call) => call.method === "custom_domain_list").params, {
    site_id: siteId
  })
  assert.deepEqual(calls.find((call) => call.method === "list_site_roles").params, {
    site_id: siteId
  })
  assert.deepEqual(
    calls.find((call) => call.method === "get_decorated_role_permissions").params,
    {
      site_id: siteId,
      role_reference: role.role_id,
      human_readable_categories: false
    }
  )
  assert.equal(data.siteAuthority, "test.wikijump.dev.localhost")
  assert.deepEqual(data.customDomains, [customDomain])
  assert.deepEqual(data.roles, [role])
  assert.deepEqual(data.rolePermissions, [[decoratedPermission]])
  assert.equal(data.domainForm.valid, true)
  assert.equal(data.roleForm.valid, true)
  assert.equal(data.blockLookupForm.valid, true)

  const domainBody = render(domainComponent, {
    props: { data },
    context: requestContext(data)
  }).body
  assert.match(domainBody, /Custom domain/u)
  assert.match(domainBody, /wiki\.example\.com/u)
  assert.match(domainBody, /test\.wikijump\.dev\.localhost/u)
  assert.match(domainBody, /\?\/customDomainCreate/u)

  const rolesBody = render(rolesComponent, {
    props: { data },
    context: requestContext(data)
  }).body
  assert.match(rolesBody, /Moderator/u)
  assert.match(rolesBody, /page:null:view|page:\*:view/u)
  assert.match(rolesBody, /\?\/roleCreate/u)
  assert.match(rolesBody, /\?\/rolePermissions/u)

  const blocksBody = render(blocksComponent, {
    props: { data },
    context: requestContext(data)
  }).body
  assert.match(blocksBody, /Block user|Check user/u)
  assert.match(blocksBody, /\?\/blockLookup/u)
})

test("custom domain actions use real endpoints and reject other sites", async () => {
  const calls: any[] = []
  installRpcMock(calls)
  const created = await actions.domainCreateAction(
    actionEvent("customDomainCreate", {
      siteId,
      domain: "Wiki.Example.com",
      wwwRedirect: true
    })
  )
  assert.equal(created.res, true)
  assert.deepEqual(
    calls.map((call) => call.method),
    ["session_get", "custom_domain_create"]
  )
  assert.deepEqual(calls.at(-1), {
    method: "custom_domain_create",
    params: { site_id: siteId, domain: "wiki.example.com", www_redirect: true },
    context: { sessionToken, siteId }
  })

  calls.length = 0
  const denied = await actions.domainCreateAction(
    actionEvent("customDomainCreate", {
      siteId: 999,
      domain: "other.example.com",
      wwwRedirect: false
    })
  )
  assert.equal(denied.status, 403)
  assert.deepEqual(calls, [])

  calls.length = 0
  const removed = await actions.domainRemoveAction(
    actionEvent("customDomainRemove", { siteId, domain: customDomain.domain })
  )
  assert.equal(removed.res, true)
  assert.deepEqual(calls, [
    {
      method: "custom_domain_list",
      params: { site_id: siteId },
      context: { sessionToken, siteId }
    },
    {
      method: "custom_domain_remove",
      params: [customDomain.domain],
      context: { sessionToken, siteId }
    }
  ])

  calls.length = 0
  const wrongDomain = await actions.domainRemoveAction(
    actionEvent("customDomainRemove", { siteId, domain: "someone-else.example.com" })
  )
  assert.equal(wrongDomain.status, 403)
  assert.equal(calls.length, 1)
})

test("role actions use real endpoints with session attribution", async () => {
  const calls: any[] = []
  installRpcMock(calls)
  const created = await actions.roleCreateAction(
    actionEvent("roleCreate", {
      siteId,
      name: "Reviewer",
      description: "Reviews drafts",
      parentRoleId: role.role_id
    })
  )
  assert.equal(created.res.role_id, role.role_id)
  assert.deepEqual(calls, [
    { method: "session_get", params: [sessionToken], context: undefined },
    {
      method: "list_site_roles",
      params: { site_id: siteId },
      context: { sessionToken, siteId }
    },
    {
      method: "role_create",
      params: {
        site_id: siteId,
        name: "Reviewer",
        description: "Reviews drafts",
        parent_role_id: role.role_id,
        creating_user_id: 41,
        ip_address: ipAddress
      },
      context: { sessionToken, siteId }
    }
  ])

  calls.length = 0
  const renamed = await actions.roleUpdateInfoAction(
    actionEvent("roleUpdateInfo", {
      siteId,
      roleId: role.role_id,
      name: "Senior moderator",
      description: "Updated description"
    })
  )
  assert.equal(renamed.res.role_id, role.role_id)
  assert.deepEqual(calls.at(-1), {
    method: "role_update_info",
    params: {
      site_id: siteId,
      role_id: role.role_id,
      name: "Senior moderator",
      description: "Updated description",
      updating_user_id: 41,
      ip_address: ipAddress
    },
    context: { sessionToken, siteId }
  })

  calls.length = 0
  const deleted = await actions.roleDeleteAction(
    actionEvent("roleDelete", { siteId, roleId: role.role_id, reparentChildren: true })
  )
  assert.equal(deleted.res.role_id, role.role_id)
  assert.deepEqual(calls.at(-1), {
    method: "role_delete",
    params: {
      site_id: siteId,
      role_id: role.role_id,
      deleting_user_id: 41,
      reparent_children: true,
      ip_address: ipAddress
    },
    context: { sessionToken, siteId }
  })

  calls.length = 0
  const permissions = await actions.rolePermissionsUpdateAction(
    actionEvent("rolePermissions", {
      siteId,
      roleId: role.role_id,
      permissions: JSON.stringify([decoratedPermission.permission])
    })
  )
  assert.equal(permissions.res, true)
  assert.deepEqual(calls.at(-1), {
    method: "role_update_permissions",
    params: {
      site_id: siteId,
      role_reference: role.role_id,
      new_permissions: [decoratedPermission.permission],
      cascade_removals: true,
      updating_user_id: 41,
      ip_address: ipAddress
    },
    context: { sessionToken, siteId }
  })

  calls.length = 0
  const denied = await actions.roleCreateAction(
    actionEvent("roleCreate", {
      siteId: 999,
      name: "Other",
      description: "",
      parentRoleId: role.role_id
    })
  )
  assert.equal(denied.status, 403)
  assert.deepEqual(calls, [])
})

test("block actions use the site ban endpoints with matching actor and IP", async () => {
  const calls: any[] = []
  installRpcMock(calls)
  const lookup = await actions.blockLookupAction(
    actionEvent("blockLookup", { siteId, userId: 42 })
  )
  assert.deepEqual(lookup.user, { user_id: 42, name: "Test User" })
  assert.deepEqual(lookup.ban, siteBan)
  assert.deepEqual(calls, [
    { method: "user_get", params: { user: 42 }, context: { sessionToken, siteId } },
    {
      method: "site_ban_get",
      params: { site_id: siteId, user_id: 42 },
      context: { sessionToken, siteId }
    }
  ])

  calls.length = 0
  const set = await actions.blockSetAction(
    actionEvent("blockSet", {
      siteId,
      userId: 42,
      reason: "Spamming",
      bannedUntil: "2026-12-31"
    })
  )
  assert.equal(set.res, true)
  assert.deepEqual(calls, [
    { method: "session_get", params: [sessionToken], context: undefined },
    {
      method: "site_ban_set",
      params: {
        site_id: siteId,
        user_id: 42,
        metadata: { banned_until: "2026-12-31", reason: "Spamming" },
        created_by: 41,
        ip_address: ipAddress
      },
      context: { sessionToken, siteId }
    }
  ])

  calls.length = 0
  const removed = await actions.blockRemoveAction(
    actionEvent("blockRemove", { siteId, userId: 42, reason: "Appealed" })
  )
  assert.equal(removed.res.relation_id, siteBan.relation_id)
  assert.deepEqual(calls.at(-1), {
    method: "site_ban_remove",
    params: {
      site_id: siteId,
      user_id: 42,
      removed_by: 41,
      reason: "Appealed",
      ip_address: ipAddress
    },
    context: { sessionToken, siteId }
  })

  calls.length = 0
  const anonymous = await actions.blockSetAction(
    actionEvent(
      "blockSet",
      { siteId, userId: 42, reason: "Spamming", bannedUntil: "" },
      null
    )
  )
  assert.equal(anonymous.status, 401)
  assert.deepEqual(calls, [])
})

test("the admin route exposes every new action", () => {
  assert.equal(typeof serverModule.actions.customDomainCreate, "function")
  assert.equal(typeof serverModule.actions.customDomainRemove, "function")
  assert.equal(typeof serverModule.actions.roleCreate, "function")
  assert.equal(typeof serverModule.actions.roleDelete, "function")
  assert.equal(typeof serverModule.actions.roleUpdateInfo, "function")
  assert.equal(typeof serverModule.actions.rolePermissions, "function")
  assert.equal(typeof serverModule.actions.blockLookup, "function")
  assert.equal(typeof serverModule.actions.blockSet, "function")
  assert.equal(typeof serverModule.actions.blockRemove, "function")
})
