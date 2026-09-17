import { loadPage } from "$lib/server/load/page/page"

/**
 * Live Wikidot's printer-friendly child window is a standalone document,
 * so this route resolves the same page view data as the article route and
 * renders it without the site chrome.
 */
export async function load({ params, request, cookies, locals }) {
  const segments = params.path.split("/")
  const slug = segments.shift()
  const extra = segments.join("/")
  return loadPage(slug, extra, request, cookies, locals)
}
