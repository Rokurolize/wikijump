// @ts-nocheck
import { strict as assert } from "node:assert"
import test from "node:test"

import {
  performWikidotLegacyAction,
  planWikidotStandaloneActionBindings
} from "../src/lib/wikidot/wikidot-legacy-actions.js"

const actionElement = () => {
  const attributes = new Map()
  return {
    getAttribute(name) {
      return attributes.get(name) ?? null
    },
    removeAttribute(name) {
      attributes.delete(name)
    },
    setAttribute(name, value) {
      attributes.set(name, value)
    }
  }
}

test("typed standalone actions call only their fixed browser behavior", async () => {
  const calls = []
  const runtime = {
    edit: () => calls.push(["edit"]),
    history: () => calls.push(["history"]),
    source: () => calls.push(["source"]),
    print: () => calls.push(["print"]),
    setTags: (index, fingerprint) => calls.push(["set-tags", index, fingerprint])
  }

  for (const type of ["edit", "history", "source", "print"]) {
    await performWikidotLegacyAction(actionElement(), { type }, runtime)
  }
  await performWikidotLegacyAction(
    actionElement(),
    {
      type: "set-tags",
      index: 7,
      fingerprint: "0123456789abcdef0123456789abcdef"
    },
    runtime
  )

  assert.deepEqual(calls, [
    ["edit"],
    ["history"],
    ["source"],
    ["print"],
    ["set-tags", 7, "0123456789abcdef0123456789abcdef"]
  ])
})

test("Rate actions pass only registry-owned vote values", async () => {
  const calls = []
  const runtime = {
    rate: (value) => calls.push(["rate", value]),
    cancelRate: () => calls.push(["cancel-rate"])
  }
  const element = actionElement()

  for (const action of [
    { type: "rate", value: 1 },
    { type: "rate", value: -1 },
    { type: "rate", value: 4 },
    { type: "rate-cancel" }
  ]) {
    await performWikidotLegacyAction(element, action, runtime)
  }

  assert.deepEqual(calls, [["rate", 1], ["rate", -1], ["rate", 4], ["cancel-rate"]])
})

test("unsupported sidecar actions fail closed without calling authored names", async () => {
  let called = false
  const handled = await performWikidotLegacyAction(
    actionElement(),
    { type: "author-script", onclick: "alert(1)" },
    {
      authorScript: () => {
        called = true
      }
    }
  )

  assert.equal(handled, false)
  assert.equal(called, false)
})

test("an action stays busy until its observable operation settles", async () => {
  let release
  let calls = 0
  const operation = new Promise((resolve) => {
    release = resolve
  })
  const element = actionElement()
  const runtime = {
    edit: async () => {
      calls += 1
      await operation
    }
  }

  const first = performWikidotLegacyAction(element, { type: "edit" }, runtime)
  const repeated = await performWikidotLegacyAction(element, { type: "edit" }, runtime)
  assert.equal(repeated, false)
  assert.equal(calls, 1)
  assert.equal(element.getAttribute("aria-busy"), "true")

  release()
  assert.equal(await first, true)
  assert.equal(element.getAttribute("aria-busy"), null)
})

test("sidecar binding preserves exact DOM and fails closed on a count mismatch", () => {
  const exactDomControls = [actionElement(), actionElement()]
  const actions = [
    { type: "edit" },
    {
      type: "set-tags",
      index: 1,
      fingerprint: "0123456789abcdef0123456789abcdef"
    }
  ]

  assert.deepEqual(planWikidotStandaloneActionBindings(exactDomControls, actions), [
    [exactDomControls[0], actions[0]],
    [exactDomControls[1], actions[1]]
  ])
  assert.deepEqual(
    planWikidotStandaloneActionBindings([...exactDomControls, actionElement()], actions),
    []
  )
  assert.deepEqual(
    planWikidotStandaloneActionBindings(exactDomControls, [
      actions[0],
      { type: "author-script", onclick: "alert(1)" }
    ]),
    []
  )
  assert.deepEqual(
    planWikidotStandaloneActionBindings(exactDomControls, [
      actions[0],
      { type: "set-tags", index: 1, fingerprint: "forged" }
    ]),
    []
  )
  for (const control of exactDomControls) {
    assert.equal(control.getAttribute("data-wikijump-legacy-action"), null)
    assert.equal(control.getAttribute("onclick"), null)
  }
})
