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

export const GET: RequestHandler = ({ url }) => {
  if (!isLocalEnvironment()) {
    return new Response("Not found", { status: 404 })
  }

  const lang = url.searchParams.get("lang") ?? ""
  const community = url.searchParams.get("community") ?? ""
  const pagename = url.searchParams.get("pagename") ?? ""
  const body = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Local Wikidot interwiki frame</title>
  </head>
  <body data-lang="${escapeHtml(lang)}" data-community="${escapeHtml(community)}" data-pagename="${escapeHtml(pagename)}"></body>
</html>
`

  return new Response(body, { headers: FRAME_HEADERS })
}

export const HEAD: RequestHandler = () =>
  new Response(null, {
    status: isLocalEnvironment() ? 200 : 404,
    headers: isLocalEnvironment() ? FRAME_HEADERS : {}
  })
