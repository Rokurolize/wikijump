export type WikidotForumFeedKind = "threads" | "posts"

export interface WikidotForumFeedItem {
  forum_post_id: number
  forum_thread_id: number
  created_at: string
  title: string
  thread_title: string
  thread_slug: string
  page_slug: string | null
  forum_group_id: number
  forum_group_name: string
  forum_category_id: number
  forum_category_name: string
  forum_category_slug: string
  author_user_id: number
  author_name: string
  content_html: string
}

export interface WikidotForumFeedOutput {
  site_name: string
  site_description: string
  items: WikidotForumFeedItem[]
}

const XML_HEADERS = {
  "cache-control": "no-cache, must-revalidate",
  "content-type": "text/xml;charset=utf-8",
  expires: "Mon, 26 Jul 1997 05:00:00 GMT"
} as const

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function cdata(value: string): string {
  return value.replaceAll("]]>", "]]]]><![CDATA[>")
}

export function formatWikidotForumFeedDate(value: Date): string {
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const day = value.getUTCDate().toString().padStart(2, "0")
  const hours = value.getUTCHours().toString().padStart(2, "0")
  const minutes = value.getUTCMinutes().toString().padStart(2, "0")
  const seconds = value.getUTCSeconds().toString().padStart(2, "0")
  return `${weekdays[value.getUTCDay()]}, ${day} ${months[value.getUTCMonth()]} ${value.getUTCFullYear()} ${hours}:${minutes}:${seconds} +0000`
}

function itemXml(origin: string, kind: WikidotForumFeedKind, item: WikidotForumFeedItem): string {
  const threadPath = item.page_slug
    ? `/${item.page_slug}/comments/show`
    : `/forum/t-${item.forum_thread_id}/${item.thread_slug}`
  const postPath = `${threadPath}#post-${item.forum_post_id}`
  const isThread = kind === "threads"
  const canonicalPath = `/forum/t-${item.forum_thread_id}`
  const guidOrigin = new URL(origin)
  guidOrigin.protocol = "http:"
  const guid = isThread ? canonicalPath : `${canonicalPath}#post-${item.forum_post_id}`
  const link = isThread
    ? `${canonicalPath}/${item.thread_slug}`
    : postPath
  const title = isThread ? item.thread_title : ""
  const content = isThread
    ? item.content_html
    : `${item.content_html}\n<br/>Forum category: <a href="${origin}/forum/c-${item.forum_category_id}">${escapeXml(item.forum_group_name)} / ${escapeXml(item.forum_category_name)}</a><br/>Forum thread: <a href="${origin}${canonicalPath}/${item.thread_slug}">${escapeXml(item.thread_title)}</a>`

  return [
    "\t\t<item>",
    `\t\t\t<guid>${escapeXml(`${guidOrigin.origin}${guid}`)}</guid>`,
    title ? `\t\t\t<title>${escapeXml(title)}</title>` : "\t\t\t<title/>",
    `\t\t\t<link>${escapeXml(`${origin}${link}`)}</link>`,
    "\t\t\t<description/>",
    `\t\t\t<pubDate>${formatWikidotForumFeedDate(new Date(item.created_at))}</pubDate>`,
    `\t\t\t<wikidot:authorName>${escapeXml(item.author_name)}</wikidot:authorName>`,
    `\t\t\t<wikidot:authorUserId>${item.author_user_id}</wikidot:authorUserId>`,
    "\t\t\t<content:encoded>",
    "\t\t\t\t<![CDATA[",
    `\t\t\t\t${cdata(content)}`,
    "\t\t\t\t]]>",
    "\t\t\t</content:encoded>",
    "\t\t</item>"
  ].join("\n")
}

export function buildWikidotForumFeedXml(
  requestUrl: string,
  kind: WikidotForumFeedKind,
  output: WikidotForumFeedOutput,
  now = new Date()
): string {
  const origin = new URL(requestUrl).origin
  const feedName = kind === "threads" ? "threads" : "posts"
  const items = output.items.map((item) => itemXml(origin, kind, item)).join("\n")
  return [
    '<?xml version="1.0" encoding="UTF-8" ?>',
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wikidot="http://www.wikidot.com/rss-namespace">',
    "",
    "\t<channel>",
    `\t\t<title>${escapeXml(output.site_name)} - new forum ${feedName}</title>`,
    `\t\t<link>${escapeXml(`${origin}/forum/start`)}</link>`,
    `\t\t<description>${escapeXml(`${kind === "threads" ? "Threads" : "Posts"} in forums of the site \"${output.site_name}\" - ${output.site_description}`)}</description>`,
    "\t\t<copyright/>",
    `\t\t<lastBuildDate>${formatWikidotForumFeedDate(now)}</lastBuildDate>`,
    ...(items ? [items] : []),
    "\t</channel>",
    "</rss>"
  ].join("\n")
}

export function wikidotForumFeedHeaders(): Headers {
  return new Headers(XML_HEADERS)
}
