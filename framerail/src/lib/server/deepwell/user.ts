import { limitLocalePreferences } from "$lib/locales"
import { client } from "$lib/server/deepwell"
import { withAnonymousSessionFallback } from "$lib/server/auth/get-session"
import { startBlobUpload, uploadToPresignUrl } from "./file"

import type {
  Nullable,
  Optional,
  UserModel,
  UserType,
  WikidotUserModel
} from "$lib/types"
import type { RequestContext } from "../request-context"

export type UserViewUser = UserModel | WikidotUserModel

export interface UserViewFound {
  type: "user_found"
  data: {
    user: UserViewUser
  }
}
export interface UserViewMissing {
  type: "user_missing"
  data?: never
}
export type UserViewResult = UserViewFound | UserViewMissing

export interface UserGetOutput {
  user_id: number
  user_type: UserType | "wikidot"
  name: Nullable<string>
  slug: Nullable<string>
  deleted_at?: Nullable<string>
  is_deleted?: boolean
  karma?: number
}

export async function userGet(
  userId: number,
  requestContext: RequestContext = {}
): Promise<Nullable<UserGetOutput>> {
  return client.request("user_get", { user: userId }, requestContext)
}

export async function userView(
  siteId: number,
  locales: string[],
  sessionToken: Optional<string>,
  username?: string
): Promise<UserViewResult> {
  return withAnonymousSessionFallback(sessionToken, (token) =>
    client.request("user_view", {
      site_id: siteId,
      session_token: token,
      locales,
      user: username
    })
  )
}

interface UserEditParams {
  expectedUserRevision?: Optional<number>
  name?: Optional<string>
  email?: Optional<string>
  currentPassword?: Optional<string>
  emailVerified?: Optional<boolean>
  password?: Optional<string>
  locales?: Optional<string[]>
  avatar?: Optional<File>
  removeAvatar?: boolean
  forumSignature?: Optional<Nullable<string>>
  realName?: Optional<Nullable<string>>
  gender?: Optional<Nullable<string>>
  birthday?: Optional<Nullable<string>>
  location?: Optional<Nullable<string>>
  biography?: Optional<Nullable<string>>
  website?: Optional<Nullable<string>>
  userPage?: Optional<Nullable<string>>
  bypassFilter?: boolean
}

const directUserEditFields = [
  ["name", "name"],
  ["email", "email"],
  ["emailVerified", "email_verified"],
  ["password", "password"]
] as const

const nullableUserEditFields = [
  ["forumSignature", "forum_signature"],
  ["realName", "real_name"],
  ["gender", "gender"],
  ["location", "location"],
  ["biography", "biography"],
  ["website", "website"],
  ["userPage", "user_page"]
] as const

export async function userEdit(
  userId: number,
  userIpAddr: string,
  params: UserEditParams,
  requestContext: RequestContext
): Promise<UserModel> {
  const data: Record<string, unknown> = {
    bypass_filter: params.bypassFilter ?? false
  }

  for (const [paramName, rpcName] of directUserEditFields) {
    const value = params[paramName]
    if (value !== undefined) data[rpcName] = value
  }
  if (params.expectedUserRevision !== undefined) {
    data.expected_user_revision = params.expectedUserRevision
  }
  if (params.currentPassword) data.current_password = params.currentPassword
  for (const [paramName, rpcName] of nullableUserEditFields) {
    const value = params[paramName]
    if (value !== undefined) data[rpcName] = value || null
  }

  if (params.birthday !== undefined) {
    data.birthday =
      params.birthday === null || isNaN(Date.parse(params.birthday))
        ? null
        : params.birthday
  }
  if (
    Array.isArray(params.locales) &&
    params.locales.every((v) => typeof v === "string")
  ) {
    data.locales = limitLocalePreferences(params.locales)
  }
  if (params.avatar instanceof File && params.avatar.type.startsWith("image/")) {
    const presign = await startBlobUpload(
      userId,
      params.avatar.size,
      "unscoped",
      requestContext
    )
    await uploadToPresignUrl(presign.presign_url, params.avatar)
    data.avatar_uploaded_blob_id = presign.pending_blob_id
  } else if (params.removeAvatar === true) {
    data.avatar_uploaded_blob_id = null
  }

  return client.request(
    "user_edit",
    {
      user: userId,
      ip_address: userIpAddr,
      ...data
    },
    requestContext
  )
}

export async function userPasswordChange(
  currentPassword: string,
  newPassword: string,
  userIpAddr: string,
  requestContext: RequestContext
): Promise<{ password_changed: boolean; other_sessions_revoked: number }> {
  return client.request(
    "user_password_change",
    {
      current_password: currentPassword,
      new_password: newPassword,
      ip_address: userIpAddr
    },
    requestContext
  )
}

interface UserCreate {
  user_id: number
  slug: string
}

interface UserCreateInput {
  userType: UserType
  name: string
  email: string
  locales: string[]
  password: string
  ipAddress: string
  passcode?: string
  bypassFilter?: boolean
  bypassEmailVerification?: boolean
}

export async function userCreate({
  userType,
  name,
  email,
  locales,
  password,
  ipAddress,
  passcode,
  bypassFilter = false,
  bypassEmailVerification = false
}: UserCreateInput): Promise<UserCreate> {
  return client.request("user_create", {
    user_type: userType,
    name,
    email,
    locales,
    password,
    ip_address: ipAddress,
    ...(passcode !== undefined ? { passcode } : {}),
    bypass_filter: bypassFilter,
    bypass_email_verification: bypassEmailVerification
  })
}

interface UserSelfActivateInput {
  claimToken: string
  email: string
  locales: string[]
  password: string
  ipAddress: string
}

export interface IssuedWikidotClaimToken {
  wikidot_user_id: number
  proof_kind: "staff_issued" | "wikidot_profile_challenge"
  token: string
  challenge_nonce: string | null
  expires_at: string
}

export async function wikidotClaimChallengeStart(
  wikidotUserId: number,
  ipAddress: string
): Promise<IssuedWikidotClaimToken> {
  return client.request("wikidot_claim_challenge_start", {
    wikidot_user_id: wikidotUserId,
    proof_kind: "wikidot_profile_challenge",
    ip_address: ipAddress
  })
}

export async function wikidotClaimChallengeVerify(
  token: string,
  ipAddress: string
): Promise<"staff_issued" | "wikidot_profile_challenge"> {
  return client.request("wikidot_claim_challenge_verify", {
    token,
    ip_address: ipAddress
  })
}

export async function userSelfActivateFromWikidot({
  claimToken,
  email,
  locales,
  password,
  ipAddress
}: UserSelfActivateInput): Promise<UserModel> {
  return client.request("user_self_activate_from_wikidot", {
    claim_token: claimToken,
    email,
    locales,
    password,
    ip_address: ipAddress
  })
}
