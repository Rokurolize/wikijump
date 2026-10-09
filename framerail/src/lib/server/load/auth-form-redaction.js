/**
 * @template {{ data: { password?: string } }} T
 * @param {T} form
 * @returns {T}
 */
export const clearLoginPassword = (form) => {
  form.data.password = ""
  return form
}

/**
 * @template {{ data: { password?: string; confirmPassword?: string } }} T
 * @param {T} form
 * @returns {T}
 */
export const clearRegisterPasswords = (form) => {
  form.data.password = ""
  form.data.confirmPassword = ""
  return form
}

/**
 * Remove submitted credentials from an action payload immediately before
 * it is returned to SvelteKit for serialization. Unrelated tokens,
 * including the MFA continuation token, are preserved.
 *
 * @template T
 * @param {T} payload
 * @param {string[]} secrets
 * @returns {T}
 */
export const redactAuthActionPayload = (payload, secrets) => {
  const submitted = secrets.filter((secret) => secret.length > 0)
  const visited = new WeakSet()

  /** @param {unknown} value */
  const redact = (value) => {
    if (typeof value === "string") {
      return submitted.reduce(
        (redacted, secret) => redacted.replaceAll(secret, ""),
        value
      )
    }
    if (value === null || typeof value !== "object" || visited.has(value)) {
      return value
    }

    visited.add(value)
    for (const [key, nested] of Object.entries(value)) {
      value[key] =
        key === "errors"
          ? redactValidationErrors(nested)
          : key === "password" || key === "confirmPassword"
            ? ""
            : key === "session_token"
              ? nested
              : redact(nested)
    }
    return value
  }

  // Field-error entries are keyed by the same names as the credential fields
  // (`errors.password`), so blanking by key would erase the message the page
  // uses to decide that a field is invalid. Keep every entry non-empty and
  // replace only the submitted secret text inside it.
  /** @param {unknown} value */
  const redactValidationErrors = (value) => {
    if (typeof value === "string") {
      return submitted.reduce(
        (redacted, secret) => redacted.replaceAll(secret, "[redacted]"),
        value
      )
    }
    if (value === null || typeof value !== "object" || visited.has(value)) {
      return value
    }

    visited.add(value)
    for (const [key, nested] of Object.entries(value)) {
      value[key] = redactValidationErrors(nested)
    }
    return value
  }

  return /** @type {T} */ (redact(payload))
}
