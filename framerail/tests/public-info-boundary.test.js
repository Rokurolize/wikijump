// @ts-nocheck
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createServer as createViteServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))

const rawInfo = {
  package: {
    name: "PUBLIC_PACKAGE_NAME_SENTINEL",
    description: "PUBLIC_PACKAGE_DESCRIPTION_SENTINEL",
    license: "PUBLIC_PACKAGE_LICENSE_SENTINEL",
    repository: "https://PUBLIC_REPOSITORY_SENTINEL.example/",
    version: "PUBLIC_PACKAGE_VERSION_SENTINEL"
  },
  compile_info: {
    built_at: "PRIVATE_BUILT_AT_SENTINEL",
    rustc_version: "PUBLIC_RUSTC_VERSION_SENTINEL",
    endian: "PRIVATE_ENDIAN_SENTINEL",
    target: "PRIVATE_TARGET_SENTINEL",
    threads: 987654321,
    git_commit: "PRIVATE_GIT_COMMIT_SENTINEL"
  },
  current_time: "PRIVATE_CURRENT_TIME_SENTINEL",
  hostname: "PRIVATE_HOSTNAME_SENTINEL",
  config_path: "PRIVATE_CONFIG_PATH_SENTINEL",
  future_private_field: "PRIVATE_FUTURE_FIELD_SENTINEL"
}

let previousWorkingDirectory
let vite
let render
let client
let originalClientRequest
let aboutPage
let aboutRoute

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
  ;({ client } = await vite.ssrLoadModule("/src/lib/server/deepwell/index.ts"))
  originalClientRequest = client.request
  ;({ default: aboutPage } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/about/+page.svelte"
  ))
  aboutRoute = await vite.ssrLoadModule("/src/routes/[x+2d]/about/+page.server.ts")
})

after(async () => {
  if (client && originalClientRequest) client.request = originalClientRequest
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

test("GET /-/about projects Deepwell info to its public fields", async () => {
  client.request = async (method) => {
    if (method === "info") return rawInfo
    if (method === "translate") return {}
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  const data = await aboutRoute.load({
    parent: async () => ({ locales: ["en-US", "en"] })
  })

  assert.deepEqual(data.backend, {
    package: {
      name: "PUBLIC_PACKAGE_NAME_SENTINEL",
      description: "PUBLIC_PACKAGE_DESCRIPTION_SENTINEL",
      license: "PUBLIC_PACKAGE_LICENSE_SENTINEL",
      repository: "https://PUBLIC_REPOSITORY_SENTINEL.example/",
      version: "PUBLIC_PACKAGE_VERSION_SENTINEL"
    },
    compile_info: {
      rustc_version: "PUBLIC_RUSTC_VERSION_SENTINEL"
    }
  })

  const body = render(aboutPage, { props: { data } }).body
  assert.match(body, /PUBLIC_PACKAGE_NAME_SENTINEL/u)
  assert.match(body, /PUBLIC_RUSTC_VERSION_SENTINEL/u)
  assert.doesNotMatch(body, /PRIVATE_[A-Z_]+_SENTINEL/u)
  assert.doesNotMatch(body, /<textarea\b/u)
})
