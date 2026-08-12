export const WIKIDOT_USER_INFO_MISSING = "User does not exist."

/**
 * @typedef {{
 *   user_id: number
 *   user_type: "regular" | "system" | "site" | "bot"
 *   created_at: string
 *   name: string
 *   slug: string
 *   avatar_s3_hash: number[] | null
 * }} LocalUserViewUser
 *
 *
 * @typedef {{
 *   user_id: number
 *   user_type: "wikidot"
 *   created_at: string
 *   fetched_at: string
 *   is_deleted: boolean
 *   name: string | null
 *   slug: string | null
 *   avatar_s3_hash: number[] | null
 *   real_name: string | null
 *   gender: string | null
 *   birthday: string | null
 *   location: string | null
 *   biography: string | null
 *   website: string | null
 *   karma: number
 *   is_pro: boolean
 * }} ImportedUserViewUser
 *
 *
 * @typedef {LocalUserViewUser | ImportedUserViewUser} UserViewUser
 *
 * @typedef {{ type: "user_found"; data: { user: UserViewUser } }
 *   | { type: "user_missing" }} UserViewResult
 *
 *
 * @typedef {(
 *   siteId: number,
 *   locales: string[],
 *   sessionToken: undefined,
 *   target: string
 * ) => Promise<UserViewResult>} UserView
 *
 *
 * @typedef {(hash: number[]) => Promise<string>} LoadAvatar
 *
 * @typedef {{
 *   userId: number
 *   name: string
 *   slug: string
 *   accountType?: "regular" | "system" | "site" | "bot" | "free"
 *   karmaLevel?: "none" | "low" | "medium" | "high" | "very high" | "guru"
 *   createdAt: string
 *   avatar?: string
 * }} PublicUser
 *
 *
 * @typedef {{ label: string; redacted: true }} PrivateMessageControl
 *
 * @typedef {{
 *   status: 200
 *   view: "user_found"
 *   user: PublicUser
 *   privateMessageControl: PrivateMessageControl
 * }} UserInfoFound
 *
 *
 * @typedef {{ status: 200; view: "user_missing"; error: string }} UserInfoMissing
 */

/** @type {PrivateMessageControl} */
const PRIVATE_MESSAGE_CONTROL = Object.freeze({
  label: "Write private message",
  redacted: true
})

const KARMA_LABELS = Object.freeze(
  /** @type {const} */ (["none", "low", "medium", "high", "very high", "guru"])
)

/**
 * @param {UserViewUser} user
 * @param {LoadAvatar | undefined} loadAvatar
 * @returns {Promise<PublicUser>}
 */
const projectPublicUser = async (user, loadAvatar) => {
  if (user.name === null || user.slug === null) {
    throw new Error("Found user view response has no public identity")
  }

  const avatar =
    user.avatar_s3_hash !== null && loadAvatar
      ? await loadAvatar(user.avatar_s3_hash)
      : undefined

  const imported = user.user_type === "wikidot"
  const karmaLevel = imported ? KARMA_LABELS[user.karma] : undefined

  return {
    userId: user.user_id,
    name: user.name,
    slug: user.slug,
    ...(imported
      ? user.is_pro
        ? {}
        : { accountType: "free" }
      : { accountType: user.user_type }),
    ...(karmaLevel === undefined ? {} : { karmaLevel }),
    createdAt: user.created_at,
    ...(avatar === undefined ? {} : { avatar })
  }
}

/**
 * @param {{
 *   siteId: number
 *   locales: string[]
 *   target: string
 *   userView: UserView
 *   loadAvatar?: LoadAvatar
 * }} options
 * @returns {Promise<UserInfoFound | UserInfoMissing>}
 */
export const loadWikidotUserInfo = async ({
  siteId,
  locales,
  target,
  userView,
  loadAvatar
}) => {
  const response = await userView(siteId, locales, undefined, target)
  const responseType = response.type

  if (responseType === "user_missing") {
    return {
      status: 200,
      view: "user_missing",
      error: WIKIDOT_USER_INFO_MISSING
    }
  }

  if (responseType !== "user_found") {
    throw new Error(`Unexpected user view response '${responseType}'`)
  }

  return {
    status: 200,
    view: "user_found",
    user: await projectPublicUser(response.data.user, loadAvatar),
    privateMessageControl: PRIVATE_MESSAGE_CONTROL
  }
}
