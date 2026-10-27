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

const materializeExactCspSource = (policy, source, replacement) => {
  let replaced = false
  const directives = policy
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean)
    .map((directive) =>
      directive
        .split(/\s+/u)
        .map((token) => {
          if (token !== source) return token
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
  let current = materializeExactCspSource(
    policy,
    CURRENT_SITE_FILE_ORIGIN,
    `https://${slug}.${files}${portSuffix}`
  )
  let materialized = current !== null
  current = current ?? policy
  // The local mirror file origins baked into the policy by
  // sveltekit-options.js carry the configured HTTPS port (default 443),
  // not the port this local deployment is actually served on, so on a
  // non-443 local deployment the policy refuses every stylesheet, font and
  // image a page includes from a mirror site (e.g. a component included
  // from scp-wiki). Materialize them with the request port exactly like
  // the current-site origin above. With no request port known there is
  // nothing better to substitute, and on the default port the baked
  // origins are already correct.
  if (deploymentEnvironment === "local" && port) {
    for (const mirrorSite of LOCAL_MIRROR_FILE_ASSET_SITES) {
      const baked = platformHttpsOrigin(`${mirrorSite}.${files}`, domains)
      const served = `https://${mirrorSite}.${files}${portSuffix}`
      if (baked === served) continue
      const next = materializeExactCspSource(current, baked, served)
      if (next) {
        current = next
        materialized = true
      }
    }
  }
  if (materialized) response.headers.set("content-security-policy", current)
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
