export const WIKIDOT_USER_INFO_MISSING = "User does not exist."

const PRIVATE_MESSAGE_CONTROL = Object.freeze({
  label: "Write private message",
  redacted: true
})

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

export async function loadWikidotUserInfo({
  siteId,
  locales,
  target,
  userView,
  loadAvatar
}) {
  const response = await userView(siteId, locales, undefined, target)

  if (response.type === "user_missing") {
    return {
      status: 200,
      view: "user_missing",
      error: WIKIDOT_USER_INFO_MISSING
    }
  }

  if (response.type !== "user_found") {
    throw new Error(`Unexpected user view response '${response.type}'`)
  }

  return {
    status: 200,
    view: "user_found",
    user: await projectPublicUser(response.data.user, loadAvatar),
    privateMessageControl: PRIVATE_MESSAGE_CONTROL
  }
}
