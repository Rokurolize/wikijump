/**
 * Wikidot attachment-list contract helpers, frozen from the live
 * `files/PageFilesModule` output. Refs #2067.
 */

/** Short content-type labels observed on the frozen fixture page. */
const FILE_TYPE_DESCRIPTIONS = new Map([
  ["image/png", "PNG image data"],
  ["image/jpeg", "JPEG image data"],
  ["image/gif", "GIF image data"]
])

/**
 * Short human-readable content type. Only the fixture-observed image types
 * map to Wikidot labels; anything else reports its MIME type, which is the
 * precise datum available. The per-file long `file(1)` descriptions (pixel
 * dimensions and encoding details) need server-side introspection data the
 * file record does not carry, so the MIME type doubles as the hover text.
 */
export const wikidotFileTypeDescription = (mime) =>
  FILE_TYPE_DESCRIPTIONS.get(mime ?? "") ?? (mime || "")

const FILE_SIZE_UNITS = ["Bytes", "kB", "MB", "GB"]

/**
 * Binary human-readable size with two decimals, matching the frozen list
 * ("199.34 kB") and totals ("6.74 MB"). Sub-kilobyte lists were
 * unobserved; they report raw bytes like the modal's parenthetical.
 */
export const wikidotFileSize = (bytes) => {
  const size = Math.max(Number(bytes) || 0, 0)
  if (size < 1024) return `${size} Bytes`
  let value = size
  let unit = 0
  while (value >= 1024 && unit < FILE_SIZE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(2)} ${FILE_SIZE_UNITS[unit]}`
}

/**
 * Wikidot lists attachments case-insensitively by file name (frozen order
 * on the 19-file fixture page), not by file id.
 */
export const sortFilesWikidot = (files) =>
  [...(files ?? [])].sort((a, b) => {
    const left = (a?.name ?? "").toLowerCase()
    const right = (b?.name ?? "").toLowerCase()
    if (left === right) return 0
    return left < right ? -1 : 1
  })

/**
 * Whether a page's file inventory is read-only for ordinary authoring.
 * Fully imported mirror pages (page and site both flagged from_wikidot)
 * show the source inventory only; their files change solely through the
 * Wikidot import (issue #2603). Matches the both-flags predicate in
 * Deepwell's file visibility filter and file mutation guard.
 */
export const isMirrorFileInventoryReadOnly = (page, site) =>
  Boolean(page?.from_wikidot && site?.from_wikidot)

/** Totals line inputs: file count and summed size. */
export const wikidotFileTotals = (files) => ({
  count: (files ?? []).length,
  bytes: (files ?? []).reduce((sum, file) => sum + (Number(file?.size) || 0), 0)
})

const FILE_UPLOAD_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
]

/**
 * File Information modal upload date. The frozen modal reads "21 Apr 2026,
 * 06:01": day, abbreviated month, year, a comma, then zero-padded UTC hour
 * and minute. Wikidot's own `odate` format string on the same element (`%e
 * %b %Y, %H:%M`) carries that comma too, so the comma is source shape, not
 * styling.
 */
export const wikidotFileUploadDate = (createdAt) => {
  const date = new Date(createdAt)
  const timestamp = Math.floor(date.getTime() / 1000)
  const day = String(date.getUTCDate()).padStart(2, "0")
  const hour = String(date.getUTCHours()).padStart(2, "0")
  const minute = String(date.getUTCMinutes()).padStart(2, "0")
  return {
    timestamp,
    text: `${day} ${FILE_UPLOAD_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hour}:${minute}`,
    className: `odate time_${timestamp} format_%25e%20%25b%20%25Y%2C%20%25H%3A%25M%7Cagohover`
  }
}

/**
 * Wikidot attachment permission denials. Every denial is a PERMISSION
 * ERROR popup with the "Please note:" lead-in, the operation's recorded
 * refusal sentence, the shared site-role note, and (for signed-out actors)
 * the sign-in action. Builders return fresh objects so callers can hand
 * them to the popup store without sharing state.
 */
const WIKIDOT_ATTACH_ROLE_NOTE =
  "Only owner (creator) of this page, site administrators and perhaps selected moderators are allowed to do it."

const wikidotSignInAction = () => ({
  href: "#action:login",
  label: "Sign in as Wikidot user"
})

/** Anonymous upload denial (source `#show-upload-button` state). */
export const wikidotUploadDeniedPopup = () => ({
  state: true,
  title: "PERMISSION ERROR",
  leadIn: "Please note:",
  message: "Sorry, you can not attach a new file to this page.",
  extraMessage: WIKIDOT_ATTACH_ROLE_NOTE,
  actionLink: wikidotSignInAction(),
  data: null
})

/** Anonymous rename denial (source scp-9506, issue #2324). */
export const wikidotRenameDeniedPopup = () => ({
  state: true,
  title: "PERMISSION ERROR",
  leadIn: "Please note:",
  message: "Sorry, you can not rename file attachment in this page.",
  extraMessage: WIKIDOT_ATTACH_ROLE_NOTE,
  actionLink: wikidotSignInAction(),
  data: null
})
