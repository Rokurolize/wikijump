import { strict as assert } from "node:assert"
import test from "node:test"

import {
  buildWikidotDataFormState,
  serializeWikidotDataFormSource
} from "../src/lib/wikidot/wikidot-data-form.js"

const definition = {
  default_layout: true,
  fields: [
    {
      name: "name",
      label: "Name",
      hint: "",
      field_type: "text",
      values: [],
      default_value: null
    },
    {
      name: "choice",
      label: "Choice",
      hint: "",
      field_type: "select",
      values: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" }
      ],
      default_value: "b"
    }
  ]
}

test("initial data-form state follows template order and applies select defaults", () => {
  assert.deepEqual(buildWikidotDataFormState(definition, {}), {
    name: "",
    choice: "b"
  })
})

test("saved data-form source overrides defaults and round-trips through Wikidot source", () => {
  const state = buildWikidotDataFormState(definition, {
    name: "Probe Name",
    choice: "a"
  })
  assert.deepEqual(state, {
    name: "Probe Name",
    choice: "a"
  })
  assert.equal(
    serializeWikidotDataFormSource(definition, state),
    "name: 'Probe Name'\nchoice: a"
  )
})

test("prototype-sensitive field names use only backend-provided own values", () => {
  const prototypeDefinition = {
    default_layout: true,
    fields: ["constructor", "toString", "__proto__"].map((name) => ({
      name,
      label: name,
      hint: "",
      field_type: "text",
      values: [],
      default_value: null
    }))
  }
  const state = buildWikidotDataFormState(prototypeDefinition, {})

  assert.equal(state["constructor"], "")
  assert.equal(state["toString"], "")
  assert.equal(state["__proto__"], "")
  assert.equal(
    serializeWikidotDataFormSource(prototypeDefinition, state),
    "constructor: ''\ntoString: ''\n__proto__: ''"
  )
})
