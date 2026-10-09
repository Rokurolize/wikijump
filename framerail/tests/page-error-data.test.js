import assert from "node:assert/strict"
import test from "node:test"

import { isPageErrorData } from "../src/lib/page-error-data.ts"

test("generic SvelteKit HTTP errors do not enter wiki-page form rendering", () => {
  assert.equal(isPageErrorData({ status: 404, message: "Not Found" }), false)
  assert.equal(isPageErrorData({ status: 403, message: "Forbidden" }), false)
  assert.equal(isPageErrorData({ status: 400, message: "Bad Request" }), false)
})

test("page-specific errors require validated site, options, and form payloads", () => {
  const pageError = {
    view: "missing",
    forms: {
      pageEditForm: {
        data: {},
        errors: {},
        constraints: {},
        valid: true,
        posted: false
      },
      pageRestoreForm: {
        data: {},
        errors: {},
        constraints: {},
        valid: true,
        posted: false
      }
    },
    site: { site_id: 6000005, default_page: "main" },
    options: {
      edit: false,
      no_redirect: false,
      no_render: false,
      debug: false,
      renderer: false,
      comments: false,
      history: false,
      data: ""
    },
    compiled_body_html: "<p>missing page</p>",
    restore_available: false,
    page_templates: []
  }

  assert.equal(isPageErrorData(pageError), true)
  assert.equal(isPageErrorData({ ...pageError, forms: { pageEditForm: {} } }), false)
  assert.equal(isPageErrorData({ ...pageError, site: null }), false)
  assert.equal(isPageErrorData({ ...pageError, compiled_body_html: null }), false)
  assert.equal(isPageErrorData({ ...pageError, restore_available: undefined }), false)
  assert.equal(isPageErrorData({ ...pageError, restore_available: "yes" }), false)
})
