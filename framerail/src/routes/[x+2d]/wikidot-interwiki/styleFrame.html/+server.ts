import type { RequestHandler } from "./$types"

const FRAME_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store"
}

function isLocalEnvironment() {
  return process.env.FRAMERAIL_ENV === "local" || process.env.NODE_ENV === "development"
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function escapeStyleText(value: string) {
  return value.replaceAll(/<\/style/gi, "<\\/style")
}

export const GET: RequestHandler = ({ url }) => {
  if (!isLocalEnvironment()) {
    return new Response("Not found", { status: 404 })
  }

  const css = url.searchParams.get("css") ?? ""
  const theme = url.searchParams.get("theme") ?? ""
  const priority = url.searchParams.get("priority") ?? ""
  const body = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Local Wikidot style frame</title>
    <meta name="wikidot-style-priority" content="${escapeHtml(priority)}">
    <meta name="wikidot-style-theme" content="${escapeHtml(theme)}">
    <style>${escapeStyleText(css)}</style>
  </head>
  <body></body>
</html>
`

  return new Response(body, { headers: FRAME_HEADERS })
}

export const HEAD: RequestHandler = () =>
  new Response(null, {
    status: isLocalEnvironment() ? 200 : 404,
    headers: isLocalEnvironment() ? FRAME_HEADERS : {}
  })
