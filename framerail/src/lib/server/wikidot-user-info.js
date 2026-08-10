export const WIKIDOT_USER_INFO_MISSING = "User does not exist."

/**
 * @typedef {{
 *   user_id: number
 *   user_type: "regular" | "system" | "site" | "bot"
 *   created_at: string
 *   name: string
 *   slug: string
 *   avatar_s3_hash: number[] | null
 * }} UserViewUser
 *
 *
 * @typedef {{ type: "user_found"; data: { user: UserViewUser } }
 *   | { type: "user_missing"; data: undefined }} UserViewResult
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
 *   accountType: UserViewUser["user_type"]
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

/**
 * @param {UserViewUser} user
 * @param {LoadAvatar | undefined} loadAvatar
 * @returns {Promise<PublicUser>}
 */
async function projectPublicUser(user, loadAvatar) {
  const avatar =
    user.avatar_s3_hash !== null && loadAvatar
      ? await loadAvatar(user.avatar_s3_hash)
      : undefined

  return {
    userId: user.user_id,
    name: user.name,
    slug: user.slug,
    accountType: user.user_type,
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
export async function loadWikidotUserInfo({
  siteId,
  locales,
  target,
  userView,
  loadAvatar
}) {
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
