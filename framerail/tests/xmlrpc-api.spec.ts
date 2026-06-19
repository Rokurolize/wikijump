import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { expect, test } from "@playwright/test"

const execFileAsync = promisify(execFile)

const xmlRpcListMethodsRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>system.listMethods</methodName>
  <params />
</methodCall>`

const xmlRpcListMethodsWithParamRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>system.listMethods</methodName>
  <params>
    <param><value><string>unexpected</string></value></param>
  </params>
</methodCall>`

const xmlRpcMalformedParamsRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>system.listMethods</methodName>
  <params>
    <value><string>silently ignored before strict parsing</string></value>
  </params>
</methodCall>`

const xmlRpcUnexpectedMethodCallContentRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>system.listMethods</methodName>
  <extra />
  <params />
</methodCall>`

const xmlRpcUnexpectedParamContentRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>system.methodHelp</methodName>
  <params>
    <param>
      <value><string>pages.select</string></value>
      <extra />
    </param>
  </params>
</methodCall>`

const xmlRpcUnexpectedMemberContentRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>pages.select</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member>
            <name>site</name>
            <value><string>scp-wiki</string></value>
            <extra />
          </member>
        </struct>
      </value>
    </param>
  </params>
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

const xmlRpcUsersGetMeRequest = `<?xml version="1.0"?>
<methodCall>
  <methodName>users.get_me</methodName>
  <params />
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

function xmlRpcPagesGetMetaForPagesRequest(pages: string[]) {
  return `<?xml version="1.0"?>
<methodCall>
  <methodName>pages.get_meta</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
          <member><name>pages</name><value><array><data>${pages
            .map((page) => `<value><string>${page}</string></value>`)
            .join("")}</data></array></value></member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`
}

function xmlRpcPagesGetOneForPageRequest(page: string) {
  return `<?xml version="1.0"?>
<methodCall>
  <methodName>pages.get_one</methodName>
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

function xmlRpcPostsSelectRequest(page: string, replyTo?: string) {
  const replyToMember =
    replyTo !== undefined
      ? `<member><name>reply_to</name><value><string>${replyTo}</string></value></member>`
      : ""

  return `<?xml version="1.0"?>
<methodCall>
  <methodName>posts.select</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
          <member><name>page</name><value><string>${page}</string></value></member>
          ${replyToMember}
        </struct>
      </value>
    </param>
  </params>
</methodCall>`
}

function xmlRpcPostsGetRequest(posts: string[]) {
  return `<?xml version="1.0"?>
<methodCall>
  <methodName>posts.get</methodName>
  <params>
    <param>
      <value>
        <struct>
          <member><name>site</name><value><string>scp-wiki</string></value></member>
          <member><name>posts</name><value><array><data>${posts
            .map((post) => `<value><string>${post}</string></value>`)
            .join("")}</data></array></value></member>
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

function xmlRpcBasicHeaders(username: string, password: string) {
  return {
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    "content-type": "text/xml"
  }
}

function xmlRpcDeepArrayRequest(depth: number) {
  let value = "<value><string>leaf</string></value>"
  for (let i = 0; i < depth; i += 1) {
    value = `<value><array><data>${value}</data></array></value>`
  }

  return `<?xml version="1.0"?>
<methodCall>
  <methodName>system.multicall</methodName>
  <params>
    <param>${value}</param>
  </params>
</methodCall>`
}

const xmlRpcWriteHeaders = {
  ...xmlRpcBasicHeaders(
    process.env.WIKIDOT_VERIFY_ADMIN_EMAIL ?? "admin@wikijump",
    process.env.WIKIDOT_VERIFY_ADMIN_PASS ?? "wikijumpadmin1"
  )
}

async function deepwellRequest(method: string, params: unknown) {
  const response = await fetch("http://127.0.0.1:2747/jsonrpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
  })
  const payload = await response.json()
  if (payload.error) {
    throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`)
  }
  return payload.result
}

async function seedForumCommentFixture({
  page,
  title,
  content
}: {
  page: string
  title: string
  content: string
}) {
  const site = await deepwellRequest("site_get", { site: "scp-wiki" })
  const pageRecord = await deepwellRequest("page_get", {
    site_id: site.site_id,
    page,
    details: {}
  })
  const wikitextHash = await deepwellRequest("text_create", [content])
  const htmlHash = await deepwellRequest("text_create", [`<p>${content}</p>`])
  const fixtureName = `xmlrpc-post-${page}`

  const sql = `
WITH forum_group_row AS (
  INSERT INTO forum_group (site_id, created_by, name, description, visible, sort_index)
  VALUES (${site.site_id}, -1, ${sqlString(fixtureName)}, 'XML-RPC post fixture group', true, 900000000)
  ON CONFLICT (site_id, sort_index) WHERE deleted_at IS NULL
  DO UPDATE SET name = EXCLUDED.name
  RETURNING forum_group_id
),
forum_category_row AS (
  INSERT INTO forum_category (forum_group_id, site_id, created_by, name, description, sort_index, per_page_discussion)
  SELECT forum_group_id, ${site.site_id}, -1, ${sqlString(fixtureName)}, 'XML-RPC post fixture category', 900000000, true
  FROM forum_group_row
  ON CONFLICT (forum_group_id, sort_index) WHERE deleted_at IS NULL
  DO UPDATE SET name = EXCLUDED.name
  RETURNING forum_category_id, forum_group_id
),
forum_thread_row AS (
  INSERT INTO forum_thread (forum_category_id, forum_group_id, site_id, page_id, created_by, title, description)
  SELECT forum_category_id, forum_group_id, ${site.site_id}, ${pageRecord.page_id}, -1, ${sqlString(title)}, 'XML-RPC post fixture thread'
  FROM forum_category_row
  ON CONFLICT (page_id)
  DO UPDATE SET title = EXCLUDED.title
  RETURNING forum_thread_id, forum_category_id, forum_group_id
),
page_thread_update AS (
  UPDATE page
  SET discussion_thread_id = (SELECT forum_thread_id FROM forum_thread_row)
  WHERE page_id = ${pageRecord.page_id}
  RETURNING page_id
),
forum_post_row AS (
  INSERT INTO forum_post (forum_thread_id, forum_category_id, forum_group_id, site_id, user_id)
  SELECT forum_thread_id, forum_category_id, forum_group_id, ${site.site_id}, -1
  FROM forum_thread_row
  RETURNING forum_post_id, forum_thread_id, forum_category_id, forum_group_id
),
forum_revision_row AS (
  INSERT INTO forum_post_revision (
    forum_post_id,
    forum_thread_id,
    forum_category_id,
    forum_group_id,
    site_id,
    user_id,
    revision_number,
    title,
    wikitext_hash,
    compiled_html_hash,
    compiled_at,
    compiled_generator,
    comments
  )
  SELECT
    forum_post_id,
    forum_thread_id,
    forum_category_id,
    forum_group_id,
    ${site.site_id},
    -1,
    0,
    ${sqlString(title)},
    decode(${sqlString(wikitextHash)}, 'hex'),
    decode(${sqlString(htmlHash)}, 'hex'),
    now(),
    'xmlrpc-api.spec.ts',
    'XML-RPC post fixture'
  FROM forum_post_row
  RETURNING forum_post_revision_id, forum_post_id
)
SELECT forum_post_id, forum_post_revision_id FROM forum_revision_row;
`

  const result = await execDatabaseSql(sql)
  const [postId, revisionId] = result.split("|")
  if (!postId || !revisionId) {
    throw new Error(
      `Forum comment fixture did not return post and revision IDs: ${result}`
    )
  }

  const postIdNumber = Number(postId)
  const revisionIdNumber = Number(revisionId)
  if (!Number.isInteger(postIdNumber) || !Number.isInteger(revisionIdNumber)) {
    throw new Error(`Forum comment fixture returned invalid IDs: ${result}`)
  }

  await execDatabaseSql(`
UPDATE forum_post
SET latest_revision_id = ${revisionIdNumber}
WHERE forum_post_id = ${postIdNumber}
RETURNING forum_post_id;
`)
  return postId
}

async function createXmlRpcFixtureUser(stamp: number) {
  const password = "wikijumpuser1"
  const name = `XMLRPC Fixture User ${stamp}`
  const user = await deepwellRequest("user_create", {
    user_type: "regular",
    name,
    email: `xmlrpc-fixture-${stamp}@example.test`,
    locales: ["en_GB"],
    password,
    bypass_filter: true,
    bypass_email_verification: true,
    ip_address: "127.0.0.1"
  })

  return { ...user, password }
}

async function enableMfaForFixtureUser(userId: number) {
  await execDatabaseSql(`
UPDATE "user"
SET
  multi_factor_secret = 'JBSWY3DPEHPK3PXP',
  multi_factor_recovery_codes = ARRAY['xmlrpc-fixture-recovery-code-hash']::text[]
WHERE user_id = ${userId};
`)
}

async function execDatabaseSql(sql: string) {
  const { stdout } = await execFileAsync("docker", [
    "exec",
    "-e",
    "PGPASSWORD=wikijump",
    "local-database-1",
    "psql",
    "-h",
    "127.0.0.1",
    "-U",
    "wikijump",
    "-d",
    "wikijump",
    "-At",
    "-c",
    sql
  ])
  return stdout.trim()
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`
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
  expect(signatureBody).toContain(
    "<name>returnType</name><value><string>array</string></value>"
  )
  expect(signatureBody).toContain("<name>parameters</name><value><array><data>")
  expect(signatureBody).toContain("<value><string>array</string></value>")
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

test("XML-RPC page saves preflight parent and rename failures without mutation", async ({
  request
}) => {
  const slug = `fixture-xmlrpc-preflight-${Date.now()}`
  const collisionSlug = `${slug}-collision`

  const createResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSaveOneRequest({
      page: slug,
      title: "XML-RPC Preflight Proof",
      content: "Original preflight content.",
      tags: ["verification", "xmlrpc-preflight"],
      parentFullname: "main",
      saveMode: "create",
      revisionComment: "xmlrpc preflight create proof"
    }),
    headers: xmlRpcWriteHeaders
  })
  expect(createResponse.status()).toBe(200)

  const collisionResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSaveOneRequest({
      page: collisionSlug,
      title: "XML-RPC Preflight Collision",
      content: "Collision target.",
      saveMode: "create",
      revisionComment: "xmlrpc preflight collision proof"
    }),
    headers: xmlRpcWriteHeaders
  })
  expect(collisionResponse.status()).toBe(200)

  const renameFaultResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSaveOneRequest({
      page: slug,
      title: "Mutated title should not persist",
      content: "Mutated content should not persist.",
      tags: ["verification", "xmlrpc-mutated"],
      saveMode: "update",
      renameAs: collisionSlug,
      revisionComment: "xmlrpc preflight rename fault"
    }),
    headers: xmlRpcWriteHeaders
  })
  expect(renameFaultResponse.status()).toBe(200)
  const renameFaultBody = await renameFaultResponse.text()
  expect(renameFaultBody).toContain("<fault>")
  expect(renameFaultBody).toContain("target page already exists")

  const afterRenameFault = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesGetOneForPageRequest(slug),
    headers: xmlRpcHeaders
  })
  expect(afterRenameFault.status()).toBe(200)
  const afterRenameBody = await afterRenameFault.text()
  expect(afterRenameBody).toContain(
    "<name>content</name><value><string>Original preflight content.</string></value>"
  )
  expect(afterRenameBody).toContain("<value><string>xmlrpc-preflight</string></value>")
  expect(afterRenameBody).not.toContain("Mutated content should not persist")
  expect(afterRenameBody).not.toContain("<value><string>xmlrpc-mutated</string></value>")
  expect(afterRenameBody).toContain(
    "<name>parent_fullname</name><value><string>main</string></value>"
  )

  const parentFaultResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSaveOneRequest({
      page: slug,
      title: "Parent fault title should not persist",
      content: "Parent fault content should not persist.",
      tags: ["verification", "xmlrpc-parent-mutated"],
      parentFullname: `${slug}-missing-parent`,
      saveMode: "update",
      revisionComment: "xmlrpc preflight parent fault"
    }),
    headers: xmlRpcWriteHeaders
  })
  expect(parentFaultResponse.status()).toBe(200)
  const parentFaultBody = await parentFaultResponse.text()
  expect(parentFaultBody).toContain("<fault>")
  expect(parentFaultBody).toContain("parent page does not exist")

  const afterParentFault = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesGetOneForPageRequest(slug),
    headers: xmlRpcHeaders
  })
  expect(afterParentFault.status()).toBe(200)
  const afterParentBody = await afterParentFault.text()
  expect(afterParentBody).toContain(
    "<name>content</name><value><string>Original preflight content.</string></value>"
  )
  expect(afterParentBody).toContain("<value><string>xmlrpc-preflight</string></value>")
  expect(afterParentBody).not.toContain("Parent fault content should not persist")
  expect(afterParentBody).not.toContain(
    "<value><string>xmlrpc-parent-mutated</string></value>"
  )
  expect(afterParentBody).toContain(
    "<name>parent_fullname</name><value><string>main</string></value>"
  )
})

test("XML-RPC writes use the authenticated user for page and file attribution", async ({
  request
}) => {
  const stamp = Date.now()
  const fixtureUser = await createXmlRpcFixtureUser(stamp)
  const fixtureHeaders = xmlRpcBasicHeaders(
    `xmlrpc-fixture-user-${stamp}`,
    fixtureUser.password
  )
  const pageSlug = `fixture-xmlrpc-attribution-${stamp}`
  const fileName = "attribution.txt"
  const fileContent = Buffer.from("XML-RPC attributed file content.").toString("base64")

  const createResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSaveOneRequest({
      page: pageSlug,
      title: "XML-RPC Attribution Proof",
      content: "Created by fixture user.",
      tags: ["verification", "xmlrpc-attribution"],
      saveMode: "create",
      revisionComment: "xmlrpc attribution create proof"
    }),
    headers: fixtureHeaders
  })
  expect(createResponse.status()).toBe(200)

  const updateResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSaveOneRequest({
      page: pageSlug,
      title: "XML-RPC Attribution Proof Updated",
      content: "Updated by administrator.",
      tags: ["verification", "xmlrpc-attribution-updated"],
      saveMode: "update",
      revisionComment: "xmlrpc attribution update proof"
    }),
    headers: xmlRpcWriteHeaders
  })
  expect(updateResponse.status()).toBe(200)

  const pageOneResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesGetOneForPageRequest(pageSlug),
    headers: xmlRpcHeaders
  })
  expect(pageOneResponse.status()).toBe(200)
  const pageOneBody = await pageOneResponse.text()
  expect(pageOneBody).toContain(
    `<name>created_by</name><value><string>xmlrpc-fixture-user-${stamp}</string></value>`
  )
  expect(pageOneBody).toContain(
    "<name>updated_by</name><value><string>administrator</string></value>"
  )

  const pageMetaResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesGetMetaForPagesRequest([pageSlug]),
    headers: xmlRpcHeaders
  })
  expect(pageMetaResponse.status()).toBe(200)
  const pageMetaBody = await pageMetaResponse.text()
  expect(pageMetaBody).toContain(
    `<name>created_by</name><value><string>xmlrpc-fixture-user-${stamp}</string></value>`
  )
  expect(pageMetaBody).toContain(
    "<name>updated_by</name><value><string>administrator</string></value>"
  )

  const fileSaveResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcFilesSaveOneRequest({
      page: pageSlug,
      file: fileName,
      content: fileContent,
      comment: "attribution file proof",
      saveMode: "create",
      revisionComment: "xmlrpc attribution file proof"
    }),
    headers: fixtureHeaders
  })
  expect(fileSaveResponse.status()).toBe(200)
  const fileSaveBody = await fileSaveResponse.text()
  expect(fileSaveBody).toContain(
    `<name>uploaded_by</name><value><string>xmlrpc-fixture-user-${stamp}</string></value>`
  )
})

test("XML-RPC endpoint returns user identity and page comments", async ({ request }) => {
  const meResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcUsersGetMeRequest,
    headers: xmlRpcWriteHeaders
  })
  expect(meResponse.status()).toBe(200)
  const meBody = await meResponse.text()
  expect(meBody).toContain("<name>name</name><value><string>administrator</string>")
  expect(meBody).toContain("<name>title</name><value><string>Administrator</string>")
  expect(meBody).toContain("<name>id</name><value><int>-1</int></value>")

  const pageSlug = `fixture-xmlrpc-post-${Date.now()}`
  const postTitle = "XML-RPC comment proof"
  const postContent = "XML-RPC page comment proof body."
  const pageResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSaveOneRequest({
      page: pageSlug,
      title: "XML-RPC Post Proof",
      content: "Page for XML-RPC post proof.",
      tags: ["verification", "xmlrpc-post"],
      saveMode: "create",
      revisionComment: "xmlrpc post page create proof"
    }),
    headers: xmlRpcWriteHeaders
  })
  expect(pageResponse.status()).toBe(200)
  const postId = await seedForumCommentFixture({
    page: pageSlug,
    title: postTitle,
    content: postContent
  })

  const pageOneResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesGetOneForPageRequest(pageSlug),
    headers: xmlRpcHeaders
  })
  expect(pageOneResponse.status()).toBe(200)
  const pageOneBody = await pageOneResponse.text()
  expect(pageOneBody).toContain("<name>comments</name><value><int>1</int></value>")
  expect(pageOneBody).toContain(
    "<name>commented_by</name><value><string>administrator</string></value>"
  )

  const selectResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPostsSelectRequest(pageSlug),
    headers: xmlRpcHeaders
  })
  expect(selectResponse.status()).toBe(200)
  expect(await selectResponse.text()).toContain(`<value><int>${postId}</int></value>`)

  const topLevelResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPostsSelectRequest(pageSlug, "-"),
    headers: xmlRpcHeaders
  })
  expect(topLevelResponse.status()).toBe(200)
  expect(await topLevelResponse.text()).toContain(`<value><int>${postId}</int></value>`)

  const postsGetResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPostsGetRequest([postId]),
    headers: xmlRpcHeaders
  })
  expect(postsGetResponse.status()).toBe(200)
  const postsGetBody = await postsGetResponse.text()
  expect(postsGetBody).toContain(`<name>${postId}</name>`)
  expect(postsGetBody).toContain(`<name>id</name><value><int>${postId}</int></value>`)
  expect(postsGetBody).toContain(
    `<name>fullname</name><value><string>${pageSlug}</string></value>`
  )
  expect(postsGetBody).toContain("<name>reply_to</name><value><nil /></value>")
  expect(postsGetBody).toContain(
    `<name>title</name><value><string>${postTitle}</string></value>`
  )
  expect(postsGetBody).toContain(
    `<name>content</name><value><string>${postContent}</string></value>`
  )
  expect(postsGetBody).toContain(
    "<name>created_by</name><value><string>administrator</string></value>"
  )
  expect(postsGetBody).toContain("<name>created_at</name><value><string>")
})

test("XML-RPC read methods use the documented public-read policy", async ({
  request
}) => {
  const pageSlug = `fixture-xmlrpc-public-read-${Date.now()}`
  const fileName = "public-read.txt"
  const fileText = "XML-RPC public read file content."
  const fileContent = Buffer.from(fileText).toString("base64")
  const publicReadHeaders = xmlRpcBasicHeaders("syntactically-valid", "wrong-secret")

  const pageResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSaveOneRequest({
      page: pageSlug,
      title: "XML-RPC Public Read Proof",
      content: "Public read page body.",
      tags: ["verification", "xmlrpc-public-read"],
      saveMode: "create",
      revisionComment: "xmlrpc public read page create proof"
    }),
    headers: xmlRpcWriteHeaders
  })
  expect(pageResponse.status()).toBe(200)

  const fileResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcFilesSaveOneRequest({
      page: pageSlug,
      file: fileName,
      content: fileContent,
      comment: "public read file proof",
      saveMode: "create",
      revisionComment: "xmlrpc public read file proof"
    }),
    headers: xmlRpcWriteHeaders
  })
  expect(fileResponse.status()).toBe(200)

  const postId = await seedForumCommentFixture({
    page: pageSlug,
    title: "XML-RPC public read comment",
    content: "Public read comment body."
  })

  const pageReadResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesGetOneForPageRequest(pageSlug),
    headers: publicReadHeaders
  })
  expect(pageReadResponse.status()).toBe(200)
  expect(await pageReadResponse.text()).toContain(
    "<name>content</name><value><string>Public read page body.</string></value>"
  )

  const fileReadResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcFilesGetOneRequest(pageSlug, fileName),
    headers: publicReadHeaders
  })
  expect(fileReadResponse.status()).toBe(200)
  expect(await fileReadResponse.text()).toContain(
    `<name>content</name><value><string>${fileContent}</string>`
  )

  const postReadResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPostsGetRequest([postId]),
    headers: publicReadHeaders
  })
  expect(postReadResponse.status()).toBe(200)
  expect(await postReadResponse.text()).toContain(
    "<name>content</name><value><string>Public read comment body.</string></value>"
  )
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
    "<name>comment</name><value><string>initial file proof</string></value>"
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
    "<name>comment</name><value><string>initial file proof</string></value>"
  )
  expect(metaBody).toContain(
    `<name>download_url</name><value><string>/local--files/${pageSlug}/proof.txt</string></value>`
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
    "<name>comment</name><value><string>updated file proof</string></value>"
  )

  const invalidUpdateResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcFilesSaveOneRequest({
      page: pageSlug,
      file: fileName,
      content: "not base64!!",
      comment: "invalid file proof",
      saveMode: "update",
      revisionComment: "xmlrpc invalid file update proof"
    }),
    headers: xmlRpcWriteHeaders
  })
  expect(invalidUpdateResponse.status()).toBe(200)
  const invalidUpdateBody = await invalidUpdateResponse.text()
  expect(invalidUpdateBody).toContain("<fault>")
  expect(invalidUpdateBody).toContain("Expected valid base64 field: content")

  const updatedOneResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcFilesGetOneRequest(pageSlug, fileName),
    headers: xmlRpcHeaders
  })
  expect(updatedOneResponse.status()).toBe(200)
  const updatedOneBody = await updatedOneResponse.text()
  expect(updatedOneBody).toContain(
    `<name>content</name><value><string>${updatedContent}</string>`
  )
  expect(updatedOneBody).toContain(
    `<name>download_url</name><value><string>/local--files/${pageSlug}/proof.txt</string></value>`
  )
  expect(updatedOneBody).not.toContain(initialContent)
  expect(updatedOneBody).not.toContain("invalid file proof")

  expect(Buffer.from(updatedContent, "base64").toString("utf8")).toBe(updatedText)
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

test("XML-RPC endpoint rejects invalid credentials for identity and write calls", async ({
  request
}) => {
  const invalidHeaders = xmlRpcBasicHeaders("administrator", "wrong-password")

  const identityResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcUsersGetMeRequest,
    headers: invalidHeaders
  })
  expect(identityResponse.status()).toBe(401)
  expect(identityResponse.headers()["www-authenticate"]).toBe(
    'Basic realm="Wikijump XML-RPC"'
  )
  expect(await identityResponse.text()).toContain("Invalid HTTP Basic authentication")

  const writeResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSaveOneRequest({
      page: `fixture-invalid-auth-${Date.now()}`,
      content: "This should not be written.",
      saveMode: "create"
    }),
    headers: invalidHeaders
  })
  expect(writeResponse.status()).toBe(401)
  expect(await writeResponse.text()).toContain("Invalid HTTP Basic authentication")
})

test("XML-RPC endpoint rejects MFA-required Basic sessions", async ({ request }) => {
  const stamp = Date.now()
  const fixtureUser = await createXmlRpcFixtureUser(stamp)
  await enableMfaForFixtureUser(fixtureUser.user_id)
  const mfaHeaders = xmlRpcBasicHeaders(
    `xmlrpc-fixture-user-${stamp}`,
    fixtureUser.password
  )

  const identityResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcUsersGetMeRequest,
    headers: mfaHeaders
  })
  expect(identityResponse.status()).toBe(401)
  expect(identityResponse.headers()["www-authenticate"]).toBe(
    'Basic realm="Wikijump XML-RPC"'
  )
  expect(await identityResponse.text()).toContain(
    "XML-RPC Basic authentication does not support MFA"
  )

  const writeResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcPagesSaveOneRequest({
      page: `fixture-mfa-auth-${stamp}`,
      content: "MFA-required users should not write through Basic auth.",
      saveMode: "create"
    }),
    headers: mfaHeaders
  })
  expect(writeResponse.status()).toBe(401)
  expect(await writeResponse.text()).toContain(
    "XML-RPC Basic authentication does not support MFA"
  )
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

test("XML-RPC endpoint rejects malformed params and unexpected parameter counts", async ({
  request
}) => {
  const malformedResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcMalformedParamsRequest,
    headers: xmlRpcHeaders
  })
  expect(malformedResponse.status()).toBe(200)
  const malformedBody = await malformedResponse.text()
  expect(malformedBody).toContain("<fault>")
  expect(malformedBody).toContain("Unexpected content in XML-RPC &lt;params&gt;")

  const extraParamResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcListMethodsWithParamRequest,
    headers: xmlRpcHeaders
  })
  expect(extraParamResponse.status()).toBe(200)
  const extraParamBody = await extraParamResponse.text()
  expect(extraParamBody).toContain("<fault>")
  expect(extraParamBody).toContain("system.listMethods expects 0 parameters")
})

test("XML-RPC endpoint rejects unexpected envelope content", async ({ request }) => {
  const methodCallResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcUnexpectedMethodCallContentRequest,
    headers: xmlRpcHeaders
  })
  expect(methodCallResponse.status()).toBe(200)
  const methodCallBody = await methodCallResponse.text()
  expect(methodCallBody).toContain("<fault>")
  expect(methodCallBody).toContain("Unexpected content in XML-RPC &lt;methodCall&gt;")

  const paramResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcUnexpectedParamContentRequest,
    headers: xmlRpcHeaders
  })
  expect(paramResponse.status()).toBe(200)
  const paramBody = await paramResponse.text()
  expect(paramBody).toContain("<fault>")
  expect(paramBody).toContain("Unexpected content in XML-RPC &lt;param&gt;")

  const memberResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcUnexpectedMemberContentRequest,
    headers: xmlRpcHeaders
  })
  expect(memberResponse.status()).toBe(200)
  const memberBody = await memberResponse.text()
  expect(memberBody).toContain("<fault>")
  expect(memberBody).toContain("Unexpected content in XML-RPC &lt;member&gt;")
})

test("XML-RPC endpoint rejects oversized and deeply nested requests", async ({
  request
}) => {
  const oversizedResponse = await request.post("/xml-rpc-api.php", {
    data: `<?xml version="1.0"?><methodCall><methodName>system.methodHelp</methodName><params><param><value><string>${"x".repeat(
      1_000_001
    )}</string></value></param></params></methodCall>`,
    headers: xmlRpcHeaders
  })
  expect(oversizedResponse.status()).toBe(200)
  const oversizedBody = await oversizedResponse.text()
  expect(oversizedBody).toContain("<fault>")
  expect(oversizedBody).toContain("XML-RPC request body is too large")

  const deepResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcDeepArrayRequest(34),
    headers: xmlRpcHeaders
  })
  expect(deepResponse.status()).toBe(200)
  const deepBody = await deepResponse.text()
  expect(deepBody).toContain("<fault>")
  expect(deepBody).toContain("XML-RPC value nesting is too deep")
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
