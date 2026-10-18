import { Buffer } from "node:buffer"

import { wikidotFeedIconPng } from "$lib/server/wikidot-feed-icon"

import type { RequestHandler } from "./$types"

// Only this one repository-owned path is served under /common--theme; every other
// path falls through to the app's 404 and is never proxied to Wikidot.
export const GET: RequestHandler = () =>
  new Response(Buffer.from(wikidotFeedIconPng()), {
    headers: {
      "cache-control": "public, max-age=86400",
      "content-type": "image/png"
    }
  })
