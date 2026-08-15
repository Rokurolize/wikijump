import { STANDING_BROWSER_CANARIES } from "./standing-browser-canaries.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import {
  requirePlainObject,
  requireSha256,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_B689_TABVIEW_INITIAL_CASE_ID = "B689_TABVIEW_INITIAL";

export const OPEN43_B689_TABVIEW_FIXTURE = Object.freeze({
  fixture_id: "open43-standing-browser-tabview-canaries",
  source_path: "install/local/wikidot-verification/src/standing-browser-canaries.mjs",
  source_sha256: "bbb9e4f9776206c2f832a0523e77d4b1e0553ea4003d6dfeb6ed82a8bf91e259",
  canary_slugs: Object.freeze(["theme:basalt", "scp-8980"]),
});

const VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const CANARIES = Object.freeze(
  OPEN43_B689_TABVIEW_FIXTURE.canary_slugs.map((slug) =>
    STANDING_BROWSER_CANARIES.find((canary) => canary.slug === slug),
  ),
);
const FIXTURE_IDENTITY_SHA256 = sha256Value(OPEN43_B689_TABVIEW_FIXTURE);

const SOURCE_FILES = Object.freeze([
  ...new Set([
    ...STANDING_BROWSER_EXECUTION_MODULES,
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
    "install/local/wikidot-verification/src/open43-browser-689-candidate-case-set.mjs",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
    "deepwell/src/services/render/service.rs",
    "framerail/src/lib/wikidot/wikidot-tabviews.ts",
    "framerail/package.json",
    "framerail/pnpm-lock.yaml",
  ]),
]);

function exactFixture(privateInput) {
  const fixture = requirePlainObject(privateInput.fixture, "private input fixture");
  if (sha256Value(fixture) !== FIXTURE_IDENTITY_SHA256) {
    throw new Error("private input fixture is not the sealed B689 canary fixture");
  }
  return fixture;
}

function rectangle(element) {
  const value = element.getBoundingClientRect();
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function styles(element) {
  const value = getComputedStyle(element);
  return {
    display: value.display,
    visibility: value.visibility,
    font_family: value.fontFamily,
    font_size: value.fontSize,
  };
}

async function observeTabviews(page) {
  return await page.evaluate(() => {
    const roots = [...document.querySelectorAll("#page-content .yui-navset")];
    return {
      tabview_count: roots.length,
      tabviews: roots.map((root) => {
        const nav = root.querySelector(":scope > .yui-nav");
        const content = root.querySelector(":scope > .yui-content");
        const tabs = nav ? [...nav.children].filter((item) => item.tagName === "LI") : [];
        const panels = content ? [...content.children] : [];
        return {
          class_name: root.className,
          styles: styles(root),
          rectangle: rectangle(root),
          tab_count: tabs.length,
          selected_count: tabs.filter((tab) => tab.classList.contains("selected")).length,
          visible_panel_count: panels.filter((panel) => getComputedStyle(panel).display !== "none").length,
          panel_count: panels.length,
          nav_styles: nav ? styles(nav) : null,
          content_styles: content ? styles(content) : null,
          first_panel_styles: panels[0] ? styles(panels[0]) : null,
          first_panel_rectangle: panels[0] ? rectangle(panels[0]) : null,
        };
      }),
      resource_state: {
        document_ready_state: document.readyState,
        stylesheet_count: document.styleSheets.length,
        image_count: document.images.length,
        incomplete_image_count: [...document.images].filter((image) => !image.complete).length,
        font_status: document.fonts?.status ?? null,
        resource_entry_count: performance.getEntriesByType("resource").length,
      },
    };
  });
}

function positiveRectangle(value, name) {
  const rectangleValue = requirePlainObject(value, name);
  for (const field of ["x", "y", "width", "height"]) {
    if (typeof rectangleValue[field] !== "number" || !Number.isFinite(rectangleValue[field])) {
      throw new Error(`${name}.${field} is not a finite number`);
    }
  }
  if (rectangleValue.width <= 0 || rectangleValue.height <= 0) {
    throw new Error(`${name} has no visible geometry`);
  }
  return rectangleValue;
}

function verifyPage(page, expectedUrl) {
  if (
    page.navigation_status !== 200 ||
    page.final_url !== expectedUrl ||
    page.console_error_count !== 0 ||
    page.request_failure_count !== 0 ||
    page.http_error_count !== 0
  ) {
    throw new Error(`B689 initial browser page mismatched: ${page.slug}`);
  }
  const observation = requirePlainObject(page.observation, `${page.slug} tabview observation`);
  if (observation.tabview_count < 1 || !Array.isArray(observation.tabviews)) {
    throw new Error(`B689 tabview is missing: ${page.slug}`);
  }
  for (const [index, tabview] of observation.tabviews.entries()) {
    if (
      tabview.tab_count < 1 ||
      tabview.tab_count !== tabview.panel_count ||
      tabview.selected_count !== 1 ||
      tabview.visible_panel_count !== 1 ||
      tabview.styles?.visibility !== "visible"
    ) {
      throw new Error(`B689 tabview structure mismatched: ${page.slug} #${index}`);
    }
    positiveRectangle(tabview.rectangle, `${page.slug} tabview #${index} rectangle`);
    positiveRectangle(tabview.first_panel_rectangle, `${page.slug} first panel #${index} rectangle`);
    requirePlainObject(tabview.nav_styles, `${page.slug} nav styles`);
    requirePlainObject(tabview.content_styles, `${page.slug} content styles`);
    requirePlainObject(tabview.first_panel_styles, `${page.slug} first panel styles`);
  }
  const resourceState = requirePlainObject(observation.resource_state, `${page.slug} resource state`);
  if (
    typeof resourceState.document_ready_state !== "string" ||
    typeof resourceState.stylesheet_count !== "number" ||
    typeof resourceState.image_count !== "number" ||
    typeof resourceState.incomplete_image_count !== "number" ||
    typeof resourceState.resource_entry_count !== "number"
  ) {
    throw new Error(`B689 resource state is incomplete: ${page.slug}`);
  }
}

export function verifyOpen43B689TabviewInitial(observations, plan) {
  const value = requirePlainObject(observations, "B689_TABVIEW_INITIAL observations");
  if (
    value.fixture_identity_sha256 !== plan.fixture_identity_sha256 ||
    value.phase !== "domcontentloaded_immediate_observation" ||
    value.sequence !== 1 ||
    !Array.isArray(value.pages) ||
    value.pages.length !== OPEN43_B689_TABVIEW_FIXTURE.canary_slugs.length
  ) {
    throw new Error("B689 initial tabview denominator or phase mismatched");
  }
  requireSha256(value.browser_environment.executable_sha256, "B689 browser executable SHA-256");
  const pages = new Map(value.pages.map((page) => [page.slug, page]));
  for (const slug of OPEN43_B689_TABVIEW_FIXTURE.canary_slugs) {
    const page = pages.get(slug);
    if (!page) throw new Error(`B689 page is missing: ${slug}`);
    verifyPage(page, new URL(`/${encodeURI(slug)}`, plan.page_origin).href);
  }
  return {
    verified: true,
    fixture_identity_sha256: plan.fixture_identity_sha256,
    canary_slugs: [...OPEN43_B689_TABVIEW_FIXTURE.canary_slugs],
    initial_phase: value.phase,
    geometry_recorded: true,
    computed_styles_recorded: true,
    resource_state_recorded: true,
  };
}

function verifyCleanup(proof, resources) {
  const value = requirePlainObject(proof, "B689 cleanup proof");
  if (
    value.public_absence_verified !== true ||
    value.fixture_identity_sha256 !== FIXTURE_IDENTITY_SHA256 ||
    !Array.isArray(resources) ||
    resources.length !== 0
  ) {
    throw new Error("B689 cleanup did not prove unchanged public state");
  }
  return {
    public_absence_verified: true,
    public_state_unchanged: true,
    fixture_identity_sha256: FIXTURE_IDENTITY_SHA256,
  };
}

export function createOpen43B689TabviewCandidateCaseSet() {
  return Object.freeze({
    id: "open43-689-tabview",
    caseIds: Object.freeze([OPEN43_B689_TABVIEW_INITIAL_CASE_ID]),
    prepareRun({ candidateIdentity, privateInput, candidateBrowserContexts }) {
      const fixture = exactFixture(privateInput);
      const pageOrigin = candidatePageOrigin(candidateIdentity);
      return {
        sourceFiles: SOURCE_FILES,
        runtimeBindings: [],
        privateInputIdentity: {
          fixture_id: fixture.fixture_id,
          fixture_source_path: fixture.source_path,
          fixture_source_sha256: fixture.source_sha256,
          fixture_identity_sha256: FIXTURE_IDENTITY_SHA256,
        },
        browserCredentialPolicy: "none",
        plan: {
          schema: "wikijump.open43_b689_tabview_candidate_plan.v1",
          case_ids: [OPEN43_B689_TABVIEW_INITIAL_CASE_ID],
          page_origin: pageOrigin,
          viewport: VIEWPORT,
          fixture,
          fixture_identity_sha256: FIXTURE_IDENTITY_SHA256,
          observation_phase: "domcontentloaded_immediate_observation",
        },
        async execute() {
          await candidateBrowserContexts.setActiveFixture(OPEN43_B689_TABVIEW_INITIAL_CASE_ID);
          const browser = await candidateBrowserContexts.newCandidateContext({ viewport: VIEWPORT });
          const pages = [];
          for (const canary of CANARIES) {
            const slug = canary.slug;
            const url = new URL(`/${encodeURI(slug)}`, pageOrigin).href;
            const page = await browser.context.newPage();
            const consoleErrors = [];
            let requestFailureCount = 0;
            let httpErrorCount = 0;
            page.on("console", (message) => {
              if (message.type() === "error") consoleErrors.push(message.text());
            });
            page.on("pageerror", (error) => consoleErrors.push(error.message));
            page.on("requestfailed", () => { requestFailureCount += 1; });
            page.on("response", (response) => { if (response.status() >= 400) httpErrorCount += 1; });
            try {
              const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 300_000 });
              pages.push({
                slug,
                input_url: url,
                final_url: page.url(),
                navigation_status: response?.status() ?? 0,
                console_error_count: consoleErrors.length,
                console_error_sha256: sha256Value(consoleErrors),
                request_failure_count: requestFailureCount,
                http_error_count: httpErrorCount,
                observation: await observeTabviews(page),
              });
            } finally {
              await page.close();
            }
          }
          return [{
            case_id: OPEN43_B689_TABVIEW_INITIAL_CASE_ID,
            observations: {
              fixture_identity_sha256: FIXTURE_IDENTITY_SHA256,
              phase: "domcontentloaded_immediate_observation",
              sequence: 1,
              browser_environment: browser.environment,
              pages,
            },
          }];
        },
        async cleanup() {
          return {
            public_absence_verified: true,
            fixture_identity_sha256: FIXTURE_IDENTITY_SHA256,
          };
        },
        verifyCase(caseId, observations) {
          if (caseId !== OPEN43_B689_TABVIEW_INITIAL_CASE_ID) throw new Error(`unknown B689 case: ${caseId}`);
          return verifyOpen43B689TabviewInitial(observations, this.plan);
        },
        verifyCleanup,
      };
    },
  });
}
