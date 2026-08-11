// @ts-nocheck
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createServer as createViteServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))

let previousWorkingDirectory
let vite
let render
let SvelteMap
let fileListComponent

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
  ;({ SvelteMap } = await vite.ssrLoadModule("svelte/reactivity"))
  ;({ default: fileListComponent } = await vite.ssrLoadModule(
    "/src/routes/[slug]/[...extra]/FileList.svelte"
  ))
})

after(async () => {
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

test("Files SSR isolates filename cells from imported themes that style .name", () => {
  const fileMap = new SvelteMap([
    [
      7,
      {
        file_id: 7,
        file_created_at: "2026-08-10T01:02:03.000Z",
        file_updated_at: null,
        file_deleted_at: null,
        page_id: 9506,
        revision_id: 11,
        revision_type: "create",
        revision_created_at: "2026-08-10T01:02:03.000Z",
        revision_number: 0,
        revision_user_id: 1,
        name: "theme-collision.txt",
        data: null,
        mime: "text/plain",
        size: 42,
        s3_hash: "fixture-hash",
        revision_comments: "",
        hidden_fields: []
      }
    ]
  ])
  const body = render(fileListComponent, {
    props: {
      data: {
        internationalization: {
          upload: "Upload a file",
          restore: "Restore files",
          history: "Info",
          move: "Move",
          edit: "Edit",
          delete: "Delete",
          "wiki-page-file.name": "File name",
          "wiki-page-file.created-at": "Created",
          "wiki-page-file.updated-at": "Updated",
          "wiki-page-file.size": "Size"
        },
        page: { slug: "scp-9506" },
        site_file_domain: "files.wikijump.test"
      },
      fileMap,
      activeFileAction: null,
      fileEditId: 0,
      wikidot: true,
      getFileList: async () => {},
      deleteFile: async () => {},
      openFileHistory: () => {}
    }
  }).body

  const classLists = [...body.matchAll(/class="([^"]+)"/gu)].map((match) =>
    match[1].split(/\s+/u)
  )
  const fileAttributes = classLists.filter((classes) =>
    classes.includes("file-attribute")
  )
  assert.equal(
    fileAttributes.filter((classes) => classes.includes("file-name")).length,
    2
  )
  assert.equal(fileAttributes.filter((classes) => classes.includes("name")).length, 0)
  assert.ok(classLists.some((classes) => classes.includes("file-list-header")))
  assert.match(body, /class="[^"]*\bfile-row\b[^"]*" data-id="7"/u)
  assert.match(
    body,
    /href="\/\/files\.wikijump\.test\/-\/file\/scp-9506\/theme-collision\.txt"/u
  )
  assert.ok(
    fileAttributes.some((classes) => classes.includes("created-at")),
    "created-at cell remains public"
  )
  assert.ok(
    fileAttributes.some((classes) => classes.includes("updated-at")),
    "updated-at cell remains public"
  )
  assert.ok(
    fileAttributes.some((classes) => classes.includes("size")),
    "size cell remains public"
  )
  assert.ok(
    fileAttributes.some((classes) => classes.includes("action")),
    "action cell remains public"
  )
  assert.match(body, /value="Upload a file"/u)
  assert.match(body, />Info<\/a>/u)
})
