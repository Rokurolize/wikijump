import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const artifactUrl = new URL(
  "../artifacts/q1034-forum-browser-lifecycle-live-20260915.json",
  import.meta.url,
);
const scriptUrl = new URL(
  "../scripts/capture-q1034-forum-browser-lifecycle.mjs",
  import.meta.url,
);
const ARTIFACT_SHA256 =
  "0f84dcb18f1ba3da27ae133b22327d7d2fb8875737e9f20a81ff89bed20e27f7";

async function readArtifact() {
  const bytes = await readFile(artifactUrl);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    ARTIFACT_SHA256,
    "retained Q1034 browser evidence must be byte-identical to the sealed live capture",
  );
  return JSON.parse(bytes.toString("utf8"));
}

test("Q1034 browser lifecycle seals navigation, focus, history, failure, and settled states", async () => {
  const artifact = await readArtifact();
  assert.equal(artifact.schema, "wikijump.q1034_forum_browser_lifecycle_live.v1");
  assert.equal(artifact.site, "sandbox-for-codex");
  assert.equal(artifact.actor, "anonymous");
  assert.equal(artifact.mutation_performed, false);
  assert.equal(artifact.credentials_in_evidence, false);
  assert.equal(artifact.states.length, 15);

  const states = new Map(artifact.states.map((state) => [state.label, state]));
  assert.equal(states.get("category_settled").category_box_count, 1);
  assert.equal(states.get("category_thread_link_focused").active_element.tag, "A");
  assert.equal(states.get("thread_settled").thread_box_count, 1);
  assert.equal(states.get("thread_settled").post_count, 2);
  assert.equal(states.get("after_back_settled").category_box_count, 1);
  assert.equal(states.get("after_forward_settled").thread_box_count, 1);
  assert.equal(states.get("second_category_settled").category_box_count, 1);
  assert.equal(states.get("missing_category_settled").error_text, "Requested forum category does not exist.");
  assert.match(states.get("missing_thread_settled").error_text, /deleted/u);
});

test("Q1034 live RecentPosts page two is read-only and the capture fails closed around unrelated posts", async () => {
  const artifact = await readArtifact();
  assert.equal(artifact.recent_posts_page_two.http_status, 200);
  assert.equal(artifact.recent_posts_page_two.payload_status, "ok");
  assert.equal(artifact.recent_posts_page_two.body_sha256, "fb7631a9571792cf28dde0d2587cd87b36331f40a35f4ffb0a4db1a8ba5756fb");
  assert.equal(artifact.recent_posts_page_two.post_count, 0);
  assert.equal(artifact.recent_posts_page_two.pager_count, 2);

  const safePosts = artifact.ajax_posts.filter((post) => post.safe);
  assert.deepEqual(safePosts.map(({ module_name, page, category_id, action_present, event_present }) => ({ module_name, page, category_id, action_present, event_present })), [
    {
      module_name: "forum/ForumRecentPostsListModule",
      page: "2",
      category_id: "",
      action_present: false,
      event_present: false,
    },
  ]);
  assert.equal(artifact.blocked_requests.filter(({ method }) => method === "POST").every(({ module_name }) => module_name === "misc/CookiePolicyPlModule"), true);
  assert.equal(artifact.request_gate.enforcement_failed, false);
  assert.equal(artifact.request_gate.websocket_connections_blocked, 0);
  assert.deepEqual(artifact.console_errors, []);
  assert.deepEqual(artifact.page_errors, []);
  assert.match(artifact.authority_boundary.ambient_wait_class, /CookiePolicyPlModule/u);
});

test("Q1034 capture script never persists the anonymous token value", async () => {
  const source = await readFile(scriptUrl, "utf8");
  assert.match(source, /getCookie\?\.\("wikidot_token7"\)/u);
  assert.doesNotMatch(source, /wikidot_token7:\s*["'][A-Za-z0-9_-]{8,}["']/u);
  assert.match(source, /credentials_in_evidence:\s*false/u);
});
