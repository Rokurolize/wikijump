const EN_HEADERS = ["rev.", "", "flags", "actions", "by", "date", "comments"]
const JA_HEADERS = ["rev.", "", "フラグ", "アクション", "by", "日付", "コメント"]

const FLAG_TITLES = {
  en: {
    create: "New page",
    move: "Page renamed",
    source: "content source text changed",
    tags: "tags changed",
    files: "file/attachment operations"
  },
  ja: {
    create: "新しいページ",
    move: "ページ名が変更されました",
    source: "コンテンツソースが変更されました",
    tags: "タグが変更されました",
    files: "ファイル/添付操作"
  }
}

const ACTION_TITLES = {
  en: {
    view: "View page revision",
    source: "View source of the revision",
    rollback: "Revert to revision"
  },
  ja: {
    view: "リビジョンを閲覧",
    source: "リビジョンのソースを閲覧",
    rollback: "リビジョンの差し戻し"
  }
}

const localeKey = (locale) =>
  String(locale ?? "")
    .toLowerCase()
    .startsWith("ja")
    ? "ja"
    : "en"

export const wikidotHistoryHeaders = (locale) =>
  localeKey(locale) === "ja" ? JA_HEADERS : EN_HEADERS

export const wikidotHistoryActionTitles = (locale) => ACTION_TITLES[localeKey(locale)]

/**
 * Return only revision markers evidenced by the live Wikidot History
 * module. Unknown change fields stay literal/blank instead of being
 * guessed as a generic metadata marker.
 */
export const wikidotRevisionFlags = (revision, locale) => {
  const titles = FLAG_TITLES[localeKey(locale)]
  if (revision.history_kind === "file") return [{ code: "F", title: titles.files }]
  if (revision.revision_type === "create") return [{ code: "N", title: titles.create }]
  if (revision.revision_type === "move") return [{ code: "R", title: titles.move }]

  const changes = new Set(revision.changes ?? [])
  return [
    ...(changes.has("wikitext") ? [{ code: "S", title: titles.source }] : []),
    ...(changes.has("tags") ? [{ code: "A", title: titles.tags }] : []),
    ...(changes.has("files") ? [{ code: "F", title: titles.files }] : [])
  ]
}

export const wikidotRevisionDate = (createdAt) => {
  const date = new Date(createdAt)
  if (!Number.isFinite(date.getTime())) return null
  const months = [
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
  const timestamp = Math.floor(date.getTime() / 1000)
  const day = String(date.getUTCDate()).padStart(2, "0")
  const hour = String(date.getUTCHours()).padStart(2, "0")
  const minute = String(date.getUTCMinutes()).padStart(2, "0")
  return {
    timestamp,
    text: `${day} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${hour}:${minute}`,
    className: `odate time_${timestamp} format_%25e%20%25b%20%25Y%7Cagohover`
  }
}
