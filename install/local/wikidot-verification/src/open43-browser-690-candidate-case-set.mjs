import {
  STANDING_BROWSER_CANARIES,
  defaultCanaryPairs,
} from "./standing-browser-canaries.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { compareFirstDivergenceTraces } from "./first-divergent-element.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import { loadSealedLiveReference } from "./standing-browser-parity-reference.mjs";
import {
  DEFAULT_THRESHOLDS,
  compareCaptures,
  validateThresholds,
} from "./standing-browser-parity-contract.mjs";
import {
  readJsonObject,
  requirePlainObject,
  requireSha256,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_B690_GEOMETRY_INITIAL_CASE_ID =
  "B690_GEOMETRY_INITIAL";
export const OPEN43_B690_GEOMETRY_SETTLED_CASE_ID =
  "B690_GEOMETRY_SETTLED";
export const OPEN43_B690_FIXED_SIX_PAGE_CASE_ID =
  "B690_FIXED_SIX_PAGE_DENOMINATOR";

export const OPEN43_B690_GEOMETRY_FIXTURE = Object.freeze({
  fixture_id: "open43-standing-browser-initial-geometry",
  live_reference_path:
    "/home/roku/wjlab/evidence/open87-5f1-live-reference-policy-v9-attempt01/standing-browser-live-reference.json",
  live_reference_sha256:
    "2d3b98a9f04767f396b9e3f4d6f2f1881f78d3a270a4bf5c5c22d939fc72ae4f",
  live_policy_path:
    "/home/roku/wjlab/evidence/standing-promotion-20260812-organic-external-policy/live-completion-policy.json",
  live_policy_sha256:
    "bb7133d92598c4c957f57f1b77e0ab24a10d0f4f044ae442d2b44cddd4246125",
  reference_local_origin: "https://scp-wiki.wikijump.localhost:18443",
  live_origin: "https://scp-wiki.wikidot.com",
  trace_canary_slugs: Object.freeze([
    "scp-744",
    "scp-2117",
    "scp-5516",
    "scp-8980",
    "theme:basalt",
  ]),
});

const VIEWPORT = Object.freeze({ width: 1366, height: 900 });
const FIXTURE_IDENTITY_SHA256 = sha256Value(OPEN43_B690_GEOMETRY_FIXTURE);
const TRACE_CANARIES = Object.freeze(
  OPEN43_B690_GEOMETRY_FIXTURE.trace_canary_slugs.map((slug) => {
    const canary = STANDING_BROWSER_CANARIES.find(
      (candidate) => candidate.slug === slug,
    );
    if (!canary?.first_divergence_trace) {
      throw new Error(`B690 trace canary is unavailable: ${slug}`);
    }
    return canary;
  }),
);
const SIX_PAGE_SLUGS = Object.freeze(
  STANDING_BROWSER_CANARIES.map(({ slug }) => slug),
);
const SOURCE_FILES = Object.freeze([
  ...new Set([
    ...STANDING_BROWSER_EXECUTION_MODULES,
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/open43-browser-690-candidate-case-set.mjs",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
    "deepwell/src/services/render/list_pages/rendering.rs",
    "deepwell/src/services/render/list_pages/rendering/selected_content.rs",
    "deepwell/src/services/render/runtime_modules.rs",
  ]),
]);

function exactFixture(privateInput) {
  const fixture = requirePlainObject(
    privateInput.fixture,
    "private input fixture",
  );
  if (sha256Value(fixture) !== FIXTURE_IDENTITY_SHA256) {
    throw new Error("private input fixture is not the sealed B690 fixture");
  }
  return fixture;
}

function liveRecordBySlug(liveReference) {
  return Object.fromEntries(
    liveReference.records.map((record) => [
      decodeURIComponent(new URL(record.input.live_url).pathname.slice(1)),
      record,
    ]),
  );
}

function liveDocumentBySlug(records, phase) {
  return Object.fromEntries(
    OPEN43_B690_GEOMETRY_FIXTURE.trace_canary_slugs.map((slug) => {
      const capture = records[slug]?.capture;
      return [
        slug,
        phase === "settled" ? capture?.document : capture?.first_paint?.document,
      ];
    }),
  );
}

function validateTrace(trace, name) {
  const value = requirePlainObject(trace, name);
  if (
    value.root_selector !== "#page-content" ||
    value.root_count !== 1 ||
    value.truncated !== false ||
    !Array.isArray(value.elements) ||
    value.captured_count !== value.elements.length ||
    value.element_count !== value.elements.length ||
    !Number.isInteger(value.incomplete_image_count) ||
    value.incomplete_image_count < 0
  ) {
    throw new Error(`${name} is not a complete ordered #page-content trace`);
  }
  return value;
}

function pageContentHeight(document, name) {
  const height = document?.geometry?.["#page-content"]?.rect?.height;
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error(`${name} has no finite #page-content height`);
  }
  return height;
}

function pageContentRenderedImages(document, name) {
  const count = document?.page_content_rendered_images;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`${name} has no valid page-content rendered-image count`);
  }
  return count;
}

function initialDivergenceWithResourceTiming(page, classification, plan) {
  const candidateCount = page.candidate_initial_page_content_rendered_images;
  const liveCount = page.live_initial_page_content_rendered_images;
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 0) {
    throw new Error(`${page.slug} initial candidate image count is invalid`);
  }
  if (
    liveCount !== plan.live_initial_page_content_rendered_images_by_slug[page.slug]
  ) {
    throw new Error(`${page.slug} initial live image count mismatched`);
  }
  if (
    classification.kind === "geometry_divergence" &&
    candidateCount !== liveCount
  ) {
    return {
      kind: "resource_incomplete",
      rendered_image_count: { candidate: candidateCount, live: liveCount },
      first_geometry_divergence: classification,
    };
  }
  return classification;
}

function verifyGeometry(observations, plan, { phase, sequence, settled }) {
  const label = settled ? "B690 settled" : "B690 initial";
  const divergenceLabel = settled ? "B690 settled" : "B690";
  const caseId = settled
    ? OPEN43_B690_GEOMETRY_SETTLED_CASE_ID
    : OPEN43_B690_GEOMETRY_INITIAL_CASE_ID;
  const value = requirePlainObject(
    observations,
    `${caseId} observations`,
  );
  if (
    value.fixture_identity_sha256 !== plan.fixture_identity_sha256 ||
    value.live_reference_sha256 !== plan.live_reference_sha256 ||
    value.live_policy_sha256 !== plan.live_policy_sha256 ||
    value.phase !== phase ||
    value.sequence !== sequence ||
    !Array.isArray(value.pages) ||
    value.pages.length !== plan.trace_canary_slugs.length
  ) {
    throw new Error(`${label} geometry denominator or identity mismatched`);
  }
  requireSha256(
    value.browser_environment.executable_sha256,
    "B690 browser executable SHA-256",
  );
  if (
    JSON.stringify(value.pages.map(({ slug }) => slug)) !==
    JSON.stringify(plan.trace_canary_slugs)
  ) {
    throw new Error(`${label} geometry page order mismatched`);
  }

  const liveHashes = settled
    ? plan.settled_live_trace_sha256_by_slug
    : plan.live_trace_sha256_by_slug;
  const classifications = [];
  for (const page of value.pages) {
    const expectedUrl = new URL(
      `/${encodeURI(page.slug)}`,
      plan.page_origin,
    ).href;
    if (
      page.input_url !== expectedUrl ||
      page.final_url !== expectedUrl ||
      page.navigation_status !== 200
    ) {
      throw new Error(`${label} navigation mismatched: ${page.slug}`);
    }
    if (
      settled &&
      (page.resource_completion?.status !== "complete" ||
        page.resource_completion.load_ready_state !== "complete" ||
        page.resource_completion.font_status !== "loaded" ||
        page.resource_completion.incomplete_image_count !== 0)
    ) {
      throw new Error(`B690 resources did not settle: ${page.slug}`);
    }
    const liveTrace = validateTrace(
      page.live_trace,
      `${page.slug}${settled ? " settled" : ""} live trace`,
    );
    if (sha256Value(liveTrace) !== liveHashes[page.slug]) {
      throw new Error(`${label} live trace identity mismatched: ${page.slug}`);
    }
    const candidateTrace = validateTrace(
      page.candidate_trace,
      `${page.slug}${settled ? " settled" : ""} candidate trace`,
    );
    const rawClassification = compareFirstDivergenceTraces(
      candidateTrace,
      liveTrace,
      {
        ...plan.thresholds,
        ignored_classes: ["page-rate-widget-box"],
      },
    );
    const classification = settled
      ? rawClassification
      : initialDivergenceWithResourceTiming(page, rawClassification, plan);
    if (
      settled
        ? !new Set(["none", "content_divergence"]).has(classification.kind)
        : !new Set(["none", "resource_incomplete", "content_divergence"]).has(
            classification.kind,
          )
    ) {
      throw new Error(
        `${divergenceLabel} first divergence found for ${page.slug}: ${classification.kind}`,
      );
    }
    if (settled) {
      const liveHeight = plan.live_page_content_height_by_slug[page.slug];
      if (
        page.live_page_content_height !== liveHeight ||
        !Number.isFinite(page.candidate_page_content_height) ||
        Math.abs(page.candidate_page_content_height - liveHeight) >
          plan.thresholds.geometry_size_px
      ) {
        throw new Error(`B690 settled #page-content height diverged: ${page.slug}`);
      }
      classifications.push({
        slug: page.slug,
        ...classification,
        live_page_content_height: liveHeight,
        candidate_page_content_height: page.candidate_page_content_height,
      });
    } else {
      classifications.push({ slug: page.slug, ...classification });
    }
  }
  return {
    verified: true,
    phase: value.phase,
    ordered_trace_count: classifications.length,
    classifications,
  };
}

export function verifyOpen43B690GeometryInitial(observations, plan) {
  return verifyGeometry(observations, plan, {
    phase: "domcontentloaded_immediate_observation",
    sequence: 1,
    settled: false,
  });
}

export function verifyOpen43B690GeometrySettled(observations, plan) {
  return verifyGeometry(observations, plan, {
    phase: "settled",
    sequence: 2,
    settled: true,
  });
}

export function verifyOpen43B690FixedSixPage(observations, plan) {
  const value = requirePlainObject(
    observations,
    `${OPEN43_B690_FIXED_SIX_PAGE_CASE_ID} observations`,
  );
  if (
    value.fixture_identity_sha256 !== plan.fixture_identity_sha256 ||
    value.live_reference_sha256 !== plan.live_reference_sha256 ||
    value.live_policy_sha256 !== plan.live_policy_sha256 ||
    value.sequence !== 3 ||
    JSON.stringify(value.viewport) !== JSON.stringify(plan.viewport) ||
    !Array.isArray(value.pages) ||
    value.pages.length !== plan.six_page_slugs.length
  ) {
    throw new Error("B690 fixed six-page denominator or identity mismatched");
  }
  requireSha256(
    value.browser_environment.executable_sha256,
    "B690 browser executable SHA-256",
  );
  if (
    JSON.stringify(value.pages.map(({ slug }) => slug)) !==
    JSON.stringify(plan.six_page_slugs)
  ) {
    throw new Error("B690 fixed six-page order mismatched");
  }

  for (const page of value.pages) {
    const expectedUrl = new URL(
      `/${encodeURI(page.slug)}`,
      plan.page_origin,
    ).href;
    if (
      page.input_url !== expectedUrl ||
      page.final_url !== expectedUrl ||
      page.navigation_status !== 200 ||
      page.live_capture_sha256 !==
        plan.live_capture_sha256_by_slug[page.slug]
    ) {
      throw new Error(`B690 fixed six-page navigation mismatched: ${page.slug}`);
    }
    if (
      !Number.isSafeInteger(page.candidate_initial_page_content_rendered_images) ||
      page.candidate_initial_page_content_rendered_images < 0 ||
      page.live_initial_page_content_rendered_images !==
        plan.live_initial_page_content_rendered_images_by_slug[page.slug]
    ) {
      throw new Error(`B690 fixed six-page initial resource observation mismatched: ${page.slug}`);
    }
    const resource = page.resource_completion;
    if (
      resource?.status !== "complete" ||
      resource.load_ready_state !== "complete" ||
      resource.font_status !== "loaded" ||
      resource.incomplete_image_count !== 0
    ) {
      throw new Error(`B690 fixed six-page resources did not settle: ${page.slug}`);
    }
    const artifacts = page.artifact_sha256 ?? {};
    for (const [name, sha256] of Object.entries(artifacts)) {
      requireSha256(sha256, `${page.slug} ${name} artifact SHA-256`);
    }
    if (
      JSON.stringify(Object.keys(artifacts).sort()) !==
      JSON.stringify([
        "domcontentloaded_immediate",
        "settled_full_page",
        "settled_viewport",
      ])
    ) {
      throw new Error(`B690 fixed six-page artifacts mismatched: ${page.slug}`);
    }
    const comparison = requirePlainObject(
      page.comparison,
      `${page.slug} complete comparison`,
    );
    const immediateProbes = comparison.domcontentloaded_immediate_probes;
    const settledProbes = comparison.settled_probes;
    const immediateProperties =
      comparison.domcontentloaded_immediate_custom_properties;
    if (
      !Array.isArray(immediateProbes) ||
      immediateProbes.some(({ status }) => status !== "pass") ||
      !Array.isArray(settledProbes) ||
      settledProbes.some(({ status }) => status !== "pass") ||
      !Array.isArray(immediateProperties) ||
      immediateProperties.some(({ status }) => status !== "pass")
    ) {
      throw new Error(`B690 fixed six-page comparison failed: ${page.slug}`);
    }
    const initialDivergence = comparison.domcontentloaded_immediate_first_divergent_element
      ? initialDivergenceWithResourceTiming(
          page,
          comparison.domcontentloaded_immediate_first_divergent_element,
          plan,
        )
      : null;
    const settledDivergence = comparison.settled_first_divergent_element;
    if (
      [initialDivergence?.kind, settledDivergence?.kind].some((kind) =>
        ["geometry_divergence", "style_divergence"].includes(kind),
      )
    ) {
      throw new Error(
        `B690 fixed six-page first divergence found: ${page.slug}`,
      );
    }
  }
  return { verified: true, pairs_total: value.pages.length };
}

function verifyCleanup(proof, resources) {
  const value = requirePlainObject(proof, "B690 cleanup proof");
  if (
    value.public_absence_verified !== true ||
    value.fixture_identity_sha256 !== FIXTURE_IDENTITY_SHA256 ||
    !Array.isArray(resources) ||
    resources.length !== 0
  ) {
    throw new Error("B690 cleanup did not prove unchanged public state");
  }
  return {
    public_absence_verified: true,
    public_state_unchanged: true,
    fixture_identity_sha256: FIXTURE_IDENTITY_SHA256,
  };
}

export function createOpen43B690GeometryCandidateCaseSet() {
  return Object.freeze({
    id: "open43-690-geometry",
    caseIds: Object.freeze([
      OPEN43_B690_GEOMETRY_INITIAL_CASE_ID,
      OPEN43_B690_GEOMETRY_SETTLED_CASE_ID,
      OPEN43_B690_FIXED_SIX_PAGE_CASE_ID,
    ]),
    async prepareRun({
      candidateIdentity,
      privateInput,
      candidateBrowserContexts,
    }) {
      const fixture = exactFixture(privateInput);
      const policy = await readJsonObject(
        fixture.live_policy_path,
        "B690 live completion policy",
      );
      const pairs = defaultCanaryPairs({
        localOrigin: fixture.reference_local_origin,
        liveOrigin: fixture.live_origin,
      });
      const liveReference = await loadSealedLiveReference({
        filePath: fixture.live_reference_path,
        expectedSha256: fixture.live_reference_sha256,
        pairs,
        viewport: VIEWPORT,
        thresholds: DEFAULT_THRESHOLDS,
        policy,
        policySha256: fixture.live_policy_sha256,
        policyFilePath: fixture.live_policy_path,
      });
      const liveRecords = liveRecordBySlug(liveReference);
      const liveInitialDocuments = liveDocumentBySlug(liveRecords, "initial");
      const liveSettledDocuments = liveDocumentBySlug(liveRecords, "settled");
      const pageOrigin = candidatePageOrigin(candidateIdentity);
      const plan = {
        schema: "wikijump.open43_b690_geometry_candidate_plan.v3",
        case_ids: [
          OPEN43_B690_GEOMETRY_INITIAL_CASE_ID,
          OPEN43_B690_GEOMETRY_SETTLED_CASE_ID,
          OPEN43_B690_FIXED_SIX_PAGE_CASE_ID,
        ],
        page_origin: pageOrigin,
        viewport: VIEWPORT,
        thresholds: validateThresholds(DEFAULT_THRESHOLDS),
        phase: "domcontentloaded_immediate_observation",
        trace_canary_slugs: [...fixture.trace_canary_slugs],
        six_page_slugs: [...SIX_PAGE_SLUGS],
        fixture_identity_sha256: FIXTURE_IDENTITY_SHA256,
        live_reference_sha256: liveReference.sha256,
        live_policy_sha256: fixture.live_policy_sha256,
        live_trace_sha256_by_slug: Object.fromEntries(
          fixture.trace_canary_slugs.map((slug) => [
            slug,
            sha256Value(
              validateTrace(
                liveInitialDocuments[slug]?.first_divergence_trace,
                `${slug} live trace`,
              ),
            ),
          ]),
        ),
        live_initial_page_content_rendered_images_by_slug: Object.fromEntries(
          SIX_PAGE_SLUGS.map((slug) => [
            slug,
            pageContentRenderedImages(
              liveRecords[slug].capture.first_paint.document,
              `${slug} initial live document`,
            ),
          ]),
        ),
        settled_live_trace_sha256_by_slug: Object.fromEntries(
          fixture.trace_canary_slugs.map((slug) => [
            slug,
            sha256Value(
              validateTrace(
                liveSettledDocuments[slug]?.first_divergence_trace,
                `${slug} settled live trace`,
              ),
            ),
          ]),
        ),
        live_page_content_height_by_slug: Object.fromEntries(
          fixture.trace_canary_slugs.map((slug) => [
            slug,
            pageContentHeight(liveSettledDocuments[slug], `${slug} settled live document`),
          ]),
        ),
        live_capture_sha256_by_slug: Object.fromEntries(
          SIX_PAGE_SLUGS.map((slug) => [
            slug,
            sha256Value(liveRecords[slug].capture),
          ]),
        ),
      };
      return {
        sourceFiles: SOURCE_FILES,
        runtimeBindings: [],
        privateInputIdentity: {
          fixture_id: fixture.fixture_id,
          fixture_identity_sha256: FIXTURE_IDENTITY_SHA256,
          live_reference_sha256: liveReference.sha256,
          live_policy_sha256: fixture.live_policy_sha256,
        },
        browserCredentialPolicy: "none",
        plan,
        async execute() {
          await candidateBrowserContexts.setActiveFixture(
            OPEN43_B690_GEOMETRY_INITIAL_CASE_ID,
          );
          const browser = await candidateBrowserContexts.newCandidateContext({
            viewport: VIEWPORT,
          });
          const initialPages = [];
          const settledPages = [];
          const sixPages = [];
          for (const [index, canary] of STANDING_BROWSER_CANARIES.entries()) {
            const url = new URL(
              `/${encodeURI(canary.slug)}`,
              pageOrigin,
            ).href;
            const capture =
              await candidateBrowserContexts.captureCandidateObservation({
                context: browser.context,
                url,
                label: "b690-fixed-six-page",
                index,
                contract: canary,
                viewport: VIEWPORT,
                timeoutMs: 300_000,
                settleMs: 8_000,
                async onPhase(phase) {
                  await candidateBrowserContexts.setActiveFixture(
                    phase === "settled"
                      ? OPEN43_B690_GEOMETRY_SETTLED_CASE_ID
                      : OPEN43_B690_GEOMETRY_INITIAL_CASE_ID,
                  );
                },
              });
            const liveCapture = liveRecords[canary.slug].capture;
            const initialPage = {
              slug: canary.slug,
              candidate_initial_page_content_rendered_images:
                pageContentRenderedImages(
                  capture.first_paint.document,
                  `${canary.slug} initial candidate document`,
                ),
              live_initial_page_content_rendered_images:
                pageContentRenderedImages(
                  liveCapture.first_paint.document,
                  `${canary.slug} initial live document`,
                ),
            };
            const comparison = compareCaptures(
              capture,
              liveCapture,
              plan.thresholds,
              undefined,
              {
                ...canary,
                ignored_first_divergence_classes: ["page-rate-widget-box"],
              },
            );
            sixPages.push({
              slug: canary.slug,
              input_url: capture.input_url,
              final_url: capture.final_url,
              navigation_status: capture.navigation_status,
              resource_completion: capture.document.resource_completion,
              candidate_initial_page_content_rendered_images:
                initialPage.candidate_initial_page_content_rendered_images,
              live_initial_page_content_rendered_images:
                initialPage.live_initial_page_content_rendered_images,
              live_capture_sha256: sha256Value(liveCapture),
              artifact_sha256: {
                domcontentloaded_immediate: capture.first_paint.screenshot.sha256,
                settled_viewport: capture.settled_viewport_screenshot.sha256,
                settled_full_page: capture.screenshot.sha256,
              },
              comparison: {
                ...comparison,
                domcontentloaded_immediate_first_divergent_element:
                  comparison.domcontentloaded_immediate_first_divergent_element
                    ? initialDivergenceWithResourceTiming(
                        initialPage,
                        comparison.domcontentloaded_immediate_first_divergent_element,
                        plan,
                      )
                    : null,
              },
            });
            if (TRACE_CANARIES.includes(canary)) {
              initialPages.push({
                slug: canary.slug,
                input_url: url,
                final_url: capture.final_url,
                navigation_status: capture.navigation_status,
                candidate_initial_page_content_rendered_images:
                  initialPage.candidate_initial_page_content_rendered_images,
                live_initial_page_content_rendered_images:
                  initialPage.live_initial_page_content_rendered_images,
                candidate_trace:
                  capture.first_paint.document.first_divergence_trace,
                live_trace: liveInitialDocuments[canary.slug].first_divergence_trace,
              });
              settledPages.push({
                slug: canary.slug,
                input_url: url,
                final_url: capture.final_url,
                navigation_status: capture.navigation_status,
                resource_completion: capture.document.resource_completion,
                candidate_trace: capture.document.first_divergence_trace,
                live_trace: liveSettledDocuments[canary.slug].first_divergence_trace,
                candidate_page_content_height: pageContentHeight(
                  capture.document,
                  `${canary.slug} settled candidate document`,
                ),
                live_page_content_height: pageContentHeight(
                  liveSettledDocuments[canary.slug],
                  `${canary.slug} settled live document`,
                ),
              });
            }
          }
          return [
            {
              case_id: OPEN43_B690_GEOMETRY_INITIAL_CASE_ID,
              observations: {
                fixture_identity_sha256: FIXTURE_IDENTITY_SHA256,
                live_reference_sha256: liveReference.sha256,
                live_policy_sha256: fixture.live_policy_sha256,
                phase: "domcontentloaded_immediate_observation",
                sequence: 1,
                browser_environment: browser.environment,
                pages: initialPages,
              },
            },
            {
              case_id: OPEN43_B690_GEOMETRY_SETTLED_CASE_ID,
              observations: {
                fixture_identity_sha256: FIXTURE_IDENTITY_SHA256,
                live_reference_sha256: liveReference.sha256,
                live_policy_sha256: fixture.live_policy_sha256,
                phase: "settled",
                sequence: 2,
                browser_environment: browser.environment,
                pages: settledPages,
              },
            },
            {
              case_id: OPEN43_B690_FIXED_SIX_PAGE_CASE_ID,
              observations: {
                fixture_identity_sha256: FIXTURE_IDENTITY_SHA256,
                live_reference_sha256: liveReference.sha256,
                live_policy_sha256: fixture.live_policy_sha256,
                sequence: 3,
                viewport: VIEWPORT,
                browser_environment: browser.environment,
                pages: sixPages,
              },
            },
          ];
        },
        async cleanup() {
          return {
            public_absence_verified: true,
            fixture_identity_sha256: FIXTURE_IDENTITY_SHA256,
          };
        },
        verifyCase(caseId, observations) {
          if (caseId === OPEN43_B690_GEOMETRY_INITIAL_CASE_ID) {
            return verifyOpen43B690GeometryInitial(observations, this.plan);
          }
          if (caseId === OPEN43_B690_GEOMETRY_SETTLED_CASE_ID) {
            return verifyOpen43B690GeometrySettled(observations, this.plan);
          }
          if (caseId === OPEN43_B690_FIXED_SIX_PAGE_CASE_ID) {
            return verifyOpen43B690FixedSixPage(observations, this.plan);
          }
          throw new Error(`unknown B690 case: ${caseId}`);
        },
        verifyCleanup,
      };
    },
  });
}
