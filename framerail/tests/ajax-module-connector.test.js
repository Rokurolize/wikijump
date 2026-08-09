import assert from "node:assert/strict"
import test from "node:test"

import { handleAjaxModuleConnectorRequest } from "../src/lib/server/ajax-module-connector.js"

const request = (form, options = {}) =>
  new Request("http://scp-wiki.local/ajax-module-connector.php", {
    method: options.method ?? "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(options.headers ?? {})
    },
    body: options.method === "GET" ? undefined : new URLSearchParams(form)
  })

test("dispatches ListPages forms and returns the Wikidot JSON envelope", async () => {
  let received
  const response = await handleAjaxModuleConnectorRequest(
    request({
      moduleName: "list/ListPagesModule",
      module_body: '[[div class="page"]]%%fullname%%[[/div]]',
      wikidot_token7: "client-token",
      category: "_default",
      name: "scp-173",
      perPage: "250",
      separate: "no",
      wrapper: "no"
    }),
    {
      siteId: 6000006,
      renderListPages: async (input) => {
        received = input
        return { body: '<div class="page">scp-173</div>' }
      }
    }
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    status: "ok",
    body: '<div class="page">scp-173</div>'
  })
  assert.equal(response.headers.get("content-type"), "text/plain; charset=UTF-8")
  assert.deepEqual(received, {
    siteId: 6000006,
    moduleBody: '[[div class="page"]]%%fullname%%[[/div]]',
    parameters: {
      category: "_default",
      name: "scp-173",
      perPage: "250",
      separate: "no",
      wrapper: "no"
    }
  })
  assert.equal(response.headers.get("cache-control"), "no-store")
})

test("dispatches the sealed read-only forum modules with Wikidot metadata", async () => {
  const cases = [
    ["forum/ForumStartModule", { hidden: "true" }],
    ["forum/ForumViewCategoryModule", { c: "8503559", p: "1" }],
    ["forum/ForumViewThreadModule", { t: "18029831" }],
    ["forum/ForumViewThreadPostsModule", { t: "18029831", pageNo: "1" }],
    ["forum/ForumRecentPostsListModule", { page: "1", categoryId: "8503559" }]
  ]

  for (const [moduleName, parameters] of cases) {
    let received
    const response = await handleAjaxModuleConnectorRequest(
      request({
        moduleName,
        ...parameters,
        callbackIndex: "3",
        wikidot_token7: "client-token"
      }),
      {
        siteId: 6000006,
        renderListPages: async () => assert.fail("must not render ListPages"),
        renderForumModule: async (input) => {
          received = input
          return { status: "ok", body: `<div>${moduleName}</div>` }
        }
      }
    )

    const body = await response.json()
    assert.equal(body.status, "ok")
    assert.equal(body.body, `<div>${moduleName}</div>`)
    assert.equal(body.callbackIndex, "3")
    assert.equal(typeof body.CURRENT_TIMESTAMP, "number")
    assert.deepEqual(body.cssInclude, [])
    assert.deepEqual(body.jsInclude, [])
    assert.deepEqual(received, { siteId: 6000006, moduleName, parameters })
  }
})

test("passes read-only forum missing states through and rejects unsealed shapes", async () => {
  let calls = 0
  const missing = await handleAjaxModuleConnectorRequest(
    request({
      moduleName: "forum/ForumViewCategoryModule",
      c: "999999999",
      p: "1"
    }),
    {
      siteId: 6000006,
      renderListPages: async () => assert.fail("must not render ListPages"),
      renderForumModule: async () => {
        calls += 1
        return { status: "no_category", body: "" }
      }
    }
  )
  const missingBody = await missing.json()
  assert.equal(missingBody.status, "no_category")
  assert.equal(missingBody.body, "")
  assert.equal(missingBody.callbackIndex, null)
  assert.equal(typeof missingBody.CURRENT_TIMESTAMP, "number")
  assert.deepEqual(missingBody.cssInclude, [])
  assert.deepEqual(missingBody.jsInclude, [])

  for (const form of [
    { moduleName: "forum/ForumCommentsListModule", t: "18029831" },
    { moduleName: "forum/ForumNewThreadModule", c: "8503559" },
    { moduleName: "forum/ForumViewThreadModule", t: "18029831", write: "1" }
  ]) {
    const response = await handleAjaxModuleConnectorRequest(request(form), {
      siteId: 6000006,
      renderListPages: async () => assert.fail("must not render ListPages"),
      renderForumModule: async () => {
        calls += 1
        assert.fail("unsealed forum module shape must fail before Deepwell")
      }
    })
    assert.equal((await response.json()).status, "not_ok")
  }
  assert.equal(calls, 1)
})

test("fails closed for unsupported modules and duplicate fields", async () => {
  const unsupported = await handleAjaxModuleConnectorRequest(
    request({ moduleName: "forum/ForumStartModule", module_body: "" }),
    { siteId: 6000006, renderListPages: async () => assert.fail("must not render") }
  )
  assert.deepEqual(await unsupported.json(), {
    status: "not_ok",
    message: "Unsupported AJAX module: forum/ForumStartModule"
  })

  const duplicate = await handleAjaxModuleConnectorRequest(
    new Request("http://scp-wiki.local/ajax-module-connector.php", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "moduleName=list%2FListPagesModule&moduleName=list%2FListPagesModule&module_body=x"
    }),
    { siteId: 6000006, renderListPages: async () => assert.fail("must not render") }
  )
  assert.equal(duplicate.status, 400)
  assert.equal((await duplicate.json()).status, "not_ok")
})

test("rejects oversized bodies while streaming missing-length requests", async () => {
  let arrayBufferCalls = 0
  const response = await handleAjaxModuleConnectorRequest(
    {
      method: "POST",
      headers: new Headers({
        "content-type": "application/x-www-form-urlencoded"
      }),
      body: new Blob([
        "moduleName=list%2FListPagesModule&module_body=",
        "x".repeat(131_073)
      ]).stream(),
      arrayBuffer: async () => {
        arrayBufferCalls += 1
        throw new Error("must not buffer full request")
      }
    },
    { siteId: 6000006, renderListPages: async () => assert.fail("must not render") }
  )

  assert.equal(response.status, 413)
  assert.equal((await response.json()).status, "not_ok")
  assert.equal(arrayBufferCalls, 0)
})

test("converts Deepwell failures to a stable Wikidot error envelope", async () => {
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    const response = await handleAjaxModuleConnectorRequest(
      request({
        moduleName: "list/ListPagesModule",
        module_body: "%%fullname%%",
        name: "="
      }),
      {
        siteId: 6000006,
        renderListPages: async () => {
          throw new Error("current-page selectors are unsupported")
        }
      }
    )
    assert.deepEqual(await response.json(), {
      status: "not_ok",
      message: "Unable to render ListPages module"
    })
  } finally {
    console.error = originalConsoleError
  }
})

test("dispatches Wikidot page discussion creation and preserves its wire envelope", async () => {
  let received
  const response = await handleAjaxModuleConnectorRequest(
    request({
      action: "ForumAction",
      event: "createPageDiscussionThread",
      moduleName: "Empty",
      page_id: "1469071756",
      callbackIndex: "lane4-callback-success"
    }),
    {
      siteId: 6000006,
      renderListPages: async () => assert.fail("must not render"),
      createPageDiscussion: async (input) => {
        received = input
        return {
          thread_id: 18232631,
          thread_unix_title: "lane-4-discussion"
        }
      }
    }
  )

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(received, { siteId: 6000006, pageId: 1469071756 })
  assert.equal(body.status, "ok")
  assert.equal(body.thread_id, 18232631)
  assert.equal(body.thread_unix_title, "lane-4-discussion")
  assert.equal(body.callbackIndex, "lane4-callback-success")
  assert.equal(Number.isInteger(body.CURRENT_TIMESTAMP), true)
})

test("page discussion creation uses Wikidot no_page and stable failure boundaries", async () => {
  for (const pageId of ["", "-1", "1.5", "9007199254740993"]) {
    const response = await handleAjaxModuleConnectorRequest(
      request({
        action: "ForumAction",
        event: "createPageDiscussionThread",
        moduleName: "Empty",
        page_id: pageId,
        callbackIndex: `lane4-callback-${pageId}`
      }),
      {
        siteId: 6000006,
        renderListPages: async () => assert.fail("must not render"),
        createPageDiscussion: async () => assert.fail("must not create")
      }
    )
    const body = await response.json()
    assert.equal(body.status, "no_page")
    assert.equal(body.message, "The page does not exist")
    assert.equal(body.callbackIndex, `lane4-callback-${pageId}`)
    assert.equal(Number.isInteger(body.CURRENT_TIMESTAMP), true)
  }

  const missing = await handleAjaxModuleConnectorRequest(
    request({
      action: "ForumAction",
      event: "createPageDiscussionThread",
      moduleName: "Empty",
      page_id: "1469071758",
      callbackIndex: "lane4-callback-missing"
    }),
    {
      siteId: 6000006,
      renderListPages: async () => assert.fail("must not render"),
      createPageDiscussion: async () => null
    }
  )
  const missingBody = await missing.json()
  assert.equal(missingBody.status, "no_page")
  assert.equal(missingBody.message, "The page does not exist")
  assert.equal(missingBody.callbackIndex, "lane4-callback-missing")
  assert.equal(Number.isInteger(missingBody.CURRENT_TIMESTAMP), true)

  const originalConsoleError = console.error
  console.error = () => {}
  try {
    const failed = await handleAjaxModuleConnectorRequest(
      request({
        action: "ForumAction",
        event: "createPageDiscussionThread",
        moduleName: "Empty",
        page_id: "1469071760",
        callbackIndex: "lane4-callback-failed"
      }),
      {
        siteId: 6000006,
        renderListPages: async () => assert.fail("must not render"),
        createPageDiscussion: async () => {
          throw new Error("backend unavailable")
        }
      }
    )
    const failedBody = await failed.json()
    assert.equal(failedBody.status, "not_ok")
    assert.equal(failedBody.message, "Unable to create page discussion")
    assert.equal(failedBody.callbackIndex, "lane4-callback-failed")
    assert.equal(Number.isInteger(failedBody.CURRENT_TIMESTAMP), true)
  } finally {
    console.error = originalConsoleError
  }
})

test("dispatches NewPage helper default action with Wikidot edit-routing fields", async () => {
  const pageName = `run-owned:${"x".repeat(51)}`
  const response = await handleAjaxModuleConnectorRequest(
    request({
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      pageName,
      tags: "alpha beta",
      parent: "main"
    }),
    { siteId: 6000006, renderListPages: async () => assert.fail("must not render") }
  )

  assert.deepEqual(await response.json(), {
    status: "ok",
    unixName: pageName.slice(0, 60),
    pageTitle: pageName,
    tags: "alpha beta",
    parentPage: "main"
  })
})

test("dispatches NewPage template and category action fields like Wikidot", async () => {
  const templated = await handleAjaxModuleConnectorRequest(
    request({
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      pageName: "run-owned:newpage-template-edit",
      mode: "edit",
      template: "1469068384",
      tags: "alpha beta",
      parent: "run-owned:newpage-parent"
    }),
    { siteId: 6000006, renderListPages: async () => assert.fail("must not render") }
  )

  assert.deepEqual(await templated.json(), {
    status: "ok",
    unixName: "run-owned:newpage-template-edit",
    pageTitle: "run-owned:newpage-template-edit",
    tags: "alpha beta",
    parentPage: "run-owned:newpage-parent",
    templateId: "1469068384"
  })

  const defaultCategory = await handleAjaxModuleConnectorRequest(
    request({
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      pageName: "newpage-default-category",
      categoryName: "_default"
    }),
    { siteId: 6000006, renderListPages: async () => assert.fail("must not render") }
  )

  assert.deepEqual(await defaultCategory.json(), {
    status: "ok",
    unixName: "newpage-default-category",
    pageTitle: "newpage-default-category",
    tags: "",
    parentPage: ""
  })
})

test("rejects NewPage helper requests when the target already exists", async () => {
  const calls = []
  const pageName = "run-owned:newpage-existing-target"
  for (const mode of [undefined, "edit", "save-and-go", "save-and-refresh"]) {
    const form = {
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      pageName
    }
    if (mode !== undefined) form.mode = mode

    const response = await handleAjaxModuleConnectorRequest(request(form), {
      siteId: 6000006,
      renderListPages: async () => assert.fail("must not render"),
      createNewPage: async (input) => calls.push(input),
      pageExists: async (slug) => slug === pageName
    })

    assert.deepEqual(await response.json(), {
      status: "page_exists",
      message:
        'The page <em>run-owned:newpage-existing-target</em> already exists. <a href="/run-owned:newpage-existing-target">Jump to it</a> if you wish.'
    })
  }
  assert.deepEqual(calls, [])
})

test("rejects NewPage helper requests without a page name like Wikidot", async () => {
  for (const form of [
    {
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty"
    },
    {
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      pageName: ""
    }
  ]) {
    const response = await handleAjaxModuleConnectorRequest(request(form), {
      siteId: 6000006,
      renderListPages: async () => assert.fail("must not render")
    })

    assert.deepEqual(await response.json(), {
      status: "no_name",
      message: "You should provide a page name"
    })
  }
})

test("allows NewPage edit routing without page creation permission", async () => {
  for (const mode of [undefined, "edit"]) {
    const form = {
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      pageName: "run-owned:newpage-anonymous-edit"
    }
    if (mode !== undefined) form.mode = mode

    const response = await handleAjaxModuleConnectorRequest(request(form), {
      siteId: 6000006,
      renderListPages: async () => assert.fail("must not render"),
      canCreateNewPage: false
    })

    const body = await response.json()
    assert.equal(body.status, "ok")
    assert.equal(body.unixName, "run-owned:newpage-anonymous-edit")
    assert.equal(body.pageTitle, "run-owned:newpage-anonymous-edit")
  }
})

test("rejects NewPage autosave without page creation permission", async () => {
  const calls = []
  for (const mode of ["save-and-go", "save-and-refresh"]) {
    const response = await handleAjaxModuleConnectorRequest(
      request({
        action: "misc/NewPageHelperAction",
        event: "createNewPage",
        moduleName: "Empty",
        pageName: "run-owned:newpage-anonymous-autosave",
        mode
      }),
      {
        siteId: 6000006,
        renderListPages: async () => assert.fail("must not render"),
        canCreateNewPage: false,
        createNewPage: async (input) => calls.push(input)
      }
    )

    assert.deepEqual(await response.json(), {
      status: "no_permission",
      message:
        'Sorry, you can not create a new page in this category. Only members of this site, site administrators and perhaps selected moderators are allowed to do it. <a href="#action:login">Sign in as Wikidot user</a>'
    })
  }
  assert.deepEqual(calls, [])
})

test("ignores malformed NewPage format strings but enforces valid patterns", async () => {
  const malformedFormats = ["//", "/^[a-z]+$", "/[/", "^[a-z]+$"]
  for (const format of malformedFormats) {
    const response = await handleAjaxModuleConnectorRequest(
      request({
        action: "misc/NewPageHelperAction",
        event: "createNewPage",
        moduleName: "Empty",
        pageName: "run-owned:newpage-format-probe",
        format
      }),
      { siteId: 6000006, renderListPages: async () => assert.fail("must not render") }
    )

    assert.equal((await response.json()).status, "ok")
  }

  const rejected = await handleAjaxModuleConnectorRequest(
    request({
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      pageName: "run-owned:newpage-format-probe",
      format: "/^[0-9]+$/"
    }),
    { siteId: 6000006, renderListPages: async () => assert.fail("must not render") }
  )

  assert.deepEqual(await rejected.json(), {
    status: "incorrect_name",
    message: "The page name is not correct: please fix it and try again"
  })
})

test("rejects catastrophic NewPage format patterns without running them", async () => {
  const response = await handleAjaxModuleConnectorRequest(
    request({
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      pageName: `${"a".repeat(30)}!`,
      format: "/^(a+)+$/"
    }),
    { siteId: 6000006, renderListPages: async () => assert.fail("must not render") }
  )

  assert.deepEqual(await response.json(), {
    status: "incorrect_name",
    message: "The page name is not correct: please fix it and try again"
  })
})

test("NewPage template autosave creates an empty page and ignores parent", async () => {
  const calls = []
  const response = await handleAjaxModuleConnectorRequest(
    request({
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      pageName: "run-owned:newpage-template-autosave",
      mode: "save-and-go",
      template: "1469068213",
      parent: "main"
    }),
    {
      siteId: 6000006,
      renderListPages: async () => assert.fail("must not render"),
      createNewPage: async (input) => calls.push(input)
    }
  )

  assert.deepEqual(await response.json(), {
    status: "ok",
    goToUrl: "run-owned:newpage-template-autosave"
  })
  assert.deepEqual(calls, [
    {
      slug: "run-owned:newpage-template-autosave",
      title: "run-owned:newpage-template-autosave",
      wikitext: "",
      tags: [],
      parentPage: ""
    }
  ])
})

test("rejects NewPage template autosave when tags are submitted", async () => {
  const calls = []
  const response = await handleAjaxModuleConnectorRequest(
    request({
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      pageName: "run-owned:newpage-template-tags-autosave",
      mode: "save-and-refresh",
      template: "1469068213",
      tags: "alpha beta"
    }),
    {
      siteId: 6000006,
      renderListPages: async () => assert.fail("must not render"),
      createNewPage: async (input) => calls.push(input)
    }
  )

  assert.deepEqual(await response.json(), {
    status: "not_ok",
    message: "An error occurred while processing the request."
  })
  assert.deepEqual(calls, [])
})

test("dispatches NewPage autosave modes through the injected create callback", async () => {
  const calls = []
  const response = await handleAjaxModuleConnectorRequest(
    request({
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      pageName: "run-owned:newpage-autosave",
      mode: "save-and-go",
      tags: "alpha beta",
      parent: "main"
    }),
    {
      siteId: 6000006,
      renderListPages: async () => assert.fail("must not render"),
      createNewPage: async (input) => calls.push(input)
    }
  )

  assert.deepEqual(await response.json(), {
    status: "ok",
    goToUrl: "run-owned:newpage-autosave"
  })
  assert.deepEqual(calls, [
    {
      slug: "run-owned:newpage-autosave",
      title: "run-owned:newpage-autosave",
      wikitext: "",
      tags: ["alpha", "beta"],
      parentPage: "main"
    }
  ])
})
