// @ts-nocheck
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createServer as createViteServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))

let previousWorkingDirectory
let vite
let render
let forumModuleBody

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
  ;({ default: forumModuleBody } = await vite.ssrLoadModule(
    "/src/lib/ForumModuleBody.svelte"
  ))
})

after(async () => {
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

test("read-only forum bodies render inside exactly one page-content root", () => {
  for (const body of [
    '<div class="forum-start-box">forum</div>',
    "",
    '<div class="error-block">Requested forum category does not exist.</div>'
  ]) {
    const html = render(forumModuleBody, { props: { body } }).body
    const visibleHtml = html.replace(/<!--[\s\S]*?-->/gu, "")

    assert.equal(html.match(/id="page-content"/gu)?.length ?? 0, 1)
    assert.equal(visibleHtml, `<div id="page-content">${body}</div>`)
  }
})
