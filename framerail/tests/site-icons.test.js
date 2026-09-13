import assert from "node:assert/strict"
import test from "node:test"

import {
  FAVICON_ROUTE_PREFIX,
  IOS_ICON_DECLARATIONS,
  IOS_ICON_ROUTE_PREFIX,
  SITE_ICON_CACHE_CONTROL,
  WINDOWS_TILE_FILENAME,
  WINDOWS_TILE_ROUTE_PREFIX,
  faviconDeclaration,
  hasIosIcons,
  windowsTileDeclaration
} from "../src/lib/site-icons.ts"

const importedSite = (icons = {}) => ({
  slug: "scp-wiki",
  from_wikidot: true,
  favicon_source: null,
  ios_icon_source: null,
  windows_tile_source: null,
  ...icons
})

const localSite = (icons = {}) => ({
  slug: "local-wiki",
  from_wikidot: false,
  favicon_source: null,
  ios_icon_source: null,
  windows_tile_source: null,
  ...icons
})

test("favicon declaration keeps Wikidot's local route rather than the configured source", () => {
  // Live scp-wiki declares /local--favicon/favicon.gif with type image/gif.
  assert.deepEqual(
    faviconDeclaration(
      importedSite({
        favicon_source: "https://scp-wiki.wdfiles.com/local--files/site/favicon.gif"
      })
    ),
    { href: `${FAVICON_ROUTE_PREFIX}favicon.gif`, type: "image/gif" }
  )
})

test("favicon declaration keeps Wikidot's fixed gif route for supported configured icons", () => {
  assert.equal(SITE_ICON_CACHE_CONTROL, "no-store")
  assert.deepEqual(
    faviconDeclaration(localSite({ favicon_source: "/local--files/site/icon.png" })),
    {
      href: `${FAVICON_ROUTE_PREFIX}favicon.gif`,
      type: "image/gif"
    }
  )
  assert.deepEqual(
    faviconDeclaration(localSite({ favicon_source: "/local--files/site/icon.ICO" })),
    {
      href: `${FAVICON_ROUTE_PREFIX}favicon.gif`,
      type: "image/gif"
    }
  )
})

test("a site without a usable icon declares nothing", () => {
  assert.equal(faviconDeclaration(null), null)
  assert.equal(faviconDeclaration(localSite()), null)
  assert.equal(faviconDeclaration(localSite({ favicon_source: "" })), null)
  assert.equal(
    faviconDeclaration(localSite({ favicon_source: "/local--files/site/icon" })),
    null,
    "an extensionless source has no type to declare"
  )
  assert.equal(
    faviconDeclaration(localSite({ favicon_source: "/local--files/site/icon.webp" })),
    null,
    "an unmapped extension must not guess a MIME type"
  )
})

test("query strings and fragments are not declared as icon sources", () => {
  assert.equal(
    faviconDeclaration(
      importedSite({
        favicon_source: "https://scp-wiki.wikidot.com/local--favicon/favicon.gif?v=2"
      })
    ),
    null
  )
})

test("Windows 8 tile declaration keeps Wikidot's local route rather than the configured source", () => {
  // Live sandbox-for-codex declares /local--wp8icon/wp8icon.png.
  assert.deepEqual(
    windowsTileDeclaration(
      importedSite({
        windows_tile_source: "https://scp-wiki.wikidot.com/local--wp8icon/wp8icon.png"
      })
    ),
    { href: `${WINDOWS_TILE_ROUTE_PREFIX}${WINDOWS_TILE_FILENAME}` }
  )
  assert.deepEqual(
    windowsTileDeclaration(
      localSite({ windows_tile_source: "/local--files/site/windows-tile.png" })
    ),
    { href: `${WINDOWS_TILE_ROUTE_PREFIX}${WINDOWS_TILE_FILENAME}` }
  )
})

test("a site without a usable Windows 8 tile declares nothing", () => {
  assert.equal(WINDOWS_TILE_FILENAME, "wp8icon.png")
  assert.equal(windowsTileDeclaration(null), null)
  assert.equal(windowsTileDeclaration(localSite()), null)
  assert.equal(windowsTileDeclaration(localSite({ windows_tile_source: "" })), null)
  assert.equal(
    windowsTileDeclaration(
      localSite({ windows_tile_source: "https://evil.example/tile.png" })
    ),
    null
  )
  assert.equal(
    windowsTileDeclaration(
      importedSite({
        windows_tile_source: "https://scp-wiki.wikidot.com/local--favicon/favicon.gif"
      })
    ),
    null,
    "a favicon route must not be declared as the Windows tile"
  )
})

test("iOS touch icons reproduce the three filenames and sizes Wikidot declares", () => {
  assert.equal(
    hasIosIcons(localSite({ ios_icon_source: "/local--files/site/iosicon.png" })),
    true
  )
  assert.equal(hasIosIcons(localSite()), false)
  assert.equal(hasIosIcons(null), false)

  assert.deepEqual(
    IOS_ICON_DECLARATIONS.map(
      (icon) => `${IOS_ICON_ROUTE_PREFIX}${icon.filename} ${icon.sizes ?? "-"}`
    ),
    [
      "/local--iosicon/iosicon_57.png -",
      "/local--iosicon/iosicon_72.png 72x72",
      "/local--iosicon/iosicon.png 114x114"
    ]
  )
})
