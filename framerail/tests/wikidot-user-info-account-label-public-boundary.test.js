// @ts-nocheck
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createServer as createViteServer } from "vite"

import { loadWikidotUserInfo } from "../src/lib/server/wikidot-user-info.js"

const root = fileURLToPath(new URL("..", import.meta.url))

let previousWorkingDirectory
let vite
let render
let userInfoPage

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
  ;({ default: userInfoPage } = await vite.ssrLoadModule(
    "/src/routes/user[x+3a]info/[target]/+page.svelte"
  ))
})

after(async () => {
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

// Retained live cases: userinfo-target-routes-live-20260810.json.
const foundTargets = [
  {
    user_id: 169306,
    user_type: "regular",
    created_at: "2008-07-19T21:26:10Z",
    name: "The Administrator",
    slug: "the-administrator",
    avatar_s3_hash: null
  },
  {
    user_id: 1698600,
    user_type: "regular",
    created_at: "2013-08-16T13:07:00Z",
    name: "Dr Clef",
    slug: "dr-clef",
    avatar_s3_hash: null
  }
]

test("UserInfo SSR presents evidenced regular accounts as Wikidot free accounts and omits the field for missing targets", async () => {
  for (const user of foundTargets) {
    const data = await loadWikidotUserInfo({
      siteId: 7,
      locales: ["en"],
      target: user.slug,
      userView: async () => ({ type: "user_found", data: { user } })
    })
    const body = render(userInfoPage, { props: { data } }).body

    assert.match(body, /<dt>Account type:<\/dt>\s*<dd>free<\/dd>/u)
    assert.doesNotMatch(body, /<dd>regular<\/dd>/u)
  }

  for (const target of ["0", "-1"]) {
    const data = await loadWikidotUserInfo({
      siteId: 7,
      locales: ["en"],
      target,
      userView: async () => ({ type: "user_missing", data: undefined })
    })
    const body = render(userInfoPage, { props: { data } }).body

    assert.doesNotMatch(body, /Account type:/u)
  }
})
