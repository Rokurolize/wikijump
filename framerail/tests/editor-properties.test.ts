import assert from "node:assert/strict"
import test from "node:test"

import {
  classifyPropertyActionError,
  diffParents,
  firstPropertyError,
  hasPropertyErrors,
  parentReportMessage,
  splitSpaceSeparated,
  validateParentValue,
  validateProperties,
  validateTagsValue
} from "../src/lib/wikidot/editor-properties.ts"

test("space-separated property lists keep exact tokens", () => {
  assert.deepEqual(splitSpaceSeparated(" alpha\tbeta\n gamma "), [
    "alpha",
    "beta",
    "gamma"
  ])
  assert.deepEqual(splitSpaceSeparated("   "), [])
})

test("parent diff produces the add and remove sets of a page-tree move", () => {
  assert.deepEqual(diffParents(["old", "shared"], ["shared", "new"]), {
    add: ["new"],
    remove: ["old"]
  })
  assert.deepEqual(diffParents([], []), { add: [], remove: [] })
})

test("parent validation rejects malformed and self-referential parents", () => {
  assert.equal(validateParentValue("scp-173-parent", "child"), null)
  assert.equal(validateParentValue("component:editor-probe", "child"), null)
  assert.equal(validateParentValue("", "child"), null)
  assert.match(validateParentValue("Bad Name", "child") ?? "", /not a valid page name/u)
  assert.match(validateParentValue("a::b", "child") ?? "", /not a valid page name/u)
  assert.match(validateParentValue("child", "child") ?? "", /cannot be its own parent/u)
  assert.match(
    validateParentValue(Array.from({ length: 65 }, () => "p").join(" "), "child") ?? "",
    /at most 64/u
  )
})

test("tag validation explains how to fix comma and bracket inputs", () => {
  assert.equal(validateTagsValue("alpha beta _hidden"), null)
  assert.match(validateTagsValue("alpha,beta") ?? "", /Remove the comma/u)
  assert.match(validateTagsValue("[alpha]") ?? "", /Remove square brackets/u)
})

test("property validation respects the parent loading state", () => {
  const errors = validateProperties({
    tags: "good, bad",
    parent: "bad parent",
    selfSlug: "child",
    parentReady: false
  })
  assert.equal(errors.parent, null)
  assert.equal(hasPropertyErrors(errors), true)
  assert.equal(
    firstPropertyError(
      validateProperties({ tags: "", parent: "self", selfSlug: "self" })
    ),
    "A page cannot be its own parent. Choose another page or clear the field."
  )
})

test("property action errors map to actionable panel messages", () => {
  assert.match(
    classifyPropertyActionError({ code: 1308 }, "parent"),
    /would create a cycle/u
  )
  assert.match(classifyPropertyActionError({ code: 2007 }, "parent"), /does not exist/u)
  assert.match(classifyPropertyActionError({ status: 403 }, "parent"), /permission/u)
  assert.match(
    classifyPropertyActionError({ code: 4000 }, "tags"),
    /space-separated tags/u
  )
  assert.ok(!classifyPropertyActionError({ code: 2007 }, "parent").includes("raw"))
})

test("partial-failure report names what was saved and what to retry", () => {
  assert.match(parentReportMessage(true, "Check the parent."), /were saved/u)
  assert.match(parentReportMessage(true, "Check the parent."), /Retry page-tree move/u)
  assert.match(parentReportMessage(false, "Check the parent."), /Nothing was saved/u)
})
