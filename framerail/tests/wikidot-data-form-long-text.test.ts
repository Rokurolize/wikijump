import { strict as assert } from "node:assert"
import test from "node:test"

import {
  isWikidotDataFormLongTextField,
  serializeWikidotDataFormSource
} from "../src/lib/wikidot/wikidot-data-form.ts"

const parseSingleQuoted = (value: string): string | null => {
  const inner = value.slice(1, -1)
  let parsed = ""
  for (let index = 0; index < inner.length; index += 1) {
    if (inner[index] !== "'") {
      parsed += inner[index]
      continue
    }
    if (inner[index + 1] !== "'") return null
    parsed += "'"
    index += 1
  }
  return parsed
}

const parseDoubleQuoted = (value: string): string | null => {
  const inner = value.slice(1, -1)
  let parsed = ""
  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index]
    if (character !== "\\") {
      parsed += character
      continue
    }
    const escaped = inner[++index]
    if (escaped === "\\") parsed += "\\"
    else if (escaped === '"') parsed += '"'
    else if (escaped === "n") parsed += "\n"
    else if (escaped === "r") parsed += "\r"
    else if (escaped === "t") parsed += "\t"
    else return null
  }
  return parsed
}

const parseStoredWikiScalar = (value: string): string | null => {
  if (value.startsWith("'")) return parseSingleQuoted(value)
  if (value.startsWith('"')) {
    const parsed = parseDoubleQuoted(value)
    return parsed?.includes("\n") ? parsed : null
  }
  return value
}

test("only multi-line wiki fields qualify for the shared editor", () => {
  assert.equal(isWikidotDataFormLongTextField({ field_type: "wiki", height: 2 }), true)
  assert.equal(isWikidotDataFormLongTextField({ field_type: "wiki", height: 10 }), true)
  assert.equal(isWikidotDataFormLongTextField({ field_type: "wiki", height: 1 }), false)
  assert.equal(isWikidotDataFormLongTextField({ field_type: "wiki" }), false)
  assert.equal(isWikidotDataFormLongTextField({ field_type: "text", height: 8 }), false)
  assert.equal(isWikidotDataFormLongTextField({ field_type: "hidden", height: 2 }), false)
  assert.equal(isWikidotDataFormLongTextField({ field_type: "static", height: 2 }), false)
  assert.equal(
    isWikidotDataFormLongTextField({ field_type: "password", height: 2 }),
    false
  )
  assert.equal(isWikidotDataFormLongTextField({ field_type: "url", height: 2 }), false)
  assert.equal(isWikidotDataFormLongTextField({ field_type: "date", height: 2 }), false)
  assert.equal(
    isWikidotDataFormLongTextField({ field_type: "checkbox", height: 2 }),
    false
  )
  assert.equal(isWikidotDataFormLongTextField({ field_type: "select", height: 2 }), false)
  assert.equal(
    isWikidotDataFormLongTextField({ field_type: "pagepath", height: 2 }),
    false
  )
  assert.equal(isWikidotDataFormLongTextField({ field_type: "file", height: 2 }), false)
  assert.equal(isWikidotDataFormLongTextField({ field_type: null, height: 2 }), false)
})

test("adversarial long-text wiki content round-trips without touching its neighbours", () => {
  const definition = {
    fields: [
      {
        name: "body",
        label: "Body",
        hint: "",
        field_type: "wiki",
        values: [],
        default_value: null,
        height: 4
      },
      {
        name: "after",
        label: "After",
        hint: "",
        field_type: "text",
        values: [],
        default_value: null,
        height: 1
      },
      {
        name: "flag",
        label: "Flag",
        hint: "",
        field_type: "checkbox",
        values: [],
        default_value: null,
        height: 1
      },
      {
        name: "choice",
        label: "Choice",
        hint: "",
        field_type: "select",
        values: [{ value: "b", label: "Beta" }],
        default_value: null,
        height: 1
      }
    ]
  }
  const body =
    "intro: not a field boundary\n" +
    "quoted \"double\" and 'single' with \\ backslash\n" +
    "# hash and [[[start|Home]]] are literal here\n" +
    "[[div]]\n[[/div]]"
  const values = {
    body,
    after: "tail: # [x] O'Brien",
    flag: "1",
    choice: "b"
  }
  const source = serializeWikidotDataFormSource(definition, values)
  const expectedSource = [
    `body: "intro: not a field boundary\\nquoted \\"double\\" and 'single' with \\\\ backslash\\n# hash and [[[start|Home]]] are literal here\\n[[div]]\\n[[/div]]"`,
    `after: 'tail: # [x] O''Brien'`,
    "flag: '1'",
    "choice: b"
  ].join("\n")
  assert.equal(source, expectedSource)

  const lines = source.split("\n")
  assert.deepEqual(
    lines.map((line) => line.slice(0, line.indexOf(": "))),
    definition.fields.map((field) => field.name)
  )
  assert.equal(parseStoredWikiScalar(lines[0].slice("body: ".length)), body)
  assert.equal(lines[1], `after: 'tail: # [x] O''Brien'`)
  assert.equal(lines[2], "flag: '1'")
  assert.equal(lines[3], "choice: b")
  assert.deepEqual(
    Object.fromEntries(lines.map((line, index) => [definition.fields[index].name, line])),
    Object.fromEntries(
      expectedSource
        .split("\n")
        .map((line, index) => [definition.fields[index].name, line])
    )
  )
})
