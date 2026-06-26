import { expect, test } from "@playwright/test"

const xmlRpcListMethodsRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>system.listMethods</methodName>
  <params />
</methodCall>`

const xmlRpcUnknownMethodRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>not.realMethod</methodName>
  <params />
</methodCall>`

const xmlRpcMethodHelpRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>system.methodHelp</methodName>
  <params>
    <param><value><string>pages.select</string></value></param>
  </params>
</methodCall>`

const xmlRpcMethodSignatureRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>system.methodSignature</methodName>
  <params>
    <param><value><string>system.multicall</string></value></param>
  </params>
</methodCall>`

const xmlRpcMulticallRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>system.multicall</methodName>
  <params>
    <param>
      <value>
        <array>
          <data>
            <value>
              <struct>
                <member><name>methodName</name><value><string>system.listMethods</string></value></member>
                <member><name>params</name><value><array><data /></array></value></member>
              </struct>
            </value>
            <value>
              <struct>
                <member><name>methodName</name><value><string>not.realMethod</string></value></member>
                <member><name>params</name><value><array><data /></array></value></member>
              </struct>
            </value>
          </data>
        </array>
      </value>
    </param>
  </params>
</methodCall>`

const xmlRpcCategoriesSelectRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>categories.select</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`

const xmlRpcTagsSelectRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>tags.select</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
          <member><name>categories</name><value><array><data><value><string>nav</string></value></data></array></value></member>
          <member><name>pages</name><value><array><data><value><string>nav:side</string></value></data></array></value></member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`

const xmlRpcTagsSelectCategoryRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>tags.select</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
          <member><name>categories</name><value><array><data><value><string>nav</string></value></data></array></value></member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`

const xmlRpcPagesSelectRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>pages.select</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
          <member><name>pagetype</name><value><string>normal</string></value></member>
          <member><name>categories</name><value><array><data><value><string>_default</string></value></data></array></value></member>
          <member><name>created_by</name><value><string>-1</string></value></member>
          <member><name>order</name><value><string>created_at desc</string></value></member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`

const xmlRpcPagesSelectRatingRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>pages.select</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
          <member><name>categories</name><value><array><data><value><string>_default</string></value></data></array></value></member>
          <member><name>created_by</name><value><string>-1</string></value></member>
          <member><name>rating</name><value><string>&gt;999999</string></value></member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`

const xmlRpcPagesGetMetaRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>pages.get_meta</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
          <member><name>pages</name><value><array><data><value><string>scp-9506</string></value><value><string>scp-173</string></value></data></array></value></member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`

const xmlRpcPagesGetOneRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>pages.get_one</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
          <member><name>page</name><value><string>scp-9506</string></value></member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`

const xmlRpcPagesGetMetaTooManyRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>pages.get_meta</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
          <member><name>pages</name><value><array><data><value><string>page-01</string></value><value><string>page-02</string></value><value><string>page-03</string></value><value><string>page-04</string></value><value><string>page-05</string></value><value><string>page-06</string></value><value><string>page-07</string></value><value><string>page-08</string></value><value><string>page-09</string></value><value><string>page-10</string></value><value><string>page-11</string></value></data></array></value></member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`

function xmlRpcPagesSaveOneRequest({
  page,
  title,
  content,
  tags,
  parentFullname,
  saveMode,
  renameAs,
  revisionComment
}: {
  page: string
  title?: string
  content?: string
  tags?: string[]
  parentFullname?: string
  saveMode?: string
  renameAs?: string
  revisionComment?: string
}) {
  const optionalMembers = [
    title
      ? `<member><name>title</name><value><string>${title}</string></value></member>`
      : "",
    content
      ? `<member><name>content</name><value><string>${content}</string></value></member>`
      : "",
    tags
      ? `<member><name>tags</name><value><array><data>${tags
          .map((tag) => `<value><string>${tag}</string></value>`)
          .join("")}</data></array></value></member>`
      : "",
    parentFullname !== undefined
      ? `<member><name>parent_fullname</name><value><string>${parentFullname}</string></value></member>`
      : "",
    saveMode
      ? `<member><name>save_mode</name><value><string>${saveMode}</string></value></member>`
      : "",
    renameAs
      ? `<member><name>rename_as</name><value><string>${renameAs}</string></value></member>`
      : "",
    revisionComment
      ? `<member><name>revision_comment</name><value><string>${revisionComment}</string></value></member>`
      : ""
  ].join("")

  return `<?xml version="1.0"?>
<methodCall>
  <methodName>pages.save_one</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
          <member><name>page</name><value><string>${page}</string></value></member>
          ${optionalMembers}
        </struct>
      </value>
    </param>
  </params>
</methodCall>`
}

function xmlRpcFilesSelectRequest(page: string) {
  return `<?xml version="1.0"?>
<methodCall>
  <methodName>files.select</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
          <member><name>page</name><value><string>${page}</string></value></member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`
}

function xmlRpcFilesGetMetaRequest(page: string, files: string[]) {
  return `<?xml version="1.0"?>
<methodCall>
  <methodName>files.get_meta</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
          <member><name>page</name><value><string>${page}</string></value></member>
          <member><name>files</name><value><array><data>${files
            .map((file) => `<value><string>${file}</string></value>`)
            .join("")}</data></array></value></member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`
}

function xmlRpcFilesGetOneRequest(page: string, file: string) {
  return `<?xml version="1.0"?>
<methodCall>
  <methodName>files.get_one</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
          <member><name>page</name><value><string>${page}</string></value></member>
          <member><name>file</name><value><string>${file}</string></value></member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`
}

function xmlRpcFilesSaveOneRequest({
  page,
  file,
  content,
  comment,
  saveMode,
  revisionComment
}: {
  page: string
  file: string
  content: string
  comment?: string
  saveMode?: string
  revisionComment?: string
}) {
  const optionalMembers = [
    comment
      ? `<member><name>comment</name><value><string>${comment}</string></value></member>`
      : "",
    saveMode
      ? `<member><name>save_mode</name><value><string>${saveMode}</string></value></member>`
      : "",
    revisionComment
      ? `<member><name>revision_comment</name><value><string>${revisionComment}</string></value></member>`
      : ""
  ].join("")

  return `<?xml version="1.0"?>
<methodCall>
  <methodName>files.save_one</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
          <member><name>page</name><value><string>${page}</string></value></member>
          <member><name>file</name><value><string>${file}</string></value></member>
          <member><name>content</name><value><string>${content}</string></value></member>
          ${optionalMembers}
        </struct>
      </value>
    </param>
  </params>
</methodCall>`
}

const xmlRpcHeaders = {
  authorization: `Basic ${Buffer.from("test-app:test-key").toString("base64")}`,
  "content-type": "text/xml"
}

const xmlRpcWriteHeaders = {
  authorization: `Basic ${Buffer.from(
    `${process.env.WIKIDOT_VERIFY_ADMIN_EMAIL ?? "admin@wikijump"}:${
      process.env.WIKIDOT_VERIFY_ADMIN_PASS ?? "wikijumpadmin1"
    }`
  ).toString("base64")}`,
  "content-type": "text/xml"
}

test("XML-RPC endpoint accepts Basic-authenticated system.listMethods calls", async ({
  request
}) => {
  const response = await request.post("/xml-rpc-api.php", {
    data: xmlRpcListMethodsRequest,
    headers: xmlRpcHeaders
  })

  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("text/xml")

  const body = await response.text()
  expect(body).toContain("<methodResponse>")
  expect(body).toContain("<array>")
  expect(body).toContain("<string>system.listMethods</string>")
})

test("XML-RPC endpoint exposes system method discovery, help, and signatures", async ({
  request
}) => {
  const listResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcListMethodsRequest,
    headers: xmlRpcHeaders
  })
  const listBody = await listResponse.text()
  expect(listResponse.status()).toBe(200)
  expect(listBody).toContain("<string>system.methodHelp</string>")
  expect(listBody).toContain("<string>system.methodSignature</string>")
  expect(listBody).toContain("<string>system.multicall</string>")
  expect(listBody).toContain("<string>pages.select</string>")

  const helpResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcMethodHelpRequest,
    headers: xmlRpcHeaders
  })
  expect(helpResponse.status()).toBe(200)
  expect(await helpResponse.text()).toContain(
    "Select pages from a Wikidot-compatible site"
  )

  const signatureResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcMethodSignatureRequest,
    headers: xmlRpcHeaders
  })
  const signatureBody = await signatureResponse.text()
  expect(signatureResponse.status()).toBe(200)
  expect(signatureBody).toContain("<string>array</string>")
})

test("XML-RPC endpoint supports system.multicall with partial faults", async ({
  request
}) => {
  const response = await request.post("/xml-rpc-api.php", {
    data: xmlRpcMulticallRequest,
    headers: xmlRpcHeaders
  })

  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("text/xml")

  const body = await response.text()
  expect(body).toContain("<methodResponse>")
  expect(body).toContain("<string>system.listMethods</string>")
  expect(body).toContain("<name>faultCode</name><value><int>-32601</int></value>")
  expect(body).toContain("<name>faultString</name>")
})

test("XML-RPC endpoint selects local categories and tags", async ({ request }) => {
  const categoriesResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcCategoriesSelectRequest,
    headers: xmlRpcHeaders
  })
  expect(categoriesResponse.status()).toBe(200)
  const categoriesBody = await categoriesResponse.text()
  expect(categoriesBody).toContain("<string>_default</string>")
  expect(categoriesBody).toContain("<string>nav</string>")

  const tagsResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcTagsSelectRequest,
    headers: xmlRpcHeaders
  })
  expect(tagsResponse.status()).toBe(200)
  const tagsBody = await tagsResponse.text()
  expect(tagsBody).toContain("<array>")
  expect(tagsBody).toContain("<data>")

  const categoryTagsResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcTagsSelectCategoryRequest,
    headers: xmlRpcHeaders
  })
  expect(categoryTagsResponse.status()).toBe(200)
  const categoryTagsBody = await categoryTagsResponse.text()
  expect(categoryTagsBody).toContain("<array>")
  expect(categoryTagsBody).toContain("<data>")
})

test("XML-RPC endpoint selects pages with documented filters and ordering", async ({
  request
}) => {
  const response = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSelectRequest,
    headers: xmlRpcHeaders
  })
  expect(response.status()).toBe(200)

  const body = await response.text()
  expect(body).toContain("<string>scp-173</string>")
  expect(body).toContain("<string>scp-anthology-2024</string>")
  expect(body).toContain("<string>scp-8566</string>")
  expect(body).not.toContain("<string>nav:side</string>")
  expect(body).not.toContain("<string>main</string>")
  expect(body).toContain("<array><data>")

  const ratingResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSelectRatingRequest,
    headers: xmlRpcHeaders
  })
  expect(ratingResponse.status()).toBe(200)

  const ratingBody = await ratingResponse.text()
  expect(ratingBody).toContain("<methodResponse>")
  expect(ratingBody).toContain("<array><data></data></array>")
  expect(ratingBody).not.toContain("<fault>")
  expect(ratingBody).not.toContain("<string>scp-173</string>")
  expect(ratingBody).not.toContain("<string>scp-anthology-2024</string>")
  expect(ratingBody).not.toContain("<string>scp-8566</string>")
})

test("XML-RPC endpoint returns page metadata and bodies for corpus clients", async ({
  request
}) => {
  const metaResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesGetMetaRequest,
    headers: xmlRpcHeaders
  })
  expect(metaResponse.status()).toBe(200)

  const metaBody = await metaResponse.text()
  expect(metaBody).toContain("<methodResponse>")
  expect(metaBody).toContain("<name>scp-9506</name>")
  expect(metaBody).toContain("<name>scp-173</name>")
  expect(metaBody).toContain(
    "<name>fullname</name><value><string>scp-9506</string></value>"
  )
  expect(metaBody).toContain(
    "<name>title</name><value><string>National Fog Safety Initiative</string></value>"
  )
  expect(metaBody).toContain("<name>parent_fullname</name><value><nil /></value>")
  expect(metaBody).toContain("<name>tags</name><value><array><data>")
  expect(metaBody).toContain("<name>rating</name><value><int>0</int></value>")
  expect(metaBody).toContain("<name>revisions</name><value><int>1</int></value>")
  expect(metaBody).not.toContain("Official United States government website")

  const oneResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesGetOneRequest,
    headers: xmlRpcHeaders
  })
  expect(oneResponse.status()).toBe(200)

  const oneBody = await oneResponse.text()
  expect(oneBody).toContain("<methodResponse>")
  expect(oneBody).toContain(
    "<name>fullname</name><value><string>scp-9506</string></value>"
  )
  expect(oneBody).toContain("<name>content</name><value><string>")
  expect(oneBody).toContain("component:preview")
  expect(oneBody).toContain("<name>html</name><value><string>")
  expect(oneBody).toContain("NFSI.png")
  expect(oneBody).toContain("<name>parent_title</name><value><nil /></value>")
  expect(oneBody).toContain("<name>children</name><value><int>0</int></value>")
  expect(oneBody).toContain("<name>comments</name><value><int>0</int></value>")
  expect(oneBody).toContain("<name>commented_at</name><value><nil /></value>")
  expect(oneBody).toContain("<name>commented_by</name><value><nil /></value>")

  const tooManyResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesGetMetaTooManyRequest,
    headers: xmlRpcHeaders
  })
  expect(tooManyResponse.status()).toBe(200)

  const tooManyBody = await tooManyResponse.text()
  expect(tooManyBody).toContain("<fault>")
  expect(tooManyBody).toContain("<name>faultCode</name><value><int>-32602</int></value>")
  expect(tooManyBody).toContain("pages.get_meta pages is limited to 10 entries")
})

test("XML-RPC endpoint saves pages with tags, parent updates, and rename", async ({
  request
}) => {
  const slug = `fixture-xmlrpc-save-${Date.now()}`
  const renamedSlug = `${slug}-renamed`

  const createResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSaveOneRequest({
      page: slug,
      title: "XML-RPC Save Proof",
      content: "XML-RPC save proof initial content.",
      tags: ["verification", "xmlrpc-save"],
      parentFullname: "main",
      saveMode: "create",
      revisionComment: "xmlrpc save create proof"
    }),
    headers: xmlRpcWriteHeaders
  })
  expect(createResponse.status()).toBe(200)

  const createBody = await createResponse.text()
  expect(createBody).toContain(
    `<name>fullname</name><value><string>${slug}</string></value>`
  )
  expect(createBody).toContain(
    "<name>title</name><value><string>XML-RPC Save Proof</string></value>"
  )
  expect(createBody).toContain(
    "<name>content</name><value><string>XML-RPC save proof initial content.</string></value>"
  )
  expect(createBody).toContain(
    "<name>parent_fullname</name><value><string>main</string></value>"
  )
  expect(createBody).toContain("<value><string>xmlrpc-save</string></value>")

  const updateResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSaveOneRequest({
      page: slug,
      title: "XML-RPC Save Proof Updated",
      content: "XML-RPC save proof updated content.",
      tags: ["verification", "xmlrpc-save-updated"],
      parentFullname: "-",
      saveMode: "update",
      revisionComment: "xmlrpc save update proof"
    }),
    headers: xmlRpcWriteHeaders
  })
  expect(updateResponse.status()).toBe(200)

  const updateBody = await updateResponse.text()
  expect(updateBody).toContain(
    "<name>title</name><value><string>XML-RPC Save Proof Updated</string></value>"
  )
  expect(updateBody).toContain(
    "<name>content</name><value><string>XML-RPC save proof updated content.</string></value>"
  )
  expect(updateBody).toContain("<name>parent_fullname</name><value><nil /></value>")
  expect(updateBody).toContain("<value><string>xmlrpc-save-updated</string></value>")
  expect(updateBody).not.toContain("<value><string>xmlrpc-save</string></value>")

  const renameResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSaveOneRequest({
      page: slug,
      title: "XML-RPC Save Proof Renamed",
      content: "XML-RPC save proof renamed content.",
      tags: ["verification", "xmlrpc-save-renamed"],
      parentFullname: "main",
      saveMode: "update",
      renameAs: renamedSlug,
      revisionComment: "xmlrpc save rename proof"
    }),
    headers: xmlRpcWriteHeaders
  })
  expect(renameResponse.status()).toBe(200)

  const renameBody = await renameResponse.text()
  expect(renameBody).toContain(
    `<name>fullname</name><value><string>${renamedSlug}</string></value>`
  )
  expect(renameBody).toContain(
    "<name>title</name><value><string>XML-RPC Save Proof Renamed</string></value>"
  )
  expect(renameBody).toContain(
    "<name>content</name><value><string>XML-RPC save proof renamed content.</string></value>"
  )
  expect(renameBody).toContain(
    "<name>parent_fullname</name><value><string>main</string></value>"
  )
  expect(renameBody).toContain("<value><string>xmlrpc-save-renamed</string></value>")
})

test("XML-RPC endpoint saves and reads small page attachments", async ({ request }) => {
  const pageSlug = `fixture-xmlrpc-file-${Date.now()}`
  const fileName = "proof.txt"
  const initialText = "XML-RPC file proof initial content."
  const updatedText = "XML-RPC file proof updated content."
  const initialContent = Buffer.from(initialText).toString("base64")
  const updatedContent = Buffer.from(updatedText).toString("base64")

  const pageResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSaveOneRequest({
      page: pageSlug,
      title: "XML-RPC File Proof",
      content: "Page for XML-RPC file proof.",
      tags: ["verification", "xmlrpc-file"],
      saveMode: "create",
      revisionComment: "xmlrpc file page create proof"
    }),
    headers: xmlRpcWriteHeaders
  })
  expect(pageResponse.status()).toBe(200)
  expect(await pageResponse.text()).toContain(
    `<name>fullname</name><value><string>${pageSlug}</string></value>`
  )

  const saveResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcFilesSaveOneRequest({
      page: pageSlug,
      file: fileName,
      content: initialContent,
      comment: "initial file proof",
      saveMode: "create",
      revisionComment: "xmlrpc file create proof"
    }),
    headers: xmlRpcWriteHeaders
  })
  expect(saveResponse.status()).toBe(200)

  const saveBody = await saveResponse.text()
  expect(saveBody).toContain("<methodResponse>")
  expect(saveBody).toContain("<name>size</name><value><int>35</int></value>")
  expect(saveBody).toContain(
    "<name>comment</name><value><string>xmlrpc file create proof</string></value>"
  )
  expect(saveBody).toContain("<name>mime_type</name><value><string>")

  const selectResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcFilesSelectRequest(pageSlug),
    headers: xmlRpcHeaders
  })
  expect(selectResponse.status()).toBe(200)
  expect(await selectResponse.text()).toContain("<string>proof.txt</string>")

  const metaResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcFilesGetMetaRequest(pageSlug, [fileName]),
    headers: xmlRpcHeaders
  })
  expect(metaResponse.status()).toBe(200)
  const metaBody = await metaResponse.text()
  expect(metaBody).toContain("<name>proof.txt</name>")
  expect(metaBody).toContain("<name>size</name><value><int>35</int></value>")
  expect(metaBody).toContain(
    "<name>comment</name><value><string>xmlrpc file create proof</string></value>"
  )
  expect(metaBody).not.toContain(initialContent)

  const oneResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcFilesGetOneRequest(pageSlug, fileName),
    headers: xmlRpcHeaders
  })
  expect(oneResponse.status()).toBe(200)
  const oneBody = await oneResponse.text()
  expect(oneBody).toContain(
    `<name>content</name><value><string>${initialContent}</string>`
  )

  const updateResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcFilesSaveOneRequest({
      page: pageSlug,
      file: fileName,
      content: updatedContent,
      comment: "updated file proof",
      saveMode: "update",
      revisionComment: "xmlrpc file update proof"
    }),
    headers: xmlRpcWriteHeaders
  })
  expect(updateResponse.status()).toBe(200)
  const updateBody = await updateResponse.text()
  expect(updateBody).toContain("<name>size</name><value><int>35</int></value>")
  expect(updateBody).toContain(
    "<name>comment</name><value><string>xmlrpc file update proof</string></value>"
  )

  const updatedOneResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcFilesGetOneRequest(pageSlug, fileName),
    headers: xmlRpcHeaders
  })
  expect(updatedOneResponse.status()).toBe(200)
  const updatedOneBody = await updatedOneResponse.text()
  expect(updatedOneBody).toContain(
    `<name>content</name><value><string>${updatedContent}</string>`
  )
  expect(updatedOneBody).not.toContain(initialContent)
})

test("XML-RPC endpoint returns XML-RPC faults for unauthenticated requests", async ({
  request
}) => {
  const response = await request.post("/xml-rpc-api.php", {
    data: xmlRpcListMethodsRequest,
    headers: {
      "content-type": "text/xml"
    }
  })

  expect(response.status()).toBe(401)
  expect(response.headers()["content-type"]).toContain("text/xml")
  expect(response.headers()["www-authenticate"]).toBe('Basic realm="Wikijump XML-RPC"')

  const body = await response.text()
  expect(body).toContain("<methodResponse>")
  expect(body).toContain("<fault>")
  expect(body).toContain("<name>faultCode</name><value><int>401</int></value>")
  expect(body).not.toContain("test-key")
})

test("XML-RPC endpoint returns XML-RPC faults for malformed XML", async ({ request }) => {
  const response = await request.post("/xml-rpc-api.php", {
    data: "<methodCall>",
    headers: xmlRpcHeaders
  })

  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("text/xml")

  const body = await response.text()
  expect(body).toContain("<methodResponse>")
  expect(body).toContain("<fault>")
  expect(body).toContain("<name>faultCode</name><value><int>-32600</int></value>")
})

test("XML-RPC endpoint returns XML-RPC faults for unsupported methods", async ({
  request
}) => {
  const response = await request.post("/xml-rpc-api.php", {
    data: xmlRpcUnknownMethodRequest,
    headers: xmlRpcHeaders
  })

  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("text/xml")

  const body = await response.text()
  expect(body).toContain("<methodResponse>")
  expect(body).toContain("<fault>")
  expect(body).toContain("<name>faultCode</name><value><int>-32601</int></value>")
})
