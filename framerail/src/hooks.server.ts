// Hook that runs on every request, including form actions.

import { storeRequestContext } from "$lib/server/load/request-ctx"
import { loadSiteInfo } from "$lib/server/load/site-info"
import type { Handle } from "@sveltejs/kit"

function isLocalEnvironment() {
  return process.env.FRAMERAIL_ENV === "local" || process.env.NODE_ENV === "development"
}

const SECURITY_HEADERS = {
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": [
    "accelerometer=()",
    "autoplay=()",
    "camera=()",
    "display-capture=()",
    "encrypted-media=()",
    "fullscreen=(self)",
    "geolocation=()",
    "gyroscope=()",
    "magnetometer=()",
    "microphone=()",
    "midi=()",
    "payment=()",
    "publickey-credentials-get=(self)",
    "screen-wake-lock=()",
    "usb=()",
    "web-share=(self)",
    "xr-spatial-tracking=()"
  ].join(", "),
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
}

const HSTS_HEADER = "max-age=31536000; includeSubDomains"

function shouldSetHsts() {
  return !isLocalEnvironment()
}

export const handle: Handle = async ({ event, resolve }) => {
  const { request, cookies, locals, params } = event

  // Gather common request metadata into a shared context.
  const { siteId } = loadSiteInfo(request.headers)
  const page_slug = params.slug
  const sessionToken = cookies.get("wikijump_token")

  storeRequestContext(locals, sessionToken, siteId, page_slug)

  // Continue processing the request
  const response = await resolve(event)

  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(header, value)
  }

  if (shouldSetHsts()) {
    response.headers.set("strict-transport-security", HSTS_HEADER)
  }

  return response
}
