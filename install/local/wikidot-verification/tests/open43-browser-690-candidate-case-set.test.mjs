import assert from "node:assert/strict";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import {
  OPEN43_B690_GEOMETRY_FIXTURE,
  verifyOpen43B690GeometryInitial,
} from "../src/open43-browser-690-candidate-case-set.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const pageOrigin = "https://candidate.wikijump.localhost:18443";

function trace({ incompleteImages = 0, display = "block" } = {}) {
  return {
    root_selector: "#page-content",
    root_count: 1,
    element_count: 1,
    captured_count: 1,
    truncated: false,
    incomplete_image_count: incompleteImages,
    elements: [
      {
        path: "p[1]",
        tag: "p",
        id: null,
        classes: [],
        child_element_count: 0,
        normalized_direct_text_sha256: "a".repeat(64),
        rect: { x: 0, y: 0, width: 100, height: 20 },
        style: { display },
      },
    ],
  };
}

function initialFixture() {
  const liveTraces = Object.fromEntries(
    OPEN43_B690_GEOMETRY_FIXTURE.trace_canary_slugs.map((slug) => [
      slug,
      trace({ incompleteImages: slug === "scp-8980" ? 1 : 0 }),
    ]),
  );
  const plan = {
    page_origin: pageOrigin,
    fixture_identity_sha256: sha256Value(OPEN43_B690_GEOMETRY_FIXTURE),
    live_reference_sha256: "b".repeat(64),
    live_policy_sha256: "c".repeat(64),
    trace_canary_slugs: [...OPEN43_B690_GEOMETRY_FIXTURE.trace_canary_slugs],
    live_trace_sha256_by_slug: Object.fromEntries(
      Object.entries(liveTraces).map(([slug, value]) => [
        slug,
        sha256Value(value),
      ]),
    ),
    thresholds: {
      geometry_position_px: 8,
      geometry_size_px: 12,
    },
  };
  const observations = {
    fixture_identity_sha256: plan.fixture_identity_sha256,
    live_reference_sha256: plan.live_reference_sha256,
    live_policy_sha256: plan.live_policy_sha256,
    phase: "domcontentloaded_immediate_observation",
    sequence: 1,
    browser_environment: { executable_sha256: "d".repeat(64) },
    pages: plan.trace_canary_slugs.map((slug) => {
      const url = new URL(`/${encodeURI(slug)}`, pageOrigin).href;
      return {
        slug,
        input_url: url,
        final_url: url,
        navigation_status: 200,
        live_trace: liveTraces[slug],
        candidate_trace: structuredClone(liveTraces[slug]),
      };
    }),
  };
  return { observations, plan };
}

test("B690 initial geometry has an executable source-owned candidate adapter", async () => {
  const selected = await candidateCaseSet("open43-690-geometry");
  assert.equal(selected.id, "open43-690-geometry");
  assert.deepEqual(selected.caseIds, ["B690_GEOMETRY_INITIAL"]);
});

test("B690 verifies the ordered initial traces and fails on the first causal divergence", () => {
  const { observations, plan } = initialFixture();
  const verified = verifyOpen43B690GeometryInitial(observations, plan);
  assert.equal(verified.verified, true);
  assert.deepEqual(
    verified.classifications.map(({ slug, kind }) => ({ slug, kind })),
    plan.trace_canary_slugs.map((slug) => ({
      slug,
      kind: slug === "scp-8980" ? "resource_incomplete" : "none",
    })),
  );

  const drifted = structuredClone(observations);
  drifted.pages[0].candidate_trace.elements[0].style.display = "inline";
  assert.throws(
    () => verifyOpen43B690GeometryInitial(drifted, plan),
    /first divergence found.*style_divergence/u,
  );

  const reordered = structuredClone(observations);
  reordered.pages.reverse();
  assert.throws(
    () => verifyOpen43B690GeometryInitial(reordered, plan),
    /page order mismatched/u,
  );
});
