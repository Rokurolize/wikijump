import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import { test } from "node:test"

import {
  WIKIDOT_USER_INFO_MISSING,
  loadWikidotUserInfo
} from "../src/lib/server/wikidot-user-info.js"

const routeFiles = [
  "../src/routes/user[x+3a]info/[target]/+page.server.ts",
  "../src/routes/user[x+3a]info/[target]/+page.svelte"
]

test("GET /user:info/<target> has an encoded public route", async () => {
  for (const routeFile of routeFiles) {
    await assert.doesNotReject(access(new URL(routeFile, import.meta.url)))
  }
})

const publicUser = {
  user_id: 169306,
  user_type: "regular",
  created_at: "2008-07-19T21:26:10Z",
  updated_at: "2026-08-10T00:00:00Z",
  deleted_at: null,
  name: `The <Administrator> & "owner" <script>alert(1)</script>`,
  slug: "the-administrator",
  avatar_s3_hash: [1, 2, 3],
  email: "not-public-email-marker",
  email_verified_at: "2026-08-10T00:00:00Z",
  password: "not-public",
  real_name: "Not Public",
  biography: "Not Public",
  locales: ["en"]
}

test("UserInfo calls the typed user view with the route target and no session", async () => {
  const calls = []
  const userView = async (...args) => {
    calls.push(args)
    return { type: "user_found", data: { user: publicUser } }
  }

  await loadWikidotUserInfo({
    siteId: 7,
    locales: ["en"],
    target: "the-administrator",
    userView
  })

  assert.deepEqual(calls, [[7, ["en"], undefined, "the-administrator"]])
})

test("UserInfo projects only evidenced public identity fields", async () => {
  const result = await loadWikidotUserInfo({
    siteId: 7,
    locales: ["en"],
    target: "the-administrator",
    userView: async () => ({ type: "user_found", data: { user: publicUser } })
  })

  assert.deepEqual(result, {
    status: 200,
    view: "user_found",
    user: {
      userId: 169306,
      name: publicUser.name,
      slug: "the-administrator",
      accountType: "regular",
      createdAt: "2008-07-19T21:26:10Z"
    },
    privateMessageControl: {
      label: "Write private message",
      redacted: true
    }
  })
  assert.equal(JSON.stringify(result).includes("not-public"), false)
})

test("UserInfo exposes an avatar only through the existing trusted file seam", async () => {
  const hashes = []
  const result = await loadWikidotUserInfo({
    siteId: 7,
    locales: ["en"],
    target: "the-administrator",
    userView: async () => ({ type: "user_found", data: { user: publicUser } }),
    loadAvatar: async (hash) => {
      hashes.push(hash)
      return "data:image/png;base64,public-avatar"
    }
  })

  assert.deepEqual(hashes, [[1, 2, 3]])
  assert.equal(result.user.avatar, "data:image/png;base64,public-avatar")
  assert.equal(JSON.stringify(result).includes("avatar_s3_hash"), false)
})

test("UserInfo route data is actor invariant", async () => {
  const userView = async () => ({ type: "user_found", data: { user: publicUser } })
  const common = {
    siteId: 7,
    locales: ["en"],
    target: "the-administrator",
    userView
  }

  const anonymous = await loadWikidotUserInfo({ ...common, actor: "anonymous" })
  const accountA = await loadWikidotUserInfo({ ...common, actor: "account-a" })

  assert.deepEqual(anonymous, accountA)
})

test("UserInfo route does not read cookies or forward a session", async () => {
  const source = await readFile(
    new URL("../src/routes/user[x+3a]info/[target]/+page.server.ts", import.meta.url),
    "utf8"
  )

  assert.doesNotMatch(source, /cookies|sessionToken|wikijump_token/u)
  assert.match(source, /target:\s*params\.target/u)
})

for (const target of ["0", "-1"]) {
  test(`UserInfo target ${target} stays HTTP 200 with the exact missing body data`, async () => {
    const result = await loadWikidotUserInfo({
      siteId: 7,
      locales: ["en"],
      target,
      userView: async () => ({ type: "user_missing", data: undefined })
    })

    assert.deepEqual(result, {
      status: 200,
      view: "user_missing",
      error: WIKIDOT_USER_INFO_MISSING
    })
    assert.equal(JSON.stringify(result).includes("privateMessage"), false)
    assert.equal(JSON.stringify(result).includes("avatar"), false)
    assert.equal(JSON.stringify(result).includes("href"), false)
  })
}

test("UserInfo view escapes identity data and leaves private messaging noninteractive", async () => {
  const source = await readFile(
    new URL("../src/routes/user[x+3a]info/[target]/+page.svelte", import.meta.url),
    "utf8"
  )

  assert.doesNotMatch(source, /\{@html\}|innerHTML/u)
  assert.doesNotMatch(source, /href\s*=|onclick\s*=|<form\b/u)
  assert.match(source, /\{data\.user\.name\}/u)
  assert.match(source, /data-redacted-control="private-message"/u)
  assert.match(source, /<div class="error-block">\{data\.error\}<\/div>/u)
})
