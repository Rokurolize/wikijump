import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import test from "node:test"

const casesUrl = new URL("../fixtures/frontforum-custom-body/cases.json", import.meta.url)
const artifactUrl = new URL("../artifacts/frontforum-custom-body-live-20260810.json", import.meta.url)
const scriptUrl = new URL("../scripts/capture-frontforum-custom-body.mjs", import.meta.url)
const sha256 = (value) => createHash("sha256").update(value).digest("hex")

test("FrontForum custom-body artifact seals the documented variable and owner boundaries", async () => {
  const fixtureBytes = await fs.readFile(casesUrl)
  const artifactBytes = await fs.readFile(artifactUrl)
  const scriptBytes = await fs.readFile(scriptUrl)
  const fixture = JSON.parse(fixtureBytes)
  const artifact = JSON.parse(artifactBytes)

  assert.equal(fixture.schema, "wikijump.frontforum_custom_body_cases.v1")
  assert.equal(artifact.schema, "wikijump.frontforum_custom_body_live_evidence.v1")
  assert.deepEqual(artifact.surface_ids, [
    "catalog-feature:module-frontforum",
    "Q1034_POPULATED_READ_MODEL_COVERAGE",
  ])
  assert.equal(artifact.public_interface, "anonymous edit/PagePreviewModule via Ajax Module Connector")
  assert.equal(artifact.provenance.actor, "anonymous")
  assert.equal(artifact.provenance.authenticated, false)
  assert.equal(artifact.provenance.mutated, false)
  assert.equal(artifact.provenance.site, "sandbox-for-codex")
  assert.equal(artifact.inputs.cases_sha256, sha256(fixtureBytes))
  assert.equal(artifact.provenance.capture_script_sha256, sha256(scriptBytes))

  const expectedIds = [
    "frontforum-custom-body-canonical",
    "frontforum-custom-body-alias-offset-multi",
    "frontforum-custom-body-unknown",
    "frontforum-custom-body-malformed-owner-control",
  ]
  assert.deepEqual(fixture.cases.map(({ case_id }) => case_id), expectedIds)
  assert.deepEqual(artifact.case_ids, expectedIds)
  assert.deepEqual(artifact.cases.map(({ case_id }) => case_id), expectedIds)
  assert.deepEqual(artifact.controls, { positive: 2, negative: 2 })
  assert.deepEqual(
    [...new Set(fixture.cases.flatMap(({ variables }) => variables))].sort(),
    [
      "author",
      "body",
      "category",
      "comments",
      "content",
      "date",
      "description",
      "link",
      "linked_title",
      "long",
      "short",
      "summary",
      "text",
      "title",
      "title_linked",
      "unknown",
    ],
  )

  const cases = new Map(artifact.cases.map((entry) => [entry.case_id, entry]))
  for (const fixtureCase of fixture.cases) {
    const captured = cases.get(fixtureCase.case_id)
    assert.ok(captured, fixtureCase.case_id)
    assert.equal(captured.source, fixtureCase.source)
    assert.equal(captured.source_sha256, sha256(fixtureCase.source))
    assert.equal(captured.request.method, "POST")
    assert.equal(captured.request.module_name, "edit/PagePreviewModule")
    assert.equal(captured.request.mode, "page")
    assert.equal(captured.response.http_status, 200)
    assert.equal(captured.response.status, "ok")
    assert.equal(captured.response.body_sha256, sha256(captured.response.body))
    assert.match(captured.response.unredacted_body_sha256, /^[0-9a-f]{64}$/u)
    assert.match(captured.response.raw_response_sha256, /^[0-9a-f]{64}$/u)
    assert.deepEqual(captured.response.js_include, [])
    assert.deepEqual(captured.response.css_include, [])
    assert.equal(captured.mutated, false)
  }

  const canonical = cases.get("frontforum-custom-body-canonical")
  assert.deepEqual(canonical.thread_ids, [18029831])
  assert.deepEqual(canonical.variable_results, {
    title: "populated",
    linked_title: "populated_link",
    author: "populated_printuser",
    date: "populated_odate",
    comments: "populated_link",
    category: "populated_link",
    description: "populated",
    content: "populated",
  })
  assert.match(canonical.response.body, /Codex smoke thread 20260617194313/u)
  assert.match(canonical.response.body, /Codex live smoke thread 20260617194313/u)
  assert.match(canonical.response.body, /Edited forum post for live smoke 20260617194313/u)
  assert.match(canonical.response.body, /Comments: 1/u)
  assert.match(canonical.response.body, /Community \/ Open Topic/u)
  assert.match(canonical.response.body, /\[REDACTED_SANDBOX_AUTHOR\]/u)

  const aliases = cases.get("frontforum-custom-body-alias-offset-multi")
  assert.deepEqual(aliases.thread_ids, [18295079])
  assert.deepEqual(aliases.selection, {
    category_ids: [8503561, 8503559],
    offset: 1,
    limit: 1,
  })
  assert.deepEqual(aliases.variable_results, {
    title_linked: "populated_link",
    link: "populated_url",
    short: "populated",
    summary: "populated",
    text: "populated",
    long: "populated",
    body: "populated",
  })
  assert.deepEqual(aliases.selection_result, {
    observed_thread_ids: [18295079],
    requested_offset: 1,
    requested_category_ids: [8503561, 8503559],
    observation: "one populated alias item rendered after combined-category offset selection",
  })
  assert.match(aliases.response.body, /FW07 forum revision evidence primary 20260810/u)
  assert.match(aliases.response.body, /Run-owned FW07 live evidence fixture/u)
  assert.match(aliases.response.body, /FW07 revision two/u)

  const unknown = cases.get("frontforum-custom-body-unknown")
  assert.deepEqual(unknown.thread_ids, [])
  assert.deepEqual(unknown.variable_results, { unknown: "literal" })
  assert.match(unknown.response.body, /%%unknown%%/u)

  const malformed = cases.get("frontforum-custom-body-malformed-owner-control")
  assert.deepEqual(malformed.thread_ids, [])
  assert.deepEqual(malformed.variable_results, { title: "not_evaluated_after_malformed_selector" })
  assert.match(malformed.response.body, /Problem parsing attribute "category"/u)
  assert.doesNotMatch(malformed.response.body, /FW11-OWNER-CONTROL/u)

  assert.deepEqual(artifact.ownership_boundary, {
    owner: "FrontForum body-bearing runtime module",
    observed: "A recognized body-bearing FrontForum consumes its closer and evaluates documented variables once per selected thread; an unknown variable remains literal; malformed category selection renders the module error without leaking the custom body.",
    forbidden_inferences: [
      "raw closer consumption outside the typed FrontForum owner",
      "feed or document-head ownership",
      "fixRelativeLinks behavior",
      "private or deleted visibility",
      "forum mutation authority",
    ],
  })
})
