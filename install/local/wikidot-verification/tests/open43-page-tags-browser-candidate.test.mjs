import assert from "node:assert/strict";
import test from "node:test";

import { verifyOpen43PageTagsCase } from "../src/open43-page-tags-browser-candidate-contract.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const PAGE_URL = "https://scpaiueouiuiuiui.wikijump.localhost:18443/corpus%3Ascp-9506-draft";
const TAGS = ["alpha", "beta"];
const HREFS = TAGS.map((tag) => "https://scpaiueouiuiuiui.wikijump.localhost:18443/system:page-tags/tag/" + tag + "#pages");
const BASE_CSS_URL = "https://scpaiueouiuiuiui.wikijump.localhost:18443/wikidot/styles/wikidot-base-165bc434fd1d.css";
const PLAN = {
  schema: "wikijump.open43_page_tags_browser_candidate_plan.v1",
  site_id: 6_000_003,
  page_id: 71,
  page_slug: "corpus:scp-9506-draft",
  page_category_id: 100_000_016,
  page_url: PAGE_URL,
  tag_count: TAGS.length,
  tags_sha256: sha256Value(TAGS),
  hrefs_sha256: sha256Value(HREFS),
};

function capture(width) {
  const artifact = { path: "B822_PAGE_TAGS-" + width + "-initial.png", sha256: sha256Value(["initial", width]) };
  return {
    viewport: { width, height: 900 },
    temporal: {
      phase: "domcontentloaded_immediate_observation",
      sequence: 1,
      input_url: PAGE_URL,
      final_url: PAGE_URL,
      navigation_status: 200,
      artifact,
      counterpart_artifact_path: "B822_PAGE_TAGS-" + width + "-settled.png",
      counterpart_artifact_sha256: sha256Value(["settled", width]),
    },
    page_tags: {
      container: {
        child_count: TAGS.length,
        display: "block",
        justify_content: "normal",
        text_align: "left",
        rect: { x: 0, y: 0, width: 320, height: 20 },
      },
      child_tags: ["a", "a"],
      labels: TAGS,
      hrefs: HREFS,
      child_rects: [{ x: 0, y: 0, width: 40, height: 18 }, { x: 44, y: 0, width: 40, height: 18 }],
      line_count: 1,
      active_rules: [{ href: BASE_CSS_URL, selector: ".page-tags", display: null, justify_content: null, text_align: "left" }],
    },
    stylesheet_assets: [{ url: BASE_CSS_URL, sha256: "165bc434fd1da2092fee0ea6bdeb55aa38402aaaafd6d1e3303180d2b595b981" }],
    capture_failures: [],
    request_gate_aborts: [],
    failed_request_identity_sha256: sha256Value({ failures: [], request_gate_aborts: [] }),
  };
}

test("#822 verifies public page-tag DOM and rejects the modern flex owner", () => {
  const observations = {
    page_url: PAGE_URL,
    public_page: {
      site_id: PLAN.site_id,
      page_id: PLAN.page_id,
      slug: PLAN.page_slug,
      page_category_id: PLAN.page_category_id,
      revision_id: 81,
      tag_count: TAGS.length,
      tags_sha256: PLAN.tags_sha256,
      hrefs_sha256: PLAN.hrefs_sha256,
    },
    captures: [1280, 767, 479].map(capture),
  };
  assert.deepEqual(verifyOpen43PageTagsCase("B822_PAGE_TAGS_INITIAL", observations, PLAN), {
    verified: true,
    viewport_count: 3,
    tag_count: 2,
  });
  const negative = structuredClone(observations);
  negative.captures[0].page_tags.container.display = "flex";
  assert.throws(
    () => verifyOpen43PageTagsCase("B822_PAGE_TAGS_INITIAL", negative, PLAN),
    /imported page-tags matched the modern flex owner/u,
  );
});
