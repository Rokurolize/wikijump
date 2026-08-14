import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

import { historicalText } from "./historical-git.mjs"

const repositoryRoot = new URL("../../../../", import.meta.url)

test("historical reads ignore inherited replacement controls and require an exact commit", () => {
  const git = (...args) => execFileSync("/usr/bin/git", ["-C", repositoryRoot.pathname, ...args], { encoding: "utf8" }).trim()
  const commit = git("rev-parse", "HEAD")
  const tree = git("rev-parse", "HEAD^{tree}")
  const previous = process.env.GIT_REPLACE_REF_BASE
  process.env.GIT_REPLACE_REF_BASE = "refs/replace/poisoned"
  try {
    const packagePath = "install/local/wikidot-verification/package.json"
    assert.match(historicalText(commit, packagePath), /"name"/u)
    assert.throws(() => historicalText(tree, packagePath), /exact commit/u)
  } finally {
    if (previous === undefined) delete process.env.GIT_REPLACE_REF_BASE
    else process.env.GIT_REPLACE_REF_BASE = previous
  }
})
