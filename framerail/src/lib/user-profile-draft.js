/**
 * Profile-editor state rules. The accepted snapshot is the last account
 * state the server confirmed. It is the baseline for partial patches and
 * the value the profile view shows. Rejected drafts never become part of
 * it.
 *
 * @typedef {{
 *   name: string
 *   realName: string
 *   email: string
 *   gender: string
 *   birthday: string
 *   location: string
 *   website: string
 *   userPage: string
 *   biography: string
 *   locales: string
 * }} ProfileFields
 */

/**
 * @param {{
 *       name?: string | null
 *       real_name?: string | null
 *       email?: string | null
 *       gender?: string | null
 *       birthday?: string | null
 *       location?: string | null
 *       website?: string | null
 *       user_page?: string | null
 *       biography?: string | null
 *       locales?: string[] | null
 *     }
 *   | null
 *   | undefined} user
 * @returns {ProfileFields}
 */
export function acceptedSnapshot(user) {
  return {
    name: user?.name ?? "",
    realName: user?.real_name ?? "",
    email: user?.email ?? "",
    gender: user?.gender ?? "",
    birthday: user?.birthday ?? "",
    location: user?.location ?? "",
    website: user?.website ?? "",
    userPage: user?.user_page ?? "",
    biography: user?.biography ?? "",
    locales: user?.locales?.join(" ") ?? ""
  }
}

/**
 * Build the partial patch: only fields that differ from the accepted
 * snapshot.
 *
 * @param {Partial<ProfileFields>} draft
 * @param {Partial<ProfileFields>} accepted
 * @param {unknown} avatar
 */
export function partialPatch(draft, accepted, avatar) {
  /** @type {Record<string, unknown>} */
  const patch = { avatar }
  for (const key of /** @type {(keyof ProfileFields)[]} */ (Object.keys(draft))) {
    if (draft[key] !== accepted[key]) patch[key] = draft[key]
  }
  return patch
}
