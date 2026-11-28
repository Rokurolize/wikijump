import assert from "node:assert/strict"
import test from "node:test"

import {
  applyToolbarOperation,
  toolbarOperations,
  type ToolbarOperationId,
  type ToolbarOperationOptions
} from "../src/lib/wikidot/wikitext-editor-toolbar.ts"

const apply = (
  text: string,
  from: number,
  to: number,
  operation: ToolbarOperationId,
  options: ToolbarOperationOptions = {}
) => {
  const result = applyToolbarOperation({ text, from, to }, operation, options)
  if (result === null) throw new Error("expected a toolbar transformation")
  return result
}

test("toolbar operation definitions expose accessible names and documented shortcuts", () => {
  assert.deepEqual(
    toolbarOperations.map(({ id }) => id),
    [
      "heading1",
      "heading2",
      "heading3",
      "heading4",
      "heading5",
      "heading6",
      "bold",
      "italic",
      "strike",
      "teletype",
      "quote",
      "bullet-list",
      "numbered-list",
      "horizontal-rule",
      "raw",
      "link",
      "image",
      "table",
      "code",
      "footnote",
      "math",
      "inline-math"
    ]
  )
  assert.equal(new Set(toolbarOperations.map(({ id }) => id)).size, 22)
  for (const operation of toolbarOperations) {
    assert.notEqual(operation.label, "")
    assert.notEqual(operation.accessibleLabel, "")
    if (operation.shortcut) {
      assert.notEqual(operation.shortcut.key, "")
      assert.notEqual(operation.shortcut.display, "")
      assert.notEqual(operation.shortcut.aria, "")
    }
  }
  assert.equal(toolbarOperations.find(({ id }) => id === "bold")?.shortcut?.key, "Mod-b")
  assert.equal(
    toolbarOperations.find(({ id }) => id === "italic")?.shortcut?.key,
    "Mod-i"
  )
  assert.equal(toolbarOperations.find(({ id }) => id === "link")?.shortcut?.key, "Mod-k")
})

test("inline wrappers insert at an empty cursor and keep the cursor inside", () => {
  assert.deepEqual(apply("", 0, 0, "bold"), {
    text: "****",
    from: 2,
    to: 2
  })
  assert.deepEqual(apply("", 0, 0, "teletype"), {
    text: "{{}}",
    from: 2,
    to: 2
  })
  assert.deepEqual(apply("", 0, 0, "inline-math"), {
    text: "[[$  $]]",
    from: 4,
    to: 4
  })
})

test("inline wrappers wrap plain selections including multiline selections", () => {
  assert.deepEqual(apply("say abc now", 4, 7, "bold"), {
    text: "say **abc** now",
    from: 6,
    to: 9
  })
  assert.deepEqual(apply("one\ntwo", 0, 7, "italic"), {
    text: "//one\ntwo//",
    from: 2,
    to: 9
  })
  assert.deepEqual(apply(" áβ中 🚀 ", 1, 7, "strike"), {
    text: " --áβ中 🚀-- ",
    from: 3,
    to: 9
  })
})

test("inline wrappers unwrap selections inside or around existing markup", () => {
  for (const [operation, wrapped, plain] of [
    ["bold", "**abc**", "abc"],
    ["italic", "//abc//", "abc"],
    ["strike", "--abc--", "abc"],
    ["teletype", "{{abc}}", "abc"],
    ["raw", "@@**abc**@@", "**abc**"],
    ["footnote", "[[footnote]]abc[[/footnote]]", "abc"],
    ["inline-math", "[[$ abc $]]", "abc"]
  ] as const) {
    const openLength = wrapped.indexOf(plain)
    const innerFrom = openLength
    const innerTo = openLength + plain.length
    assert.deepEqual(apply(wrapped, innerFrom, innerTo, operation), {
      text: plain,
      from: 0,
      to: plain.length
    })
    assert.deepEqual(apply(wrapped, 0, wrapped.length, operation), {
      text: plain,
      from: 0,
      to: plain.length
    })
  }
})

test("headings insert, replace, and unwrap line markup", () => {
  assert.deepEqual(apply("Title", 0, 0, "heading1"), {
    text: "+ Title",
    from: 7,
    to: 7
  })
  assert.deepEqual(apply("++ Title", 0, 8, "heading1"), {
    text: "+ Title",
    from: 0,
    to: 7
  })
  assert.deepEqual(apply("++ Title", 0, 8, "heading2"), {
    text: "Title",
    from: 0,
    to: 5
  })
  assert.deepEqual(apply("+++ Title", 0, 9, "heading2"), {
    text: "++ Title",
    from: 0,
    to: 8
  })
  assert.deepEqual(apply("alpha\n\nbeta", 0, 11, "heading3"), {
    text: "+++ alpha\n\n+++ beta",
    from: 0,
    to: 19
  })
})

test("quote and list operations prefix multiline selections and unwrap existing prefixes", () => {
  for (const [operation, prefix] of [
    ["quote", "> "],
    ["bullet-list", "* "],
    ["numbered-list", "# "]
  ] as const) {
    const selected = "alpha\nbeta"
    const wrapped = `${prefix}alpha\n${prefix}beta`
    assert.deepEqual(apply(selected, 0, selected.length, operation), {
      text: wrapped,
      from: 0,
      to: wrapped.length
    })
    assert.deepEqual(apply(wrapped, 0, wrapped.length, operation), {
      text: selected,
      from: 0,
      to: selected.length
    })
  }
  assert.deepEqual(apply("", 0, 0, "quote"), {
    text: "> ",
    from: 2,
    to: 2
  })
})

test("horizontal rule insertion is line bounded at cursor boundaries", () => {
  assert.deepEqual(apply("", 0, 0, "horizontal-rule"), {
    text: "----",
    from: 4,
    to: 4
  })
  assert.deepEqual(apply("abcdef", 3, 3, "horizontal-rule"), {
    text: "abc\n----\ndef",
    from: 8,
    to: 8
  })
  assert.deepEqual(apply("abc\n", 4, 4, "horizontal-rule"), {
    text: "abc\n----",
    from: 8,
    to: 8
  })
})

test("table insertion uses a simple Wikidot table skeleton", () => {
  const skeleton = "||~ Heading 1 ||~ Heading 2 ||\n|| Cell 1 || Cell 2 ||"
  const result = apply("", 0, 0, "table")
  assert.equal(result.text, skeleton)
  assert.equal(skeleton.slice(result.from, result.to), "Heading 1")
})

test("code and math blocks wrap selections and unwrap existing blocks", () => {
  for (const [operation, open, close] of [
    ["code", "[[code]]", "[[/code]]"],
    ["math", "[[math]]", "[[/math]]"]
  ] as const) {
    const selected = "line one\nline two"
    const wrapped = `${open}\n${selected}\n${close}`
    assert.deepEqual(apply(selected, 0, selected.length, operation), {
      text: wrapped,
      from: open.length + 1,
      to: open.length + 1 + selected.length
    })
    assert.deepEqual(apply(wrapped, 0, wrapped.length, operation), {
      text: selected,
      from: 0,
      to: selected.length
    })
    assert.deepEqual(
      apply(wrapped, open.length + 1, open.length + 1 + selected.length, operation),
      {
        text: selected,
        from: 0,
        to: selected.length
      }
    )
  }
  assert.deepEqual(apply("", 0, 0, "code"), {
    text: "[[code]]\n\n[[/code]]",
    from: 9,
    to: 9
  })
})

test("link insertion uses the target and preserves a nonempty selection as its label", () => {
  assert.deepEqual(
    apply("click here", 0, 10, "link", { linkTarget: "https://example.test" }),
    {
      text: "[[[https://example.test|click here]]]",
      from: 37,
      to: 37
    }
  )
  assert.deepEqual(apply("", 0, 0, "link", { linkTarget: "target-page" }), {
    text: "[[[target-page]]]",
    from: 17,
    to: 17
  })
  assert.equal(
    applyToolbarOperation({ text: "", from: 0, to: 0 }, "link", { linkTarget: "  " }),
    null
  )
})

test("image insertion uses the prompted source and replaces any selection", () => {
  assert.deepEqual(apply("old text", 0, 8, "image", { imageSource: "image.png" }), {
    text: "[[image image.png]]",
    from: 19,
    to: 19
  })
  assert.equal(
    applyToolbarOperation({ text: "", from: 0, to: 0 }, "image", { imageSource: "" }),
    null
  )
})
