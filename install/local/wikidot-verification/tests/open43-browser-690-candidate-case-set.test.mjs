import assert from "node:assert/strict";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import {
  OPEN43_B690_GEOMETRY_FIXTURE,
  verifyOpen43B690FixedSixPage,
  verifyOpen43B690GeometryInitial,
  verifyOpen43B690GeometrySettled,
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

function settledFixture() {
  const { observations, plan } = initialFixture();
  observations.phase = "settled";
  observations.sequence = 2;
  plan.settled_live_trace_sha256_by_slug = {};
  plan.live_page_content_height_by_slug = {};
  for (const page of observations.pages) {
    page.live_trace.incomplete_image_count = 0;
    page.candidate_trace.incomplete_image_count = 0;
    page.resource_completion = {
      status: "complete",
      load_ready_state: "complete",
      font_status: "loaded",
      incomplete_image_count: 0,
    };
    page.live_page_content_height = 20;
    page.candidate_page_content_height = 20;
    plan.settled_live_trace_sha256_by_slug[page.slug] = sha256Value(page.live_trace);
    plan.live_page_content_height_by_slug[page.slug] = 20;
  }
  return { observations, plan };
}

function sixPageFixture() {
  const slugs = [
    "scp-9506",
    "scp-744",
    "scp-2117",
    "scp-5516",
    "scp-8980",
    "theme:basalt",
  ];
  const plan = {
    page_origin: pageOrigin,
    viewport: { width: 1366, height: 900 },
    fixture_identity_sha256: sha256Value(OPEN43_B690_GEOMETRY_FIXTURE),
    live_reference_sha256: "b".repeat(64),
    live_policy_sha256: "c".repeat(64),
    six_page_slugs: slugs,
    live_capture_sha256_by_slug: Object.fromEntries(
      slugs.map((slug, index) => [slug, String(index).repeat(64).slice(0, 64)]),
    ),
  };
  const observations = {
    fixture_identity_sha256: plan.fixture_identity_sha256,
    live_reference_sha256: plan.live_reference_sha256,
    live_policy_sha256: plan.live_policy_sha256,
    sequence: 3,
    viewport: structuredClone(plan.viewport),
    browser_environment: { executable_sha256: "d".repeat(64) },
    pages: slugs.map((slug) => {
      const url = new URL(`/${encodeURI(slug)}`, pageOrigin).href;
      const traced = slug !== "scp-9506";
      return {
        slug,
        input_url: url,
        final_url: url,
        navigation_status: 200,
        resource_completion: {
          status: "complete",
          load_ready_state: "complete",
          font_status: "loaded",
          incomplete_image_count: 0,
        },
        live_capture_sha256: plan.live_capture_sha256_by_slug[slug],
        artifact_sha256: {
          domcontentloaded_immediate: "e".repeat(64),
          settled_viewport: "f".repeat(64),
          settled_full_page: "0".repeat(64),
        },
        comparison: {
          status: "pass",
          anomalies: [],
          attributes: { status: "pass" },
          domcontentloaded_immediate_probes: [{ status: "pass" }],
          settled_probes: [{ status: "pass" }],
          domcontentloaded_immediate_custom_properties: [],
          domcontentloaded_immediate_first_divergent_element: traced
            ? { kind: "none" }
            : null,
          settled_first_divergent_element: traced ? { kind: "none" } : null,
        },
      };
    }),
  };
  return { observations, plan };
}

test("B690 initial geometry has an executable source-owned candidate adapter", async () => {
  const selected = await candidateCaseSet("open43-690-geometry");
  assert.equal(selected.id, "open43-690-geometry");
  assert.deepEqual(selected.caseIds, [
    "B690_GEOMETRY_INITIAL",
    "B690_GEOMETRY_SETTLED",
    "B690_FIXED_SIX_PAGE_DENOMINATOR",
  ]);
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

test("B690 verifies settled resource completion before the total-height boundary", () => {
  const { observations, plan } = settledFixture();
  const verified = verifyOpen43B690GeometrySettled(observations, plan);
  assert.equal(verified.verified, true);
  assert.deepEqual(
    verified.classifications.map(({ slug, kind }) => ({ slug, kind })),
    plan.trace_canary_slugs.map((slug) => ({ slug, kind: "none" })),
  );

  const incomplete = structuredClone(observations);
  incomplete.pages[0].resource_completion.status = "bounded_domcontentloaded";
  assert.throws(
    () => verifyOpen43B690GeometrySettled(incomplete, plan),
    /resources did not settle/u,
  );

  const causal = structuredClone(observations);
  causal.pages[0].candidate_trace.elements[0].style.display = "inline";
  causal.pages[0].candidate_page_content_height = 200;
  assert.throws(
    () => verifyOpen43B690GeometrySettled(causal, plan),
    /first divergence found.*style_divergence/u,
  );

  const tall = structuredClone(observations);
  tall.pages[0].candidate_page_content_height = 40;
  assert.throws(
    () => verifyOpen43B690GeometrySettled(tall, plan),
    /page-content height diverged/u,
  );
});

test("B690 verifies one fixed complete six-page denominator", () => {
  const { observations, plan } = sixPageFixture();
  assert.deepEqual(verifyOpen43B690FixedSixPage(observations, plan), {
    verified: true,
    pairs_total: 6,
  });

  const reordered = structuredClone(observations);
  reordered.pages.reverse();
  assert.throws(
    () => verifyOpen43B690FixedSixPage(reordered, plan),
    /six-page order mismatched/u,
  );

  const incomplete = structuredClone(observations);
  incomplete.pages[0].resource_completion.font_status = "loading";
  assert.throws(
    () => verifyOpen43B690FixedSixPage(incomplete, plan),
    /resources did not settle/u,
  );

  const stateDrift = structuredClone(observations);
  stateDrift.pages[5].comparison.attributes.status = "fail";
  assert.throws(
    () => verifyOpen43B690FixedSixPage(stateDrift, plan),
    /six-page comparison failed/u,
  );

  const divergent = structuredClone(observations);
  divergent.pages[4].comparison.settled_first_divergent_element.kind =
    "style_divergence";
  assert.throws(
    () => verifyOpen43B690FixedSixPage(divergent, plan),
    /first divergence found/u,
  );
});
