/**
 * Refs #2074. Live Wikidot signup carries an off-screen honeypot field
 * labelled "Please leave this checkbox blank" (spec `module-createaccount`
 * P6 records "an anti-bot blank checkbox"). A normal browser never touches
 * it; an automated filler checks or fills every field. This module owns
 * the field identity and the trip decision so the register template and
 * the server-side action gate cannot disagree.
 *
 * Pure module: no framework imports, directly runnable under `node
 * --test`.
 */

// The form field carrying the honeypot. The name itself is internal; only
// the label text mirrors the observed Wikidot control.
export const REGISTER_HONEYPOT_FIELD = "leaveBlank"

// The evidenced Wikidot honeypot label, verbatim.
export const REGISTER_HONEYPOT_LABEL = "Please leave this checkbox blank"

// Submitted values that still count as "left blank": an unchecked checkbox
// submits nothing at all, and explicit negative spellings must not lock out
// humans behind unusual clients.
const UNTRIPPED_VALUES = new Set(["", "false", "off", "0"])

/**
 * @param {unknown} value The submitted honeypot field value
 * @returns {boolean} True when the honeypot was filled or checked
 */
export const isRegistrationHoneypotTripped = (value) => {
  if (value === undefined || value === null) return false
  if (Array.isArray(value)) return value.some(isRegistrationHoneypotTripped)
  return !UNTRIPPED_VALUES.has(String(value).trim().toLowerCase())
}
