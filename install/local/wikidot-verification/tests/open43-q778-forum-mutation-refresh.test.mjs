import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const producerUrl = new URL("../scripts/capture-open43-q778-forum-mutation-refresh.py", import.meta.url)
const verifierUrl = new URL("../scripts/verify-open43-q778-forum-mutation-refresh.py", import.meta.url)

test("Q778 mutation producer is bounded, origin-pinned, and cleanup-first", async () => {
  const source = await readFile(producerUrl, "utf8")

  assert.match(source, /EXPECTED_PUBLIC_ORIGIN\s*=\s*["']http:\/\/sandbox-for-codex\.wikidot\.com["']/u)
  assert.match(source, /follow_redirects=False/u)
  assert.match(source, /trust_env=False/u)
  assert.match(source, /MAX_REFRESH_SECONDS\s*=\s*120/u)
  assert.match(source, /MAX_READS_PER_STAGE\s*=\s*8/u)
  assert.match(source, /CONCURRENT_READERS\s*=\s*2/u)
  assert.match(source, /public_thread_observation/u)
  assert.match(source, /"restore":\s*\{[\s\S]*?"status":\s*"blocked"/u)
  assert.match(source, /finally:\s*\n\s*cleanup = record\["cleanup"\]/u)
  assert.match(source, /live_state_debt/u)
  assert.doesNotMatch(source, /urllib\.request\.urlopen/u)
  assert.doesNotMatch(source, /WIKIDOT_SESSION_ID\s*[=:]/u)
  assert.doesNotMatch(source, /"password"\s*:/u)
  assert.doesNotMatch(source, /body_path/u)
})

test("Q778 terminal verifier is independent, read-only, and baseline-bound", async () => {
  const source = await readFile(verifierUrl, "utf8")

  assert.match(source, /wikijump\.open43\.q778_forum_mutation_refresh_live\.v2/u)
  assert.match(source, /baseline_thread.*post_ids/u)
  assert.match(source, /marker_titles_absent/u)
  assert.match(source, /holder_documents_absent_or_marker_absent/u)
  assert.match(source, /terminal_absence.*verified/u)
  assert.match(source, /trust_env=False/u)
  assert.doesNotMatch(source, /amc_request\s*\(/u)
  assert.doesNotMatch(source, /ForumAction/u)
  assert.doesNotMatch(source, /"password"\s*:/u)
})
