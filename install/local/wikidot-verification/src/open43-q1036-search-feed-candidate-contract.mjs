import { createHash } from "node:crypto";

import {
  requireNonEmptyString,
  requirePlainObject,
  requireSha256,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_Q1036_CASE_IDS = Object.freeze([
  "Q1036_EXACT_CANDIDATE_PREVIEW_SAVED_BOUNDARIES",
]);

export const OPEN43_Q1036_EVIDENCE = Object.freeze({
  path: "install/local/wikidot-verification/artifacts/search-feed-live-preview-20260809.json",
  sha256: "b8642635e71c02bb9e798af5740be5de3c259fef13f000dc6f0bd0fe28946565",
});

export const SEARCH_ERROR = "<div class=\"error-block\">Search is temporarily unavailable, we are working to bring it online!</div>";
export const FEED_MISSING_ERROR = "<div class=\"error-block\">No feed source specified (\"src\" element missing).</div>";
export const FEED_UNAVAILABLE_ERROR = '<div class="error-block">Error processing the feed "https://example.com/feed.xml". The feed can not be accessed or contains errors. </div>';
export const SAVED_SOURCE = "SEARCH_START\n[[module Search]]\nSEARCH_END\nFEED_START\n[[module Feed]]\nFEED_END";

export const PREVIEW_CASES = Object.freeze([
  ["search-bare", "[[module Search]]", SEARCH_ERROR],
  ["search-mini-true", "[[module Search mini=\"true\"]]", SEARCH_ERROR],
  ["search-area-pages", "[[module Search a=\"p\"]]", SEARCH_ERROR],
  ["search-unknown-argument", "[[module Search unknown=\"x\"]]", SEARCH_ERROR],
  ["search-single-quoted-mini", "[[module Search mini='true']]", SEARCH_ERROR],
  ["search-uppercase-name", "[[module SEARCH]]", SEARCH_ERROR],
  ["feed-bare", "[[module Feed]]", FEED_MISSING_ERROR],
  ["feed-empty-src", "[[module Feed src=\"\"]]", FEED_MISSING_ERROR],
  ["feed-missing-src-with-limit", "[[module Feed limit=\"1\"]]", FEED_MISSING_ERROR],
  ["feed-single-quoted-src", "[[module Feed src='https://example.com/feed.xml']]", FEED_MISSING_ERROR],
  ["feed-uppercase-src", "[[module Feed SRC=\"https://example.com/feed.xml\"]]", FEED_MISSING_ERROR],
  ["feed-valid-src", "[[module Feed src=\"https://example.com/feed.xml\"]]", FEED_UNAVAILABLE_ERROR],
].map(([caseId, source, expected]) => Object.freeze({ case_id: caseId, source, expected })));

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function object(value, name) {
  return requirePlainObject(value, name);
}

function bodyHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function validateOpen43Q1036PrivateInput(value) {
  const input = object(value, "Q1036 private input");
  expect(Number.isSafeInteger(input.site_id) && input.site_id > 0, "Q1036 site_id must be a positive safe integer");
  expect(Number.isSafeInteger(input.saved_page_id) && input.saved_page_id > 0, "Q1036 saved_page_id must be a positive safe integer");
  expect(Number.isSafeInteger(input.saved_revision_id) && input.saved_revision_id > 0, "Q1036 saved_revision_id must be a positive safe integer");
  const slug = requireNonEmptyString(input.saved_page_slug, "Q1036 saved_page_slug");
  expect(!/[\s\r\n]/u.test(slug), "Q1036 saved_page_slug must not contain whitespace");
  return input;
}

function verifyPreviewCases(value) {
  expect(Array.isArray(value), "Q1036 preview observations must be an array");
  expect(value.length === PREVIEW_CASES.length, "Q1036 preview denominator is incomplete");
  for (const [index, expected] of PREVIEW_CASES.entries()) {
    const observed = object(value[index], `${expected.case_id} observation`);
    expect(observed.case_id === expected.case_id, `Q1036 preview order changed at ${expected.case_id}`);
    requireSha256(observed.body_sha256, `${expected.case_id} body SHA-256`);
    expect(Number.isSafeInteger(observed.body_length) && observed.body_length > 0, `${expected.case_id} body length is invalid`);
    expect(observed.expected_fragment_present === true, `${expected.case_id} did not match its live error boundary`);
    expect(observed.module_consumed === true, `${expected.case_id} leaked the module source`);
  }
  return { case_count: value.length, evidence_sha256: sha256Value(PREVIEW_CASES.map(({ case_id, source, expected }) => ({ case_id, source, expected }))) };
}

function verifySaved(value, input) {
  const saved = object(value, "Q1036 saved observation");
  const page = object(saved.page_get, "Q1036 saved page_get observation");
  expect(page.page_id === input.saved_page_id && page.revision_id === input.saved_revision_id && page.slug === input.saved_page_slug, "Q1036 saved page identity changed");
  expect(page.wikitext_sha256 === bodyHash(SAVED_SOURCE), "Q1036 saved source changed");
  const view = object(saved.page_view, "Q1036 saved page_view observation");
  expect(view.type === "found" && view.wikitext_sha256 === bodyHash(SAVED_SOURCE), "Q1036 saved page view did not bind the expected source");
  expect(view.search_error === true && view.feed_error === true && view.markers_preserved === true && view.module_consumed === true, "Q1036 saved page view changed the live module boundaries");
  requireSha256(view.body_sha256, "Q1036 saved body SHA-256");
  return { page_id: page.page_id, revision_id: page.revision_id, body_sha256: view.body_sha256, saved_boundaries_verified: true };
}

export function verifyOpen43Q1036Case(caseId, observations, input) {
  expect(caseId === OPEN43_Q1036_CASE_IDS[0], `unsupported Q1036 case: ${caseId}`);
  const value = object(observations, `${caseId} observations`);
  return { verified: true, previews: verifyPreviewCases(value.previews), saved: verifySaved(value.saved, input) };
}

export function verifyOpen43Q1036Cleanup(proof, resources) {
  expect(proof?.public_absence_verified === true && proof.mutation_count === 0 && proof.cleanup_required === false, "Q1036 case was not read-only");
  expect(Array.isArray(resources) && resources.length === 0, "Q1036 read-only case recorded a resource");
  return { public_absence_verified: true, mutation_count: 0, resource_count: 0 };
}
