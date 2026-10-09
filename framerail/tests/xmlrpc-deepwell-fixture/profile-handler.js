/**
 * Session token that `session_get` resolves to the avatar-owning fixture
 * user.
 */
const AVATAR_OWNER_SESSION_TOKEN = "fixture-authenticated-session-token"

/** Stored avatar hash (SHA-512, serialized as Deepwell's byte array). */
const AVATAR_HASH_HEX = "ab".repeat(64)
const AVATAR_HASH_BYTES = Array.from(Buffer.from(AVATAR_HASH_HEX, "hex"))

/** A 1x1 PNG served for the stored avatar hash through `blob_get`. */
const AVATAR_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
)

/** @param {{ rpcRequest: any }} input */
export const handleProfileRpc = ({ rpcRequest }) => {
  if (rpcRequest.method === "blob_get") {
    if (rpcRequest.params !== AVATAR_HASH_HEX) return undefined
    return {
      result: {
        data: Array.from(AVATAR_PNG),
        mime: "image/png",
        size: AVATAR_PNG.length,
        created_at: "2026-01-01T00:00:00Z"
      }
    }
  }

  if (rpcRequest.method !== "user_view") return undefined

  const params = rpcRequest.params ?? {}
  if (params.site_id !== 6000005 || !Array.isArray(params.locales)) {
    return undefined
  }

  // The own-account profile is only served to the avatar owner's session; any
  // other session token keeps failing closed.
  if (params.session_token === AVATAR_OWNER_SESSION_TOKEN && params.user === undefined) {
    return userFound({ ...PROFILE_FIXTURES["avatar-probe"], slug: "avatar-probe" })
  }
  if (params.session_token !== undefined) return undefined

  // Only exact roster slugs resolve; inherited Object.prototype keys such as
  // "constructor" must keep failing closed instead of serving a bogus profile.
  const profile = Object.hasOwn(PROFILE_FIXTURES, params.user)
    ? PROFILE_FIXTURES[params.user]
    : undefined
  if (!profile) return undefined

  return userFound({ ...profile, slug: params.user })
}

/**
 * @param {{
 *   user_id: number
 *   name: string
 *   website: string | null
 *   slug: string
 *   avatar?: boolean
 * }} profile
 */
const userFound = (profile) => ({
  result: {
    type: "user_found",
    data: {
      user: {
        user_id: profile.user_id,
        user_type: "regular",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: null,
        deleted_at: null,
        from_wikidot: false,
        name: profile.name,
        slug: profile.slug,
        name_changes_left: 0,
        last_name_change_added_at: "2026-01-01T00:00:00Z",
        last_renamed_at: null,
        email: "",
        email_verified_at: null,
        email_validation_info: null,
        email_validation_at: null,
        password: "",
        multi_factor_secret: null,
        multi_factor_recovery_codes: null,
        locales: ["en"],
        avatar_s3_hash: profile.avatar ? AVATAR_HASH_BYTES : null,
        forum_signature: null,
        real_name: null,
        gender: null,
        birthday: null,
        location: null,
        biography: null,
        website: profile.website,
        user_page: null
      }
    }
  }
})

/**
 * Public profile fixtures for the website-link contract. `guest` keeps the
 * historical blank-website profile; `website-frozen-probe` mirrors the
 * value frozen in issue #2150's live Wikidot evidence; `website-probe`
 * renders a generic schemeless domain; `website-unsafe-probe` renders an
 * unsafe scheme so the browser can observe both branches of
 * `normalizePublicWebsiteUrl`.
 *
 * @type {Record<
 *   string,
 *   { user_id: number; name: string; website: string | null }
 * >}
 */
const PROFILE_FIXTURES = {
  guest: { user_id: 987654, name: "Guest", website: null },
  "website-frozen-probe": {
    user_id: 987657,
    name: "Website Frozen Probe",
    website: "scp-wiki.wikidot.com/seekgull"
  },
  "website-probe": { user_id: 987655, name: "Website Probe", website: "example.org" },
  "website-unsafe-probe": {
    user_id: 987656,
    name: "Website Unsafe Probe",
    website: ["javascript", "alert(1)"].join(":")
  },
  // Owned by the authenticated fixture session (user 6000008) and stored with an
  // avatar, so the own and public profiles both render the avatar image.
  "avatar-probe": {
    user_id: 6000008,
    name: "Avatar Probe",
    website: null,
    avatar: true
  }
}
