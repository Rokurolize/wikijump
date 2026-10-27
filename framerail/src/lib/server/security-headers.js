import { createHash } from "node:crypto"

import { auditedExternalAssetOrigins } from "./audited-external-asset-origins.js"
import { WIKIDOT_STYLE_FRAME_SCRIPT } from "../wikidot/wikidot-styleframe.js"
import { parseDeploymentEnvironment } from "./deployment-environment.js"
import {
  LOCAL_MIRROR_FILE_ASSET_SITES,
  platformDomains,
  platformHttpsOrigin
} from "./platform-domains.js"

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
const CURRENT_SITE_FILE_ORIGIN = "https://wikijump-current-site.invalid"
const WIKIDOT_INTERWIKI_STYLE_SOURCES = auditedExternalAssetOrigins("styles").join(" ")
const WIKIDOT_INTERWIKI_FONT_SOURCES = auditedExternalAssetOrigins("fonts").join(" ")
const WIKIDOT_INTERWIKI_FRAME_POLICIES = new Map([
  [
    "/-/wikidot-interwiki/interwikiFrame.html",
    `default-src 'none'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline' ${CURRENT_SITE_FILE_ORIGIN} ${WIKIDOT_INTERWIKI_STYLE_SOURCES}; font-src 'self' data: ${CURRENT_SITE_FILE_ORIGIN} ${WIKIDOT_INTERWIKI_FONT_SOURCES}; img-src 'self' data: ${CURRENT_SITE_FILE_ORIGIN} https://*.wdfiles.com https://cdn.scpwiki.com https://d3g0gp89917ko0.cloudfront.net https://scp-jp.github.io; frame-ancestors 'self'`
  ]
])
const LOCAL_WIKIDOT_STYLEFRAME_PATHNAME = "/-/wikidot-interwiki/styleFrame.html"
// The style frame runs exactly one known script and nothing else.
const WIKIDOT_STYLEFRAME_SCRIPT_SOURCE = `'sha256-${createHash("sha256")
  .update(WIKIDOT_STYLE_FRAME_SCRIPT)
  .digest("base64")}'`
// WebKit evaluates the styleFrame document's style policy while its fixed
// script applies the sibling interwiki frame's inline CSS declarations.
// Keep that compatibility allowance local to inline styles in this otherwise
// isolated frame; default-src still blocks external styles and other assets.
const WIKIDOT_STYLEFRAME_POLICY = `default-src 'none'; script-src ${WIKIDOT_STYLEFRAME_SCRIPT_SOURCE}; style-src 'unsafe-inline'; frame-ancestors 'self'`

const shouldSetHsts = (deploymentEnvironment = parseDeploymentEnvironment()) => {
  return deploymentEnvironment !== "local"
}

const wikidotInterwikiFramePolicy = (
  pathname,
  deploymentEnvironment = parseDeploymentEnvironment()
) => {
  if (
    pathname === LOCAL_WIKIDOT_STYLEFRAME_PATHNAME &&
    deploymentEnvironment === "local"
  ) {
    return WIKIDOT_STYLEFRAME_POLICY
  }
  return WIKIDOT_INTERWIKI_FRAME_POLICIES.get(pathname)
}

/** @param {unknown} value */
const trustedSiteSlug = (value) => {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)
    ? value
    : null
}

const materializeExactCspSources = (policy, replacements) => {
  let replaced = false
  const directives = policy
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean)
    .map((directive) =>
      directive
        .split(/\s+/u)
        .map((token) => {
          const replacement = replacements.get(token)
          if (replacement === undefined) return token
          replaced = true
          return replacement
        })
        .join(" ")
    )
  return replaced ? directives.join("; ") : null
}

/**
 * @param {Response} response
 * @param {string | null | undefined} siteSlug
 */
export const materializeSiteCsp = (
  response,
  siteSlug,
  deploymentEnvironment = parseDeploymentEnvironment(),
  requestOrigin = undefined
) => {
  const policy = response.headers.get("content-security-policy")
  const slug = trustedSiteSlug(siteSlug)
  if (!policy || !slug) return
  let port = ""
  if (deploymentEnvironment === "local" && requestOrigin) {
    try {
      port = new URL(requestOrigin).port
    } catch {
      port = ""
    }
  }
  const domains = platformDomains({ deploymentEnvironment })
  const { files } = domains
  const portSuffix = port ? `:${port}` : ""
  // A local deployment served on a non-default port references each of
  // its file hosts in two forms. URLs framerail generates for a file
  // carry the request port, while literal references inside stored
  // stylesheets (compiled once, e.g. the url(...) images of a theme)
  // carry the canonical origin at the configured HTTPS port, because a
  // served stylesheet's contents cannot be rewritten per request.
  // Materialize both forms for every file host so neither is refused.
  // When the forms coincide there is only the one origin, exactly as
  // before; with no request port known, portSuffix is empty and the
  // single form is the portless one, also as before.
  const fileOriginForms = (host) => {
    const canonical = platformHttpsOrigin(host, domains)
    const served = `https://${host}${portSuffix}`
    return portSuffix && served !== canonical ? `${canonical} ${served}` : served
  }
  const replacements = new Map([
    [CURRENT_SITE_FILE_ORIGIN, fileOriginForms(`${slug}.${files}`)]
  ])
  // The local mirror file origins baked into the policy by
  // sveltekit-options.js carry the configured HTTPS port (default 443),
  // not the port this local deployment is actually served on, so on a
  // non-443 local deployment the request-port form must be added beside
  // the baked canonical form, exactly like the current-site origin
  // above. With no request port known there is nothing to add, and on
  // the default port the two forms coincide. A single replacement pass
  // rewrites every token once, so a mirror site that is also the
  // current site is not rewritten twice.
  if (deploymentEnvironment === "local" && port) {
    for (const mirrorSite of LOCAL_MIRROR_FILE_ASSET_SITES) {
      const baked = platformHttpsOrigin(`${mirrorSite}.${files}`, domains)
      const served = `https://${mirrorSite}.${files}${portSuffix}`
      if (baked !== served) replacements.set(baked, `${baked} ${served}`)
    }
  }
  const materialized = materializeExactCspSources(policy, replacements)
  if (materialized) response.headers.set("content-security-policy", materialized)
}

export const staticSecurityHeaderEntries = (
  deploymentEnvironment = parseDeploymentEnvironment()
) => {
  const headers = Object.entries(SECURITY_HEADERS)

  if (shouldSetHsts(deploymentEnvironment)) {
    headers.push(["strict-transport-security", HSTS_HEADER])
  }

  return headers
}

/**
 * @param {Response} response
 * @param {string} pathname
 * @param {string | undefined} siteSlug
 * @param {"local" | "dev" | "prod"} [deploymentEnvironment]
 * @param {string | undefined} [requestOrigin]
 */
export const applyStaticSecurityHeaders = (
  response,
  pathname,
  siteSlug = undefined,
  deploymentEnvironment = parseDeploymentEnvironment(),
  requestOrigin = undefined
) => {
  for (const [header, value] of staticSecurityHeaderEntries(deploymentEnvironment)) {
    response.headers.set(header, value)
  }

  const framePolicy = wikidotInterwikiFramePolicy(pathname, deploymentEnvironment)
  if (framePolicy) {
    response.headers.set("content-security-policy", framePolicy)
    response.headers.set("x-frame-options", "SAMEORIGIN")
  }
  materializeSiteCsp(response, siteSlug, deploymentEnvironment, requestOrigin)
}

/**
 * @param {{
 *   setHeader(name: string, value: string): void
 *   removeHeader(name: string): void
 * }} response
 * @param {string} pathname
 * @param {"local" | "dev" | "prod"} [deploymentEnvironment]
 */
export const applyStaticSecurityHeadersToNodeResponse = (
  response,
  pathname,
  deploymentEnvironment = parseDeploymentEnvironment()
) => {
  for (const [header, value] of staticSecurityHeaderEntries(deploymentEnvironment)) {
    response.setHeader(header, value)
  }

  const framePolicy = wikidotInterwikiFramePolicy(pathname, deploymentEnvironment)
  if (framePolicy) {
    response.setHeader("content-security-policy", framePolicy)
    response.setHeader("x-frame-options", "SAMEORIGIN")
  }
}
