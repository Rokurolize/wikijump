import assert from "node:assert/strict"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, extname, join } from "node:path"
import test from "node:test"

const REPOSITORY_ROOT = new URL("../../", import.meta.url).pathname
const SCAN_ENTRIES = [
  "framerail/src",
  "framerail/server.ts",
  "framerail/static",
  "deepwell/src",
  "wws/src",
  "locales/cmftml",
  "locales/fluent"
]
const MARKER = /UNTRANSLATED:|\bUT:/u
const BINARY_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2"
])

function files(path: string): string[] {
  if (statSync(path).isFile()) return [path]

  return readdirSync(path)
    .sort()
    .flatMap((name) => files(join(path, name)))
}

function binary(path: string, contents: Buffer): boolean {
  return BINARY_EXTENSIONS.has(extname(path).toLowerCase()) || contents.includes(0)
}

function markerFiles(path: string): string[] {
  return files(path).filter((file) => {
    const contents = readFileSync(file)
    return !binary(file, contents) && MARKER.test(contents.toString("utf8"))
  })
}

test("marker scan covers templates, scripts, Rust sources, and locale resources", () => {
  const root = mkdtempSync(join(tmpdir(), "wikijump-untranslated-scan-"))

  try {
    writeFileSync(join(root, "component.svelte"), "<p>UNTRANSLATED:Title</p>")
    writeFileSync(join(root, "script.ts"), 'const label = "UT: Title"')
    writeFileSync(join(root, "backend.rs"), 'const LABEL: &str = "UNTRANSLATED:Title";')
    writeFileSync(join(root, "en.ftl"), "title = UNTRANSLATED:Title")
    mkdirSync(join(root, "nested"))
    writeFileSync(join(root, "nested", "blocks.yaml"), "TITLE: UT: Title")
    writeFileSync(join(root, "clean.ts"), 'const label = "Translated"')
    writeFileSync(join(root, "font.woff2"), "UNTRANSLATED: not source text")

    assert.deepEqual(
      markerFiles(root)
        .map((file) => basename(file))
        .sort(),
      ["backend.rs", "component.svelte", "en.ftl", "blocks.yaml", "script.ts"].sort()
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("no production user-facing source carries an UNTRANSLATED or UT developer marker", () => {
  const marked = SCAN_ENTRIES.flatMap((entry) =>
    markerFiles(join(REPOSITORY_ROOT, entry))
  )
  assert.deepEqual(marked, [])
})
