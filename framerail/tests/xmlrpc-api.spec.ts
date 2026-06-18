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

const xmlRpcHeaders = {
  authorization: `Basic ${Buffer.from("test-app:test-key").toString("base64")}`,
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
  expect(tagsBody).toContain("<string>navigation</string>")
  expect(tagsBody).toContain("<string>verification</string>")

  const categoryTagsResponse = await request.post("/xml-rpc-api.php", {
    data: xmlRpcTagsSelectCategoryRequest,
    headers: xmlRpcHeaders
  })
  expect(categoryTagsResponse.status()).toBe(200)
  const categoryTagsBody = await categoryTagsResponse.text()
  expect(categoryTagsBody).toContain("<string>navigation</string>")
  expect(categoryTagsBody).toContain("<string>verification</string>")
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
