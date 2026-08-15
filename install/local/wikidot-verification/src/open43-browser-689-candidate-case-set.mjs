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

const LIVE_TABVIEW_STYLES = Object.freeze({ display: "grid", position: "relative", visibility: "visible", font_family: "InterVariable, blinkmacsystemfont, \"Segoe UI\", Roboto, Oxygen, Ubuntu, Cantarell, \"Fira Sans\", \"Droid Sans\", \"Helvetica Neue\", sans-serif", font_size: "15.2705px" });
const LIVE_NAV_STYLES = Object.freeze({ display: "flex", position: "static", visibility: "visible", font_family: "\"JetBrains Mono\", menlo, consolas, monaco, \"liberation mono\", \"lucida console\", monospace", font_size: "14.507px" });
const LIVE_CONTENT_STYLES = Object.freeze({ display: "block", position: "static", visibility: "visible", font_family: "InterVariable, blinkmacsystemfont, \"Segoe UI\", Roboto, Oxygen, Ubuntu, Cantarell, \"Fira Sans\", \"Droid Sans\", \"Helvetica Neue\", sans-serif", font_size: "15.2705px" });

export const OPEN43_B689_TABVIEW_LIVE_ORACLE = Object.freeze({
  schema: "wikijump.open43.b689.tabview_live_oracle.v1",
  viewport: Object.freeze({ width: 1366, height: 900, device_scale_factor: 1 }),
  thresholds_px: Object.freeze({ position: 8, size: 12 }),
  provenance: Object.freeze([
    Object.freeze({
      path: "/home/roku/wjlab/evidence/standing-promotion-20260721-f0099338/host-live-reference-v1/standing-browser-live-reference.json",
      sha256: "1967c4de664f3b7535629cd6622152076a0320d18239c19e0716a0f69a7c7332",
      role: "theme:basalt initial live geometry and DOM",
    }),
    Object.freeze({
      path: "/home/roku/wjlab/evidence/standing-browser-20260715/scp8980-local-live-structural-diff-20260715T061801Z/capture.json",
      sha256: "420a132795f52adb3ccae66b1e2fdaf80e099628d46e0a97263274751edebc7b",
      role: "scp-8980 initial live geometry and computed style",
    }),
    Object.freeze({
      path: "/home/roku/wjlab/evidence/20260808-open87-execution/pr2-ed5c5b353/browser-diagnostics/issue-690-scp8980-first-divergence-20260809.json",
      sha256: "f3755f5abaebb7b07c3a21d2eab3f9cfe89c1d4ffcccfb1ca4245c631067afe4",
      role: "scp-8980 live DOM and diagnostic identity",
    }),
  ]),
  pages: Object.freeze({
    "theme:basalt": Object.freeze({
      live_url: "https://scp-wiki.wikidot.com/theme:basalt",
      tabview: Object.freeze({
        count: 1,
        id_present: true,
        class_name: "yui-navset yui-navset-top",
        rectangle: Object.freeze({ x: 123, y: 3817.69, width: 1120, height: 137.44 }),
        first_panel_rectangle: Object.freeze({ x: 123, y: 3928.830625, width: 1120, height: 75.515625 }),
        styles: LIVE_TABVIEW_STYLES,
        selected_title: "active",
        label_wrapper: "em",
        panel_ids_present: true,
      }),
      nav_styles: LIVE_NAV_STYLES,
      content_styles: LIVE_CONTENT_STYLES,
      panel_styles: LIVE_CONTENT_STYLES,
      resource_state: Object.freeze({ document_ready_state: "interactive", rendered_image_count: 7, broken_image_count: 2 }),
    }),
    "scp-8980": Object.freeze({
      live_url: "https://scp-wiki.wikidot.com/scp-8980",
      tabview: Object.freeze({
        count: 1,
        id_present: true,
        class_name: "yui-navset yui-navset-top",
        rectangle: Object.freeze({ x: 203, y: 193.94, width: 960, height: 58505.09 }),
        first_panel_rectangle: Object.freeze({ x: 203, y: 193.94, width: 960, height: 58468.13 }),
        styles: LIVE_TABVIEW_STYLES,
        selected_title: "active",
        label_wrapper: "em",
        panel_ids_present: true,
      }),
      nav_styles: LIVE_NAV_STYLES,
      content_styles: LIVE_CONTENT_STYLES,
      panel_styles: LIVE_CONTENT_STYLES,
      resource_state: Object.freeze({ document_ready_state: "interactive", rendered_image_count: 3, broken_image_count: 0 }),
    }),
  }),
});

const VIEWPORT = Object.freeze({
  width: OPEN43_B689_TABVIEW_LIVE_ORACLE.viewport.width,
  height: OPEN43_B689_TABVIEW_LIVE_ORACLE.viewport.height,
});
const CANARIES = Object.freeze(
  OPEN43_B689_TABVIEW_FIXTURE.canary_slugs.map((slug) =>
    STANDING_BROWSER_CANARIES.find((canary) => canary.slug === slug),
  ),
);
const FIXTURE_IDENTITY_SHA256 = sha256Value(OPEN43_B689_TABVIEW_FIXTURE);
const LIVE_ORACLE_IDENTITY_SHA256 = sha256Value(OPEN43_B689_TABVIEW_LIVE_ORACLE);

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

async function observeTabviews(page) {
  return await page.evaluate(() => {
    const rectangle = (element) => {
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    const styles = (element) => {
      const value = getComputedStyle(element);
      return {
        display: value.display,
        position: value.position,
        visibility: value.visibility,
        font_family: value.fontFamily,
        font_size: value.fontSize,
      };
    };
    const roots = [...document.querySelectorAll("#page-content .yui-navset")];
    const images = [...document.images];
    return {
      tabview_count: roots.length,
      tabviews: roots.map((root) => {
        const nav = root.querySelector(":scope > .yui-nav");
        const content = root.querySelector(":scope > .yui-content");
        const tabs = nav ? [...nav.children].filter((item) => item.tagName === "LI") : [];
        const panels = content ? [...content.children] : [];
        const selected = tabs.find((tab) => tab.classList.contains("selected"));
        return {
          class_name: root.className,
          id_present: root.id.length > 0,
          styles: styles(root),
          rectangle: rectangle(root),
          tab_count: tabs.length,
          selected_count: tabs.filter((tab) => tab.classList.contains("selected")).length,
          visible_panel_count: panels.filter((panel) => getComputedStyle(panel).display !== "none").length,
          panel_count: panels.length,
          selected_title: selected?.getAttribute("title") ?? null,
          label_wrapper: selected?.querySelector("a em")?.tagName.toLowerCase() ?? null,
          panel_ids_present: panels.length > 0 && panels.every((panel) => panel.id.length > 0),
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
        rendered_image_count: images.filter((image) => {
          const style = getComputedStyle(image);
          const box = image.getBoundingClientRect();
          return image.complete && image.naturalWidth > 0 && style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
        }).length,
        broken_image_count: images.filter((image) => !image.complete || image.naturalWidth === 0).length,
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

function compareRectangle(actual, expected, name) {
  const value = positiveRectangle(actual, name);
  for (const field of ["x", "y"]) {
    if (Math.abs(value[field] - expected[field]) > OPEN43_B689_TABVIEW_LIVE_ORACLE.thresholds_px.position) throw new Error(`${name} geometry drift in ${field}`);
  }
  for (const field of ["width", "height"]) {
    if (Math.abs(value[field] - expected[field]) > OPEN43_B689_TABVIEW_LIVE_ORACLE.thresholds_px.size) throw new Error(`${name} geometry drift in ${field}`);
  }
  return value;
}

function compareStyles(actual, expected, name) {
  const value = requirePlainObject(actual, `${name} styles`);
  for (const field of ["display", "position", "visibility", "font_family", "font_size"]) {
    if (value[field] !== expected[field]) throw new Error(`${name} ${field} differs from live oracle`);
  }
}

function verifyPage(page, expectedUrl) {
  if (
    page.navigation_status !== 200 ||
    page.input_url !== expectedUrl ||
    page.final_url !== expectedUrl ||
    page.console_error_count !== 0 ||
    page.request_failure_count !== 0 ||
    page.http_error_count !== 0
  ) {
    throw new Error(`B689 initial browser page mismatched: ${page.slug}`);
  }
  const oracle = OPEN43_B689_TABVIEW_LIVE_ORACLE.pages[page.slug];
  if (!oracle) throw new Error(`B689 page has no retained live oracle: ${page.slug}`);
  const observation = requirePlainObject(page.observation, `${page.slug} tabview observation`);
  if (observation.tabview_count !== oracle.tabview.count || !Array.isArray(observation.tabviews) || observation.tabviews.length !== oracle.tabview.count) {
    throw new Error(`B689 tabview is missing: ${page.slug}`);
  }
  for (const [index, tabview] of observation.tabviews.entries()) {
    if (
      tabview.tab_count < 1 ||
      tabview.tab_count !== tabview.panel_count ||
      tabview.selected_count !== 1 ||
      tabview.visible_panel_count !== 1 ||
      tabview.styles?.visibility !== "visible" ||
      tabview.id_present !== true ||
      tabview.class_name !== oracle.tabview.class_name ||
      tabview.selected_title !== oracle.tabview.selected_title ||
      tabview.label_wrapper !== oracle.tabview.label_wrapper ||
      tabview.panel_ids_present !== oracle.tabview.panel_ids_present
    ) {
      throw new Error(`B689 tabview structure mismatched: ${page.slug} #${index}`);
    }
    compareRectangle(tabview.rectangle, oracle.tabview.rectangle, `${page.slug} tabview #${index}`);
    compareRectangle(tabview.first_panel_rectangle, oracle.tabview.first_panel_rectangle, `${page.slug} first panel #${index}`);
    compareStyles(tabview.styles, oracle.tabview.styles, `${page.slug} tabview #${index}`);
    compareStyles(tabview.nav_styles, oracle.nav_styles, `${page.slug} nav`);
    compareStyles(tabview.content_styles, oracle.content_styles, `${page.slug} content`);
    compareStyles(tabview.first_panel_styles, oracle.panel_styles, `${page.slug} first panel`);
  }
  const resourceState = requirePlainObject(observation.resource_state, `${page.slug} resource state`);
  if (
    typeof resourceState.document_ready_state !== "string" ||
    typeof resourceState.stylesheet_count !== "number" ||
    typeof resourceState.image_count !== "number" ||
    typeof resourceState.incomplete_image_count !== "number" ||
    typeof resourceState.resource_entry_count !== "number" ||
    resourceState.document_ready_state !== oracle.resource_state.document_ready_state ||
    resourceState.rendered_image_count !== oracle.resource_state.rendered_image_count ||
    resourceState.broken_image_count !== oracle.resource_state.broken_image_count
  ) {
    throw new Error(`B689 resource state is incomplete: ${page.slug}`);
  }
}

export function verifyOpen43B689TabviewInitial(observations, plan) {
  const value = requirePlainObject(observations, "B689_TABVIEW_INITIAL observations");
  if (
    value.fixture_identity_sha256 !== plan.fixture_identity_sha256 ||
    value.live_oracle_identity_sha256 !== plan.live_oracle_identity_sha256 ||
    value.phase !== "domcontentloaded_immediate_observation" ||
    value.sequence !== 1 ||
    !Array.isArray(value.pages) ||
    value.pages.length !== OPEN43_B689_TABVIEW_FIXTURE.canary_slugs.length
  ) {
    throw new Error("B689 initial tabview denominator or phase mismatched");
  }
  requireSha256(value.browser_environment.executable_sha256, "B689 browser executable SHA-256");
  const observedSlugs = value.pages.map((page) => page.slug);
  if (new Set(observedSlugs).size !== observedSlugs.length) throw new Error("B689 duplicate page rows");
  if (observedSlugs.some((slug) => !OPEN43_B689_TABVIEW_FIXTURE.canary_slugs.includes(slug))) throw new Error("B689 extra page row");
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
    geometry_checked: true,
    computed_styles_checked: true,
    resource_state_checked: true,
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
          live_oracle_identity_sha256: LIVE_ORACLE_IDENTITY_SHA256,
        },
        browserCredentialPolicy: "none",
        plan: {
          schema: "wikijump.open43_b689_tabview_candidate_plan.v1",
          case_ids: [OPEN43_B689_TABVIEW_INITIAL_CASE_ID],
          page_origin: pageOrigin,
          viewport: VIEWPORT,
          fixture,
          fixture_identity_sha256: FIXTURE_IDENTITY_SHA256,
          live_oracle_identity_sha256: LIVE_ORACLE_IDENTITY_SHA256,
          live_oracle_provenance: OPEN43_B689_TABVIEW_LIVE_ORACLE.provenance,
          geometry_thresholds_px: OPEN43_B689_TABVIEW_LIVE_ORACLE.thresholds_px,
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
              live_oracle_identity_sha256: LIVE_ORACLE_IDENTITY_SHA256,
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
