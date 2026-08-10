// @ts-nocheck
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createServer as createViteServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))

let previousWorkingDirectory
let vite
let render
let revisionAuthorComponent

before(async () => {
  previousWorkingDirectory = process.cwd()
  process.chdir(root)
  vite = await createViteServer({
    root,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true }
  })

  ;({ render } = await vite.ssrLoadModule("svelte/server"))
  ;({ default: revisionAuthorComponent } = await vite.ssrLoadModule(
    "/src/routes/[slug]/[...extra]/RevisionAuthor.svelte"
  ))
})

after(async () => {
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

test("History renders the resolved author name without exposing its numeric ID", () => {
  const body = render(revisionAuthorComponent, {
    props: {
      author: {
        "user-id": -20,
        "user-slug": "history-importer",
        "user-name": "History Importer",
        "user-karma": 0,
        "user-avatar-data": "",
        "user-profile-url": "/-/user/history-importer"
      }
    }
  }).body

  assert.match(
    body,
    /<span class="printuser"><a href="\/-\/user\/history-importer">History Importer<\/a><\/span>/u
  )
  assert.doesNotMatch(body, />-20</u)
})

test("History leaves a missing or deleted author identity neutral", () => {
  const body = render(revisionAuthorComponent, {
    props: { author: null }
  }).body

  assert.equal(body.replaceAll(/<!--[\s\S]*?-->/gu, ""), "")
  assert.doesNotMatch(body, /undefined|null|user/u)
})
