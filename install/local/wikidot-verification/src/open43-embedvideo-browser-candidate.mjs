import { createHash } from "node:crypto";
import fs from "node:fs";

import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import {
  requireNonEmptyString,
  requirePlainObject,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

const AUDIT = JSON.parse(
  fs.readFileSync(
    new URL("../../../../docs/development/open43-m-closure-audit.json", import.meta.url),
    "utf8",
  ),
);
const ROW = AUDIT.issues
  .find(({ issue }) => issue === 1042)
  ?.subrows.find(({ case_id }) => case_id === "M1042_BROWSER_LIFECYCLE");

if (
  ROW?.classification !== "candidate_required" ||
  !ROW.next_command_ids.includes("C_MEDIA_BROWSER_CANDIDATE")
) {
  throw new Error("issue 1042 browser candidate row is not actionable");
}

export const OPEN43_EMBEDVIDEO_BROWSER_CASE_IDS = Object.freeze([ROW.case_id]);

const SITE_SLUG = "scpaiueouiuiuiui";
const VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const NARROW_VIEWPORT = Object.freeze({ width: 640, height: 900 });
const TIMEOUT_MS = 300_000;
const PROVIDER_ORIGINS = Object.freeze([
  "https://www.youtube.com",
  "https://embed.acast.com",
]);
const YOUTUBE_URL = "https://www.youtube.com/embed/4sroHOHlkAk";
const ACAST_URL = "https://embed.acast.com/624e90f06b1d87001240baa8?episode-order=desc";
const UNSAFE_URL = "https://example.com/open43-embedvideo-unsafe";
const POSITIVE_SOURCE = [
  "[[embedvideo]]",
  `<iframe width="560" height="315" src="${YOUTUBE_URL}" frameborder="0" allowfullscreen></iframe>`,
  "[[/embedvideo]]",
  "[[embedvideo]]",
  `<iframe src="${ACAST_URL}" frameBorder="0" width="100%" height="80px"></iframe>`,
  "[[/embedvideo]]",
].join("\n");
const NEGATIVE_SOURCE = [
  "[[embedvideo]]",
  `<iframe src="${UNSAFE_URL}" width="560" height="315"></iframe>`,
  "[[/embedvideo]]",
].join("\n");
const CAPTURE_CONTRACT = Object.freeze({});
const EXPECTED_FRAMES = Object.freeze([
  Object.freeze({
    src: YOUTUBE_URL,
    width: "560",
    height: "315",
    allow: null,
    allowfullscreen: "allowfullscreen",
    frameborder: "0",
  }),
  Object.freeze({
    src: ACAST_URL,
    width: "100%",
    height: "80px",
    allow: null,
    allowfullscreen: null,
    frameborder: "0",
  }),
]);
const FIXTURE_PROVENANCE = Object.freeze({
  evidence: Object.freeze(Object.fromEntries(
    ["E_EMBED_ANALYSIS", "E_FOCUSED_CORPUS"].map((id) => {
      const evidence = AUDIT.evidence_registry?.[id];
      if (!evidence?.path || !/^[0-9a-f]{64}$/u.test(evidence.sha256)) {
        throw new Error(`issue 1042 evidence registry entry is invalid: ${id}`);
      }
      return [id, Object.freeze({ path: evidence.path, sha256: evidence.sha256 })];
    }),
  )),
  youtube_case_id: "focused-embedvideo-corpus-3-theresacactusinthecorner",
  acast_case_id: "focused-embedvideo-corpus-10-the-trolley-solution-hub",
  unsafe_contract_test:
    "deepwell/tests/media.rs::embedvideo_preview_fails_closed_for_unsupported_media",
  csp_contract_test: "framerail/tests/wikidot-csp-config.test.js",
});

const object = (value, name) => requirePlainObject(value, name);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const BROWSER_PLAN = Object.freeze({
  positive_source: POSITIVE_SOURCE,
  negative_source: NEGATIVE_SOURCE,
  capture_contract: CAPTURE_CONTRACT,
  fixture_provenance: FIXTURE_PROVENANCE,
  required_request_url_sha256: Object.freeze([
    sha256(YOUTUBE_URL),
    sha256(ACAST_URL),
  ]),
  forbidden_request_url_sha256: Object.freeze([sha256(UNSAFE_URL)]),
});

function installBrowserProbe() {
  const snapshot = () => {
    const frames = [...document.querySelectorAll("#page-content iframe")];
    const active = document.activeElement;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      active_element: active?.id ? `#${active.id}` : active?.localName ?? "",
      frames: frames.map((frame) => ({
        src: frame.getAttribute("src"),
        width: frame.getAttribute("width"),
        height: frame.getAttribute("height"),
        allow: frame.getAttribute("allow"),
        allowfullscreen: frame.getAttribute("allowfullscreen"),
        frameborder: frame.getAttribute("frameborder"),
        tab_index: frame.tabIndex,
        rect: {
          width: Math.round(frame.getBoundingClientRect().width * 100) / 100,
          height: Math.round(frame.getBoundingClientRect().height * 100) / 100,
        },
      })),
    };
  };
  globalThis.__open43EmbedVideoDocumentIdentity = crypto.randomUUID();
  globalThis.__open43EmbedVideoSnapshot = snapshot;
  globalThis.__open43EmbedVideoCspViolations = [];
  addEventListener("securitypolicyviolation", (event) => {
    globalThis.__open43EmbedVideoCspViolations.push({
      blocked_uri: event.blockedURI,
      effective_directive: event.effectiveDirective,
      disposition: event.disposition,
    });
  });
  addEventListener(
    "DOMContentLoaded",
    () => {
      globalThis.__open43EmbedVideoInitial = snapshot();
    },
    { once: true },
  );
}

function observedUrl(value) {
  const url = new URL(value);
  return {
    origin: url.origin,
    pathname: url.pathname,
    url_sha256: sha256(url.href),
  };
}

function iframeCount(html) {
  return html.match(/<iframe\b/gu)?.length ?? 0;
}

function cspFrameSources(header) {
  const directive = String(header ?? "")
    .split(";")
    .map((value) => value.trim().split(/\s+/u))
    .find(([name]) => name.toLowerCase() === "frame-src");
  return directive?.slice(1) ?? [];
}

async function preview(session, siteId, source, title) {
  const result = await session.rpc(
    "wikidot_page_preview",
    { site_id: siteId, title, wikitext: source },
    { actor: "anonymous", siteId },
  );
  const body = requireNonEmptyString(result?.body, `${title} preview body`);
  return { body_sha256: sha256(body), iframe_count: iframeCount(body) };
}

async function createPage(session, resources, pages, siteId, slug, source) {
  const marker = `candidate-case-owner:${slug}`;
  const before = await session.rpc(
    "page_get",
    { site_id: siteId, page: slug, details: { wikitext: false, compiled: false } },
    { actor: "anonymous", siteId, page: slug },
  );
  if (before !== null) throw new Error(`${slug} run-owned namespace already exists`);
  const resource = resources.register("page", { slug, marker });
  const fixture = {
    page_id: null,
    revision_id: null,
    slug,
    marker,
    resource,
  };
  pages.push(fixture);
  const page = await session.rpc("page_create", {
    site_id: siteId,
    slug,
    title: marker,
    alt_title: null,
    wikitext: source,
    layout: "wikidot",
    user_id: session.editorUserId,
    ip_address: "127.0.0.1",
    tags: [],
    revision_comments: "Open43 EmbedVideo browser candidate fixture",
  });
  if (!Number.isSafeInteger(page?.page_id) || page.slug !== slug) {
    throw new Error(`${slug} fixture page identity is missing`);
  }
  fixture.page_id = page.page_id;
  fixture.revision_id = page.revision_id;
  const visible = await session.rpc(
    "page_get",
    { site_id: siteId, page: slug, details: { wikitext: true, compiled: false } },
    { actor: "anonymous", siteId, page: slug },
  );
  if (visible?.page_id !== page.page_id || visible.title !== marker) {
    throw new Error(`${slug} fixture page is not anonymously readable`);
  }
  return fixture;
}

async function browserLifecycle(browser, pageOrigin, positive, negative, plan) {
  const owner = await browser.newCandidateContext({ viewport: VIEWPORT });
  const page = await owner.context.newPage();
  const network = [];
  const consoleErrors = [];
  const pageErrors = [];
  let cspHeader = null;
  let negativeInitial = null;
  const record = (event, request, extra = {}) =>
    network.push({
      event,
      method: request.method(),
      resource_type: request.resourceType(),
      url: observedUrl(request.url()),
      ...extra,
    });
  page.on("request", (request) => record("request", request));
  page.on("response", (response) =>
    record("response", response.request(), { status: response.status() }),
  );
  page.on("requestfailed", (request) =>
    record("requestfailed", request, {
      failure_sha256: sha256(request.failure()?.errorText ?? "request failed"),
    }),
  );
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(sha256(message.text()));
  });
  page.on("pageerror", (error) => pageErrors.push(sha256(error.message)));
  let observation = null;
  try {
    await page.addInitScript(installBrowserProbe);
    const positiveUrl = new URL(`/${encodeURIComponent(positive.slug)}`, pageOrigin).href;
    const negativeUrl = new URL(`/${encodeURIComponent(negative.slug)}`, pageOrigin).href;
    const positiveCapture = await browser.captureCandidateObservation({
      context: owner.context,
      page,
      url: positiveUrl,
      label: "open43-embedvideo-positive",
      index: 0,
      contract: plan.capture_contract,
      viewport: VIEWPORT,
      timeoutMs: TIMEOUT_MS,
      settleMs: 0,
      navigate: async ({ page: target, url, timeoutMs }) => {
        const response = await target.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        });
        cspHeader = response?.headers()["content-security-policy"] ?? null;
        return response;
      },
      onPhase: (phase) =>
        browser.setActiveFixture(
          `M1042_BROWSER_LIFECYCLE_POSITIVE_${phase === "settled" ? "SETTLED" : "INITIAL"}`,
        ),
    });
    if (positiveCapture.capture_error) throw new Error("positive EmbedVideo capture failed");
    const positiveInitial = await page.evaluate(
      () => globalThis.__open43EmbedVideoInitial,
    );
    const positiveSettled = await page.evaluate(
      () => globalThis.__open43EmbedVideoSnapshot(),
    );
    await page.setViewportSize(NARROW_VIEWPORT);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const positiveNarrow = await page.evaluate(
      () => globalThis.__open43EmbedVideoSnapshot(),
    );
    await page.setViewportSize(VIEWPORT);
    const positiveFocused = await page.evaluate(() => {
      document.querySelector("#page-content iframe")?.focus();
      return globalThis.__open43EmbedVideoSnapshot();
    });
    await page.reload({ waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    const positiveReload = await page.evaluate(
      () => globalThis.__open43EmbedVideoSnapshot(),
    );
    const documentIdentity = await page.evaluate(
      () => globalThis.__open43EmbedVideoDocumentIdentity,
    );
    const negativeCapture = await browser.captureCandidateObservation({
      context: owner.context,
      page,
      url: negativeUrl,
      label: "open43-embedvideo-negative-navigation",
      index: 1,
      contract: plan.capture_contract,
      viewport: VIEWPORT,
      timeoutMs: TIMEOUT_MS,
      settleMs: 0,
      navigate: async ({ page: target, url, timeoutMs }) => {
        await target.evaluate((href) => {
          const link = document.createElement("a");
          link.id = "open43-embedvideo-client-navigation";
          link.href = href;
          document.body.append(link);
          link.click();
        }, url);
        await target.waitForURL(url, { timeout: timeoutMs });
        negativeInitial = await target.evaluate(
          () => globalThis.__open43EmbedVideoSnapshot(),
        );
        return { status: 200 };
      },
      onPhase: (phase) =>
        browser.setActiveFixture(
          `M1042_BROWSER_LIFECYCLE_NEGATIVE_${phase === "settled" ? "SETTLED" : "INITIAL"}`,
        ),
    });
    if (negativeCapture.capture_error) throw new Error("negative EmbedVideo capture failed");
    const negativeSettled = await page.evaluate(
      () => globalThis.__open43EmbedVideoSnapshot(),
    );
    const finalDocumentIdentity = await page.evaluate(
      () => globalThis.__open43EmbedVideoDocumentIdentity,
    );
    const cspViolations = await page.evaluate(
      () => globalThis.__open43EmbedVideoCspViolations,
    );
    observation = {
      positive: {
        capture: positiveCapture,
        initial_frame: positiveInitial,
        settled_frame: positiveSettled,
        narrow_frame: positiveNarrow,
        focused_frame: positiveFocused,
        reload_frame: positiveReload,
      },
      negative: {
        capture: negativeCapture,
        initial_frame: negativeInitial,
        settled_frame: negativeSettled,
      },
      navigation: {
        from: positiveUrl,
        to: negativeUrl,
        preserved_document: documentIdentity === finalDocumentIdentity,
      },
      csp_header_sha256: sha256(String(cspHeader ?? "")),
      csp_frame_sources: cspFrameSources(cspHeader),
      csp_violations: cspViolations,
      console_errors: consoleErrors,
      page_errors: pageErrors,
      network,
      cleanup: { page_closed: false },
    };
  } finally {
    await page.close().catch(() => undefined);
    if (observation !== null) observation.cleanup.page_closed = page.isClosed();
  }
  return observation;
}

function capturePhase(capture, name, expectedUrl) {
  const value = object(capture, name);
  const initial = object(value.first_paint?.document, `${name}.first_paint.document`);
  const settled = object(value.document, `${name}.document`);
  if (
    value.capture_error ||
    value.navigation_status !== 200 ||
    value.final_url !== expectedUrl ||
    initial.phase !== "domcontentloaded_immediate_observation" ||
    settled.phase !== "settled" ||
    !["complete", "bounded_domcontentloaded"].includes(
      settled.resource_completion?.status,
    )
  ) {
    throw new Error(`${name} did not capture both successful browser intervals`);
  }
  return { initial, settled };
}

function verifyNetwork(observation, expected) {
  if (!Array.isArray(observation.network)) throw new Error("network observation is missing");
  const events = new Map();
  for (const event of observation.network) {
    const hash = event?.url?.url_sha256;
    if (typeof hash !== "string") continue;
    if (!events.has(hash)) events.set(hash, new Set());
    events.get(hash).add(event.event);
  }
  for (const hash of expected.required_request_url_sha256) {
    const lifecycle = events.get(hash);
    if (!lifecycle?.has("request") || (!lifecycle.has("response") && !lifecycle.has("requestfailed"))) {
      throw new Error("a required EmbedVideo request has no observed load or error outcome");
    }
  }
  for (const hash of expected.forbidden_request_url_sha256) {
    if (events.has(hash)) throw new Error("fail-closed EmbedVideo issued a forbidden request");
  }
}

function providerFrames(snapshot, name) {
  const value = object(snapshot, name);
  if (!Array.isArray(value.frames)) throw new Error(`${name} frames are missing`);
  const attributes = value.frames.map((frame) => ({
    src: frame.src,
    width: frame.width,
    height: frame.height,
    allow: frame.allow,
    allowfullscreen: frame.allowfullscreen,
    frameborder: frame.frameborder,
  }));
  if (JSON.stringify(attributes) !== JSON.stringify(EXPECTED_FRAMES)) {
    throw new Error(`${name} does not contain the evidenced provider frames`);
  }
  return value;
}

function noProviderFrames(snapshot, name) {
  const value = object(snapshot, name);
  if (!Array.isArray(value.frames) || value.frames.length !== 0) {
    throw new Error(`${name} retained a fail-closed provider frame`);
  }
  return value;
}

export function verifyOpen43EmbedVideoBrowserCase(observations) {
  const value = object(observations, "M1042_BROWSER_LIFECYCLE observations");
  capturePhase(
    value.browser?.positive?.capture,
    "positive capture",
    value.browser?.navigation?.from,
  );
  capturePhase(
    value.browser?.negative?.capture,
    "negative capture",
    value.browser?.navigation?.to,
  );
  if (
    value.preview?.positive?.iframe_count !== EXPECTED_FRAMES.length ||
    value.preview?.negative?.iframe_count !== 0
  ) {
    throw new Error("EmbedVideo positive or fail-closed iframe boundary is wrong");
  }
  const positiveSettled = providerFrames(
    value.browser?.positive?.settled_frame,
    "positive settled frame",
  );
  const positiveNarrow = providerFrames(
    value.browser?.positive?.narrow_frame,
    "positive narrow frame",
  );
  for (const [name, snapshot] of [
    ["positive initial frame", value.browser?.positive?.initial_frame],
    ["positive focused frame", value.browser?.positive?.focused_frame],
    ["positive reload frame", value.browser?.positive?.reload_frame],
  ]) {
    providerFrames(snapshot, name);
  }
  noProviderFrames(value.browser?.negative?.initial_frame, "negative initial frame");
  noProviderFrames(value.browser?.negative?.settled_frame, "negative settled frame");
  const cspFrameSources = value.browser?.csp_frame_sources;
  if (
    positiveNarrow.viewport?.width !== NARROW_VIEWPORT.width ||
    !Number.isFinite(positiveSettled.frames[1]?.rect?.width) ||
    !Number.isFinite(positiveNarrow.frames[1]?.rect?.width) ||
    positiveNarrow.frames[1].rect.width >= positiveSettled.frames[1].rect.width ||
    value.browser.positive.focused_frame.active_element !== "iframe" ||
    value.browser.navigation?.preserved_document !== true ||
    value.browser.cleanup?.page_closed !== true ||
    value.browser.csp_violations?.length !== 0 ||
    !Array.isArray(cspFrameSources) ||
    PROVIDER_ORIGINS.some((origin) => !cspFrameSources.includes(origin)) ||
    cspFrameSources.some((source) => ["*", "https:", "data:"].includes(source))
  ) {
    throw new Error("EmbedVideo resize, focus, navigation, CSP, or cleanup contract failed");
  }
  verifyNetwork(value.browser, BROWSER_PLAN);
  return {
    verified: true,
    page_preview_verified: true,
    saved_intervals_verified: true,
    load_or_error_outcome_verified: true,
    negative_boundary_verified: true,
  };
}

class EmbedVideoBrowserRun {
  #session;
  #browser;
  #resources;
  #plan;
  #runId;
  #siteId = null;
  #pages = [];

  constructor({ session, browser, resources, plan, runId }) {
    this.#session = session;
    this.#browser = browser;
    this.#resources = resources;
    this.#plan = plan;
    this.#runId = runId;
  }

  async execute() {
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG });
    if (!Number.isSafeInteger(site?.site_id)) {
      throw new Error(`editable candidate site ${SITE_SLUG} is missing`);
    }
    this.#siteId = site.site_id;
    const suffix = this.#runId.slice("candidate-run-".length);
    const positiveSlug = `open43-embedvideo-${suffix}-positive`;
    const negativeSlug = `open43-embedvideo-${suffix}-negative`;
    const [positivePreview, negativePreview] = await Promise.all([
      preview(this.#session, this.#siteId, this.#plan.positive_source, "positive EmbedVideo"),
      preview(this.#session, this.#siteId, this.#plan.negative_source, "negative EmbedVideo"),
    ]);
    const positive = await createPage(
      this.#session,
      this.#resources,
      this.#pages,
      this.#siteId,
      positiveSlug,
      `${this.#plan.positive_source}\n[[[${negativeSlug}|Fail-closed EmbedVideo]]]`,
    );
    const negative = await createPage(
      this.#session,
      this.#resources,
      this.#pages,
      this.#siteId,
      negativeSlug,
      `${this.#plan.negative_source}\n[[[${positiveSlug}|Supported EmbedVideo]]]`,
    );
    const browser = await browserLifecycle(
      this.#browser,
      this.#session.pageOrigin,
      positive,
      negative,
      this.#plan,
    );
    return [
      {
        case_id: ROW.case_id,
        observations: {
          preview: { positive: positivePreview, negative: negativePreview },
          browser,
        },
      },
    ];
  }

  async cleanup() {
    const failures = [];
    const pages = [];
    for (const fixture of [...this.#pages].reverse()) {
      try {
        const current = await this.#session.rpc(
          "page_get",
          {
            site_id: this.#siteId,
            page: fixture.slug,
            details: { wikitext: true, compiled: false },
          },
          {
            actor: "anonymous",
            siteId: this.#siteId,
            page: fixture.slug,
            cleanup: true,
          },
        );
        if (
          current !== null &&
          (fixture.page_id === null || current?.page_id === fixture.page_id) &&
          current.title === fixture.marker
        ) {
          await this.#session.rpc(
            "page_delete",
            {
              site_id: this.#siteId,
              page: current.page_id,
              last_revision_id: current.revision_id,
              revision_comments: "Open43 EmbedVideo browser candidate cleanup",
              user_id: this.#session.editorUserId,
              ip_address: "127.0.0.1",
            },
            { cleanup: true },
          );
        } else if (current !== null) {
          throw new Error(`${fixture.slug} cleanup identity changed`);
        }
        const after = await this.#session.rpc(
          "page_get",
          {
            site_id: this.#siteId,
            page: fixture.slug,
            details: { wikitext: false, compiled: false },
          },
          {
            actor: "anonymous",
            siteId: this.#siteId,
            page: fixture.slug,
            cleanup: true,
          },
        );
        if (after !== null) throw new Error(`${fixture.slug} remained after cleanup`);
        this.#resources.release(fixture.resource, {
          page_slug: fixture.slug,
          page_get: null,
        });
        pages.push({ slug: fixture.slug, page_get: null });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "EmbedVideo browser cleanup failed");
    }
    return { pages, public_absence_verified: true };
  }
}

function verifyCleanup(proof, resources) {
  if (
    proof?.public_absence_verified !== true ||
    !Array.isArray(proof.pages) ||
    proof.pages.length !== 2 ||
    proof.pages.some(({ page_get }) => page_get !== null) ||
    resources.length !== 2 ||
    resources.some(({ released }) => released !== true)
  ) {
    throw new Error("EmbedVideo browser cleanup did not prove both pages absent");
  }
  return { public_absence_verified: true, page_count: 2, resource_count: 2 };
}

const SOURCE_FILES = Object.freeze([
  ...new Set([
    ...STANDING_BROWSER_EXECUTION_MODULES,
    "docs/development/open43-m-closure-audit.json",
    "deepwell/tests/media.rs",
    "framerail/svelte.config.js",
    "framerail/tests/wikidot-csp-config.test.js",
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-http.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/open43-embedvideo-browser-candidate.mjs",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]),
]);

export function createOpen43EmbedVideoBrowserCandidateCaseSet({
  sessionFactory = (options) => new CandidateHttpSession(options),
} = {}) {
  return Object.freeze({
    id: "open43-embedvideo-browser",
    caseIds: OPEN43_EMBEDVIDEO_BROWSER_CASE_IDS,
    prepareRun({
      runId,
      candidateIdentity,
      privateInput,
      signal,
      resources,
      candidateBrowserContexts,
    }) {
      if (
        candidateIdentity.candidate.endpoint.host !== `${SITE_SLUG}.wikijump.localhost` ||
        candidateIdentity.candidate.endpoint.port === 443 ||
        candidateIdentity.candidate.port_443_published !== false
      ) {
        throw new Error(`issue 1042 requires the exact non-standing ${SITE_SLUG} candidate`);
      }
      const plan = BROWSER_PLAN;
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      const execution = new EmbedVideoBrowserRun({
        session,
        browser: candidateBrowserContexts,
        resources,
        plan,
        runId,
      });
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: {
          ...session.privateInputIdentity,
          embedvideo_browser_fixture_sha256: sha256Value({
            positive_source_sha256: sha256(plan.positive_source),
            negative_source_sha256: sha256(plan.negative_source),
            capture_contract: plan.capture_contract,
            fixture_provenance: plan.fixture_provenance,
            provider_origins: PROVIDER_ORIGINS,
            required_request_url_sha256: plan.required_request_url_sha256,
            forbidden_request_url_sha256: plan.forbidden_request_url_sha256,
          }),
        },
        browserCredentialPolicy: "none",
        browserPublicOrigins: PROVIDER_ORIGINS,
        plan: {
          schema: "wikijump.open43_embedvideo_browser_candidate_plan.v1",
          site_slug: SITE_SLUG,
          case_ids: OPEN43_EMBEDVIDEO_BROWSER_CASE_IDS,
          source_sha256: {
            positive: sha256(plan.positive_source),
            negative: sha256(plan.negative_source),
          },
          capture_contract: plan.capture_contract,
          fixture_provenance: plan.fixture_provenance,
          provider_origins: PROVIDER_ORIGINS,
          required_request_url_sha256: plan.required_request_url_sha256,
          forbidden_request_url_sha256: plan.forbidden_request_url_sha256,
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (_caseId, observations) =>
          verifyOpen43EmbedVideoBrowserCase(observations),
        verifyCleanup,
      });
    },
  });
}
