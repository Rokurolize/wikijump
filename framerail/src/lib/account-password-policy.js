export const ACCOUNT_PASSWORD_MIN_CODE_POINTS = 15
export const ACCOUNT_PASSWORD_TOO_SHORT = "account-password-too-short"

/** @param {string} password */
export const accountPasswordMeetsMinimum = (password) =>
  Array.from(password).length >= ACCOUNT_PASSWORD_MIN_CODE_POINTS
