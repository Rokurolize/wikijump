/** @param {{ rpcRequest: any }} input */
export const handleProfileRpc = ({ rpcRequest }) => {
  if (rpcRequest.method !== "user_view") return undefined

  const params = rpcRequest.params ?? {}
  if (
    params.site_id !== 6000005 ||
    params.user !== "guest" ||
    !Array.isArray(params.locales) ||
    params.session_token !== undefined
  ) {
    return undefined
  }

  return {
    result: {
      type: "user_found",
      data: {
        user: {
          user_id: 987654,
          user_type: "regular",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: null,
          deleted_at: null,
          from_wikidot: false,
          name: "Guest",
          slug: "guest",
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
          avatar_s3_hash: null,
          forum_signature: null,
          real_name: null,
          gender: null,
          birthday: null,
          location: null,
          biography: null,
          website: null,
          user_page: null
        }
      }
    }
  }
}
