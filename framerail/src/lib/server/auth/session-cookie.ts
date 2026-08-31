import { parseDeploymentEnvironment } from "$lib/server/deployment-environment.js"

import type { Cookies } from "@sveltejs/kit"

const SESSION_COOKIE = "wikijump_token"
const SESSION_DOMAINS = {
  local: "wikijump.localhost",
  dev: "wikijump.dev",
  prod: "wikijump.com"
} as const

const baseSessionCookieOptions = () => ({
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const
})

export function sessionCookieDomain(
  requestUrl: string,
  deploymentEnvironment = parseDeploymentEnvironment()
): string | undefined {
  let hostname: string
  try {
    hostname = new URL(requestUrl).hostname.toLowerCase()
  } catch {
    return undefined
  }

  const domain = SESSION_DOMAINS[deploymentEnvironment]
  return hostname === domain || hostname.endsWith(`.${domain}`) ? domain : undefined
}

export function sessionCookieOptions(requestUrl: string) {
  const domain = sessionCookieDomain(requestUrl)
  return {
    ...baseSessionCookieOptions(),
    ...(domain ? { domain } : {})
  }
}

export function setSessionCookie(
  cookies: Cookies,
  sessionToken: string,
  expiresAt: string,
  requestUrl: string
) {
  cookies.set(SESSION_COOKIE, sessionToken, {
    ...sessionCookieOptions(requestUrl),
    expires: new Date(expiresAt)
  })
}

export function deleteSessionCookie(cookies: Cookies, requestUrl: string) {
  const sharedDomain = sessionCookieDomain(requestUrl)
  if (sharedDomain) {
    cookies.delete(SESSION_COOKIE, {
      ...baseSessionCookieOptions(),
      domain: sharedDomain
    })
  }

  // Also remove a pre-platform-cookie host-only session. This keeps logout
  // and stale-session recovery correct while existing local browsers migrate
  // to the shared native Wikijump cookie.
  cookies.delete(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax"
  })
}
