import { isJapaneseWikidotLocale } from "./wikidot-locale.ts"

const WIKIDOT_SOURCE_TIME_ZONE = "Asia/Tokyo"
const WIKIDOT_MONTHS = Object.freeze([
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
])

const wikidotDatePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: WIKIDOT_SOURCE_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
})

const datePart = (parts: Intl.DateTimeFormatPart[], type: string) => {
  return parts.find((part) => part.type === type)?.value ?? ""
}

export const formatWikidotSourceDate = (timestampMs: number) => {
  const parts = wikidotDatePartsFormatter.formatToParts(new Date(timestampMs))
  const day = Number(datePart(parts, "day"))
  const month = Number(datePart(parts, "month"))
  const year = datePart(parts, "year")
  const hour = datePart(parts, "hour").replace(/^24$/, "00").padStart(2, "0")
  const minute = datePart(parts, "minute").padStart(2, "0")

  return `${day} ${WIKIDOT_MONTHS[month - 1]} ${year}, ${hour}:${minute}`
}

export const formatWikidotRelativeAge = (
  elapsedMs: number,
  locale: string | null | undefined = "en"
) => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const suffix = isJapaneseWikidotLocale(locale) ? " 前" : " ago"

  if (totalSeconds < 60) {
    return isJapaneseWikidotLocale(locale)
      ? "less than a minute 前"
      : "less than a minute ago"
  }

  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}${suffix}`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}${suffix}`

  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"}${suffix}`
}

export const WIKIDOT_PAGE_INFO_DATE_FORMAT = "%e %b %Y, %H:%M (%O ago)"

const WIKIDOT_DATE_FORMAT_UNRESERVED = /^[A-Za-z0-9._~-]$/

export const encodeWikidotDateFormat = (format: string) => {
  let encoded = ""

  for (const byte of new TextEncoder().encode(format)) {
    const character = String.fromCharCode(byte)
    encoded += WIKIDOT_DATE_FORMAT_UNRESERVED.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`
  }

  return encoded
}

export interface WikidotPageInfoDate {
  prefix: string
  text: string
  epochSeconds: number
  className: string
}

export interface WikidotPageInfoParts {
  text: string
  date: WikidotPageInfoDate
}

export const buildWikidotPageInfoParts = ({
  revision,
  updatedAt,
  now = Date.now(),
  locale = "en"
}: {
  revision: number
  updatedAt: string
  now?: number
  locale?: string | null
}): WikidotPageInfoParts | null => {
  const updatedAtMs = Date.parse(updatedAt)

  if (!Number.isFinite(updatedAtMs)) return null

  const date = formatWikidotSourceDate(updatedAtMs)
  const relative = formatWikidotRelativeAge(now - updatedAtMs, locale)
  const dateText = `${date} (${relative})`
  const prefix = isJapaneseWikidotLocale(locale)
    ? `ページリビジョン: ${revision}, 最終更新: `
    : `page revision: ${revision}, last edited: `
  const epochSeconds = Math.floor(updatedAtMs / 1000)

  return {
    text: `${prefix}${dateText}`,
    date: {
      prefix,
      text: dateText,
      epochSeconds,
      className: `odate time_${epochSeconds} format_${encodeWikidotDateFormat(WIKIDOT_PAGE_INFO_DATE_FORMAT)}`
    }
  }
}

export const buildWikidotPageInfoText = ({
  revision,
  updatedAt,
  now = Date.now(),
  locale = "en"
}: {
  revision: number
  updatedAt: string
  now?: number
  locale?: string | null
}) => {
  const parts = buildWikidotPageInfoParts({ revision, updatedAt, now, locale })

  return parts ? parts.text : null
}
