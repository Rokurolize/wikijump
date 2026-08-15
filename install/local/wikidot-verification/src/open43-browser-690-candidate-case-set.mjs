import {
  STANDING_BROWSER_CANARIES,
  defaultCanaryPairs,
} from "./standing-browser-canaries.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { compareFirstDivergenceTraces } from "./first-divergent-element.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import { captureDocumentObservation } from "./standing-browser-parity-observation.mjs";
import { loadSealedLiveReference } from "./standing-browser-parity-reference.mjs";
import {
  DEFAULT_THRESHOLDS,
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

function liveTraceBySlug(liveReference) {
  return Object.fromEntries(
    liveReference.records
      .filter(({ input }) =>
        OPEN43_B690_GEOMETRY_FIXTURE.trace_canary_slugs.includes(
          new URL(input.live_url).pathname.slice(1),
        ),
      )
      .map(({ input, capture }) => [
        decodeURIComponent(new URL(input.live_url).pathname.slice(1)),
        capture.first_paint.document.first_divergence_trace,
      ]),
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

export function verifyOpen43B690GeometryInitial(observations, plan) {
  const value = requirePlainObject(
    observations,
    "B690_GEOMETRY_INITIAL observations",
  );
  if (
    value.fixture_identity_sha256 !== plan.fixture_identity_sha256 ||
    value.live_reference_sha256 !== plan.live_reference_sha256 ||
    value.live_policy_sha256 !== plan.live_policy_sha256 ||
    value.phase !== "domcontentloaded_immediate_observation" ||
    value.sequence !== 1 ||
    !Array.isArray(value.pages) ||
    value.pages.length !== plan.trace_canary_slugs.length
  ) {
    throw new Error("B690 initial geometry denominator or identity mismatched");
  }
  requireSha256(
    value.browser_environment.executable_sha256,
    "B690 browser executable SHA-256",
  );
  if (
    JSON.stringify(value.pages.map(({ slug }) => slug)) !==
    JSON.stringify(plan.trace_canary_slugs)
  ) {
    throw new Error("B690 initial geometry page order mismatched");
  }

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
      throw new Error(`B690 initial navigation mismatched: ${page.slug}`);
    }
    const liveTrace = validateTrace(
      page.live_trace,
      `${page.slug} live trace`,
    );
    if (
      sha256Value(liveTrace) !== plan.live_trace_sha256_by_slug[page.slug]
    ) {
      throw new Error(`B690 live trace identity mismatched: ${page.slug}`);
    }
    const candidateTrace = validateTrace(
      page.candidate_trace,
      `${page.slug} candidate trace`,
    );
    const classification = compareFirstDivergenceTraces(
      candidateTrace,
      liveTrace,
      plan.thresholds,
    );
    if (!new Set(["none", "resource_incomplete"]).has(classification.kind)) {
      throw new Error(
        `B690 first divergence found for ${page.slug}: ${classification.kind}`,
      );
    }
    classifications.push({ slug: page.slug, ...classification });
  }
  return {
    verified: true,
    phase: value.phase,
    ordered_trace_count: classifications.length,
    classifications,
  };
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
    caseIds: Object.freeze([OPEN43_B690_GEOMETRY_INITIAL_CASE_ID]),
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
      const liveTraces = liveTraceBySlug(liveReference);
      const pageOrigin = candidatePageOrigin(candidateIdentity);
      const plan = {
        schema: "wikijump.open43_b690_geometry_candidate_plan.v1",
        case_ids: [OPEN43_B690_GEOMETRY_INITIAL_CASE_ID],
        page_origin: pageOrigin,
        viewport: VIEWPORT,
        thresholds: validateThresholds(DEFAULT_THRESHOLDS),
        phase: "domcontentloaded_immediate_observation",
        trace_canary_slugs: [...fixture.trace_canary_slugs],
        fixture_identity_sha256: FIXTURE_IDENTITY_SHA256,
        live_reference_sha256: liveReference.sha256,
        live_policy_sha256: fixture.live_policy_sha256,
        live_trace_sha256_by_slug: Object.fromEntries(
          fixture.trace_canary_slugs.map((slug) => [
            slug,
            sha256Value(validateTrace(liveTraces[slug], `${slug} live trace`)),
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
          const pages = [];
          for (const canary of TRACE_CANARIES) {
            const url = new URL(
              `/${encodeURI(canary.slug)}`,
              pageOrigin,
            ).href;
            const page = await browser.context.newPage();
            try {
              const response = await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 300_000,
              });
              const observation = await captureDocumentObservation(page, {
                contract: {
                  first_divergence_trace: canary.first_divergence_trace,
                },
                phase: "domcontentloaded_immediate_observation",
                viewport: VIEWPORT,
              });
              pages.push({
                slug: canary.slug,
                input_url: url,
                final_url: page.url(),
                navigation_status: response?.status() ?? 0,
                candidate_trace: observation.first_divergence_trace,
                live_trace: liveTraces[canary.slug],
              });
            } finally {
              await page.close();
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
                pages,
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
          if (caseId !== OPEN43_B690_GEOMETRY_INITIAL_CASE_ID) {
            throw new Error(`unknown B690 case: ${caseId}`);
          }
          return verifyOpen43B690GeometryInitial(observations, this.plan);
        },
        verifyCleanup,
      };
    },
  });
}
