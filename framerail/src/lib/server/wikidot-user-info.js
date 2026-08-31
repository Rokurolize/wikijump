export const WIKIDOT_USER_INFO_MISSING = "User does not exist."

/**
 * @typedef {import("./deepwell/user").UserViewResult} UserViewResult
 *
 * @typedef {import("./deepwell/user").UserViewUser} UserViewUser
 *
 * @typedef {import("$lib/types").UserType} UserType
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
 *   accountType?: UserType | "free"
 *   karmaLevel?: "none" | "high"
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
const projectPublicUser = async (user, loadAvatar) => {
  if (user.name === null || user.slug === null) {
    throw new Error("Found user view response has no public identity")
  }

  const avatar =
    user.avatar_s3_hash !== null && loadAvatar
      ? await loadAvatar(user.avatar_s3_hash)
      : undefined

  const imported = user.user_type === "wikidot"
  const karmaLevel = imported
    ? user.karma === 0
      ? "none"
      : user.karma === 3
        ? "high"
        : undefined
    : undefined

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
