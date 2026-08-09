import { limitLocalePreferences } from "./locales.js"

/**
 * Parses the display-language preference field into the ordered locale
 * list persisted by Deepwell. Deepwell remains the syntax-validation
 * authority.
 *
 * @param {string} input
 * @returns {string[]}
 */
export function parseUserLocalePreferences(input) {
  return limitLocalePreferences(
    input.replaceAll("_", "-").replaceAll(",", " ").split(/\s+/u)
  )
}
