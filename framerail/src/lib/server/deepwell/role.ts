import { client } from "$lib/server/deepwell"

import type { RequestContext } from "$lib/server/request-context"

export interface RoleModel {
  role_id: number
  site_id: number
  name: string
  description: string
  from_wikidot: boolean
  is_virtual: boolean
  parent_role_id: number | null
  revision: number
  created_at: string
  updated_at: string | null
  deleted_at: string | null
}

export interface RolePermission {
  resource_type: string
  resource_category: string | number | null
  action: string
}

export interface DecoratedRolePermission {
  permission: RolePermission
  active: boolean
  addable: boolean
  removable: boolean
}

export async function listSiteRoles(
  siteId: number,
  context: RequestContext = {}
): Promise<RoleModel[]> {
  return client.request("list_site_roles", { site_id: siteId }, context)
}

export async function getDecoratedRolePermissions(
  siteId: number,
  roleId: number,
  context: RequestContext = {}
): Promise<DecoratedRolePermission[]> {
  return client.request(
    "get_decorated_role_permissions",
    {
      site_id: siteId,
      role_reference: roleId,
      human_readable_categories: false
    },
    context
  )
}

export async function roleCreate(
  input: {
    siteId: number
    name: string
    description: string
    parentRoleId: number
    creatingUserId: number
    ipAddress: string
  },
  context: RequestContext = {}
): Promise<RoleModel> {
  return client.request(
    "role_create",
    {
      site_id: input.siteId,
      name: input.name,
      description: input.description,
      parent_role_id: input.parentRoleId,
      creating_user_id: input.creatingUserId,
      ip_address: input.ipAddress
    },
    context
  )
}

export async function roleDelete(
  input: {
    siteId: number
    roleId: number
    deletingUserId: number
    reparentChildren: boolean
    ipAddress: string
  },
  context: RequestContext = {}
): Promise<RoleModel> {
  return client.request(
    "role_delete",
    {
      site_id: input.siteId,
      role_id: input.roleId,
      deleting_user_id: input.deletingUserId,
      reparent_children: input.reparentChildren,
      ip_address: input.ipAddress
    },
    context
  )
}

export async function roleUpdateInfo(
  input: {
    siteId: number
    roleId: number
    expectedRoleRevision: number
    name: string
    description: string
    updatingUserId: number
    ipAddress: string
  },
  context: RequestContext = {}
): Promise<RoleModel> {
  return client.request(
    "role_update_info",
    {
      site_id: input.siteId,
      role_id: input.roleId,
      expected_role_revision: input.expectedRoleRevision,
      name: input.name,
      description: input.description,
      updating_user_id: input.updatingUserId,
      ip_address: input.ipAddress
    },
    context
  )
}

export async function roleUpdatePermissions(
  input: {
    siteId: number
    roleId: number
    expectedRoleRevision: number
    permissions: RolePermission[]
    cascadeRemovals: boolean
    updatingUserId: number
    ipAddress: string
  },
  context: RequestContext = {}
): Promise<void> {
  return client.request(
    "role_update_permissions",
    {
      site_id: input.siteId,
      role_reference: input.roleId,
      expected_role_revision: input.expectedRoleRevision,
      new_permissions: input.permissions,
      cascade_removals: input.cascadeRemovals,
      updating_user_id: input.updatingUserId,
      ip_address: input.ipAddress
    },
    context
  )
}
