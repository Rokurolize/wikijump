import assert from "node:assert/strict";
import test from "node:test";

import {
  SEMANTIC_ANCHORS,
  anchorSelectors,
  classifyElement,
  scoreAnchorMatch,
  suggestCandidateAnchors,
} from "../src/semantic-anchors.mjs";

test("classifyElement recognizes anchors by id, class, and token", () => {
  assert.equal(classifyElement({tag: "div", id: "page-title"}), "page_title");
  assert.equal(classifyElement({tag: "div", class: "page-rate-widget-box"}), "rating_widget");
  assert.equal(classifyElement({tag: "div", class: "foreign-rate-box"}), "rating_widget");
  assert.equal(classifyElement({tag: "div", class: "yui-navset"}), "tabview");
  assert.equal(classifyElement({tag: "blockquote"}), "blockquote");
  assert.equal(classifyElement({tag: "div", class: "unrelated"}), null);
});

test("scoreAnchorMatch rewards shared role and tag", () => {
  const strong = scoreAnchorMatch(
    {tag: "div", class: "foreign-rate-box", role: "rating_widget"},
    {tag: "div", class: "page-rate-widget-box", role: "rating_widget"},
  );
  assert.ok(strong.confidence >= 0.6);
  assert.ok(strong.evidence.includes("same semantic anchor"));
  const weak = scoreAnchorMatch({tag: "div", class: "x"}, {tag: "table", class: "y"});
  assert.equal(weak.confidence, 0);
});

test("suggestCandidateAnchors maps a foreign rate box to the SCP-JP rating widget", () => {
  const referenceInfo = {tag: "div", class: "foreign-rate-box", role: "rating_widget"};
  const candidates = {
    rating_widget: [{selector: ".page-rate-widget-box", tag: "div", class: "page-rate-widget-box", rect: {width: 200}}],
    page_content: [{selector: "#page-content", tag: "div", class: "", rect: {width: 1000}}],
  };
  const suggestions = suggestCandidateAnchors(referenceInfo, candidates);
  assert.equal(suggestions[0].selector, ".page-rate-widget-box");
  assert.equal(suggestions[0].role, "rating_widget");
  assert.ok(suggestions[0].confidence >= 0.6);
});

test("suggestCandidateAnchors does not invent a low-confidence fallback", () => {
  const referenceInfo = {tag: "div", class: "totally-unknown", role: null};
  const candidates = {
    header: [{selector: "#header", tag: "div", class: "", rect: {width: 10}}],
  };
  assert.deepEqual(suggestCandidateAnchors(referenceInfo, candidates), []);
});

test("suggestCandidateAnchors reports role absence instead of an unrelated anchor", () => {
  const referenceInfo = {tag: "div", class: "foreign-rate-box", role: "rating_widget"};
  const candidates = {page_content: [{selector: "#page-content", tag: "div", class: "", rect: {width: 1000}}]};
  assert.deepEqual(suggestCandidateAnchors(referenceInfo, candidates), []);
});

test("anchor inventory is non-empty and unique", () => {
  const selectors = anchorSelectors();
  assert.ok(selectors.length >= 20);
  assert.equal(new Set(selectors).size, selectors.length);
  assert.ok(SEMANTIC_ANCHORS.some((anchor) => anchor.role === "page_content"));
});
