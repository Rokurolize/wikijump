import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const artifactPath = path.join(root, "install/local/wikidot-verification/artifacts/userinfo-tab-switching-live-20261022.json");
const TAB_IDS = ["ui-profile-b", "ui-member-b", "ui-moderator-b", "ui-admin-b", "ui-contrib-b", "ui-posts-b"];
const TARGET_IDS = ["dr-clef", "the-administrator"];
const sha256Pattern = /^[0-9a-f]{64}$/u;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeTabClasses(html) {
  return html.replace(/(<li) class="(?:active)?"/gu, "$1");
}

function objectValues(value) {
  if (Array.isArray(value)) return value.flatMap(objectValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(objectValues);
  return [value];
}

test("UserInfo tab-switching evidence covers both targets, the initial state, and each tab once", () => {
  const artifact = readJson(artifactPath);

  assert.equal(artifact.schema, "wikijump.userinfo_tab_switching.live_evidence.v1");
  assert.equal(artifact.public_interface, "GET https://www.wikidot.com/user:info/<target>");
  assert.deepEqual(artifact.actor, {actor_id: "anonymous", authenticated: false});
  assert.equal(artifact.mutated, false);
  assert.equal(artifact.form_submissions, 0);
  assert.deepEqual(artifact.interactions_allowed, TAB_IDS.map((id) => `#${id}`));
  assert.equal(artifact.run_error, null);
  assert.deepEqual(artifact.targets.map(({target_id}) => target_id), TARGET_IDS);
  assert.equal(artifact.selection.target, null);
  assert.equal(artifact.selection.tab, null);
  assert.equal(artifact.states.length, TARGET_IDS.length * (TAB_IDS.length + 1));

  for (const target of TARGET_IDS) {
    const states = artifact.states.filter((state) => state.target_id === target);
    assert.deepEqual(states.map((state) => state.state_id), ["initial", ...TAB_IDS]);
  }
});

test("every state records a successful navigation and no capture error", () => {
  const artifact = readJson(artifactPath);
  for (const state of artifact.states) {
    assert.equal(state.capture_error, null, `${state.target_id} ${state.state_id}`);
    assert.equal(state.navigation_status, 200, `${state.target_id} ${state.state_id}`);
    assert.equal(state.requested_url, `https://www.wikidot.com/user:info/${state.target_id}`);
    assert.match(state.before.page_content_sha256, sha256Pattern);
    assert.equal(sha256(state.before.page_content_html), state.before.page_content_sha256);
    assert.equal(sha256(state.before.body_html), state.before.body_sha256);
  }
});

test("each tab click is the only interaction and is one of the six tab anchors", () => {
  const artifact = readJson(artifactPath);
  for (const state of artifact.states) {
    if (state.state_id === "initial") {
      assert.equal(state.action, null);
      assert.equal(state.click, null);
      assert.equal(state.after, null);
      continue;
    }
    assert.deepEqual(state.action, {kind: "click", selector: `#${state.state_id}`});
    assert.equal(state.click.selector, `#${state.state_id}`);
    assert.ok(["mouse-click", "dom-click"].includes(state.click.method), `${state.state_id} click method`);
    assert.ok(state.after !== null, `${state.state_id} has an after snapshot`);
  }
});

test("a tab click changes only the tab items' class attributes", () => {
  const artifact = readJson(artifactPath);
  for (const state of artifact.states.filter((item) => item.after !== null)) {
    const clicked = state.state_id;
    assert.deepEqual(state.after.active_tab_ids, [clicked], `${state.target_id} ${clicked} selected tab`);
    assert.equal(state.after.url, state.before.url, `${state.target_id} ${clicked} URL unchanged`);
    assert.equal(state.after.history_length, state.before.history_length, `${state.target_id} ${clicked} history unchanged`);
    assert.equal(
      normalizeTabClasses(state.before.body_html),
      normalizeTabClasses(state.after.body_html),
      `${state.target_id} ${clicked} body differs only in tab classes`,
    );
    assert.deepEqual(state.after.col_md_9, state.before.col_md_9, `${state.target_id} ${clicked} profile column`);
    assert.deepEqual(state.after.col_md_3, state.before.col_md_3, `${state.target_id} ${clicked} tab column`);
    assert.equal(state.after.user_info_area_sha256, state.before.user_info_area_sha256, `${state.target_id} ${clicked} profile box`);
  }
});

test("tab classes after each click are active on the clicked tab and empty on the tab that lost it", () => {
  const artifact = readJson(artifactPath);
  for (const state of artifact.states.filter((item) => item.after !== null)) {
    const classes = state.after.tabs.map((tab) => tab.li_class);
    const anchors = state.after.tabs.map((tab) => tab.anchor_id);
    assert.deepEqual(anchors, TAB_IDS);
    const expected = TAB_IDS.map((id) => {
      if (id === state.state_id) return "active";
      return state.state_id === "ui-profile-b" ? null : id === "ui-profile-b" ? "" : null;
    });
    assert.deepEqual(classes, expected, `${state.target_id} ${state.state_id} tab classes`);
  }
});

test("recorded repeated selections keep one active tab and empty classes on each tab that lost it", () => {
  const artifact = readJson(artifactPath);
  assert.equal(artifact.sequences.length, TARGET_IDS.length);
  for (const sequence of artifact.sequences) {
    assert.deepEqual(sequence.tabs, ["ui-member-b", "ui-moderator-b", "ui-profile-b"]);
    assert.equal(sequence.capture_error, null, `${sequence.target_id} sequence`);
    assert.deepEqual(sequence.initial.active_tab_ids, ["ui-profile-b"]);
    const lost = new Set();
    let selected = "ui-profile-b";
    for (const step of sequence.steps) {
      if (selected !== step.tab_id) lost.add(selected);
      selected = step.tab_id;
      assert.deepEqual(step.after.active_tab_ids, [selected], `${sequence.target_id} ${step.tab_id} selected`);
      const expected = TAB_IDS.map((id) => (id === selected ? "active" : lost.has(id) ? "" : null));
      assert.deepEqual(step.after.tabs.map((tab) => tab.li_class), expected, `${sequence.target_id} ${step.tab_id} classes`);
      assert.equal(step.after.url, sequence.initial.url, `${sequence.target_id} ${step.tab_id} URL unchanged`);
      assert.deepEqual(step.requests_after_action, [], `${sequence.target_id} ${step.tab_id} requests`);
    }
  }
});

test("no request, page error, or console error follows a tab click", () => {
  const artifact = readJson(artifactPath);
  for (const state of artifact.states.filter((item) => item.after !== null)) {
    assert.deepEqual(state.requests_after_action, [], `${state.target_id} ${state.state_id} requests`);
    assert.deepEqual(state.page_errors_after_action ?? [], [], `${state.target_id} ${state.state_id} page errors`);
  }
});

test("the retained policy aborts only ads and analytics outside the public contract", () => {
  const artifact = readJson(artifactPath);
  assert.equal(artifact.third_party_policy.allowed_public_prefixes.includes("https://*.wikidot.com/"), true);
  for (const blocked of artifact.third_party_policy.blocked_requests) {
    const host = new URL(blocked.request.split(" ")[1]).hostname;
    assert.equal(host.endsWith(".wikidot.com"), false, `Wikidot host blocked: ${blocked.request}`);
    assert.doesNotMatch(blocked.request, /\/(?:v--c5ce02208cf9|local--theme|common--theme)\//u, blocked.request);
  }
  assert.deepEqual(artifact.uncertain_acquisition_refusals, []);
});

test("the browser identity and the artifact carry no credentials or private account data", () => {
  const artifact = readJson(artifactPath);
  assert.match(artifact.browser.resolved_executable_sha256, sha256Pattern);
  assert.match(artifact.browser.version, /^Google Chrome \d+/u);

  const text = JSON.stringify(artifact);
  assert.doesNotMatch(text, /wikidot_token7|WIKIDOT_SESSION_ID|set-cookie|authorization/iu);
  assert.doesNotMatch(text, /\bcsrf\b/iu);
  assert.doesNotMatch(text, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu);
  const scalars = objectValues(artifact).filter((value) => typeof value === "string");
  assert.equal(scalars.some((value) => /<script[^>]*>[^<]+<\/script>/iu.test(value)), false, "script bodies are not retained");
  assert.equal(artifact.policy.script_bodies_retained, false);
});
