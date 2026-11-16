import assert from "node:assert/strict"
import test from "node:test"

import { defaultPageTitleFromSlug } from "../src/lib/wikidot/wikidot-page-title.ts"

test("derives the default title live Wikidot pre-fills for a new page", () => {
  // Each expectation is the exact value the live sandbox editor
  // (sandbox-for-codex, 2026-11-17) presented in its title field for a
  // page created without typing a title.
  assert.equal(
    defaultPageTitleFromSlug("probe-behavior-rename-a"),
    "Probe Behavior Rename A"
  )
  assert.equal(
    defaultPageTitleFromSlug("muse-probe-title-formcheck3"),
    "Muse Probe Title Formcheck3"
  )
  assert.equal(defaultPageTitleFromSlug("muse-probe-title-cat2:inner-page"), "Inner Page")
  assert.equal(
    defaultPageTitleFromSlug("muse-probe-title-mix-99x-scp173"),
    "Muse Probe Title Mix 99x Scp173"
  )
})

test("underscores separate words, as after live fullname normalization", () => {
  assert.equal(
    defaultPageTitleFromSlug("muse-probe-title-mix_99x-scp173"),
    "Muse Probe Title Mix 99x Scp173"
  )
})

test("single-word and numeric names", () => {
  assert.equal(defaultPageTitleFromSlug("start"), "Start")
  assert.equal(defaultPageTitleFromSlug("scp-173"), "Scp 173")
  assert.equal(defaultPageTitleFromSlug("system:page-tags"), "Page Tags")
})
