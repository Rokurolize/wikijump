import {
  requirePlainObject,
  requireSha256,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_PAGE_TAGS_CASE_IDS = Object.freeze([
  "B822_PAGE_TAGS_INITIAL",
  "B822_PAGE_TAGS_SETTLED",
]);
const PHASE_BY_CASE_ID = Object.freeze({
  B822_PAGE_TAGS_INITIAL: Object.freeze({ name: "domcontentloaded_immediate_observation", sequence: 1 }),
  B822_PAGE_TAGS_SETTLED: Object.freeze({ name: "settled", sequence: 2 }),
});
const BASE_STYLESHEET_PATH = "/wikidot/styles/wikidot-base-165bc434fd1d.css";
const BASE_STYLESHEET_SHA256 = "165bc434fd1da2092fee0ea6bdeb55aa38402aaaafd6d1e3303180d2b595b981";

function requireTemporal(value, label, expectedPhase) {
  const temporal = requirePlainObject(value, `${label} temporal observation`);
  if (
    temporal.phase !== expectedPhase.name ||
    temporal.sequence !== expectedPhase.sequence ||
    temporal.navigation_status !== 200 ||
    typeof temporal.input_url !== "string" ||
    temporal.final_url !== temporal.input_url
  ) throw new Error(`${label} did not bind the required candidate navigation phase`);
  const artifact = requirePlainObject(temporal.artifact, `${label} artifact`);
  if (typeof artifact.path !== "string" || artifact.path.length === 0) throw new Error(`${label} artifact path is missing`);
  requireSha256(artifact.sha256, `${label} artifact SHA-256`);
  if (typeof temporal.counterpart_artifact_path !== "string" || temporal.counterpart_artifact_path.length === 0) throw new Error(`${label} settled counterpart path is missing`);
  requireSha256(temporal.counterpart_artifact_sha256, `${label} settled counterpart SHA-256`);
  if (artifact.path === temporal.counterpart_artifact_path) throw new Error(`${label} reused one temporal artifact`);
  return temporal;
}

function verifyPageTagsViewport(value, index, plan, expectedPhase) {
  const row = requirePlainObject(value, `page-tags viewport ${index}`);
  const width = [1280, 767, 479][index];
  if (row.viewport?.width !== width || row.viewport?.height !== 900) throw new Error("page-tags viewport denominator changed");
  const temporal = requireTemporal(row.temporal, `page-tags ${width}`, expectedPhase);
  if (temporal.input_url !== plan.page_url) throw new Error("page-tags navigation URL differs from the fixture page");
  const pageTags = requirePlainObject(row.page_tags, `page-tags ${width} DOM observation`);
  const container = requirePlainObject(pageTags.container, `page-tags ${width} container`);
  if (
    container.display === "flex" ||
    container.justify_content === "flex-start" ||
    Array.isArray(pageTags.active_rules) && pageTags.active_rules.some(({ selector }) => typeof selector === "string" && selector.includes(".sigma-esque-container .page-tags"))
  ) throw new Error("imported page-tags matched the modern flex owner");
  if (
    typeof container.display !== "string" ||
    typeof container.justify_content !== "string" ||
    typeof container.text_align !== "string" ||
    container.rect === null ||
    !Number.isFinite(container.rect.width) ||
    !Number.isFinite(container.rect.height) ||
    container.child_count !== plan.tag_count ||
    !Array.isArray(pageTags.child_tags) ||
    !pageTags.child_tags.every((tag) => tag === "a") ||
    pageTags.child_tags.length !== plan.tag_count ||
    !Array.isArray(pageTags.labels) ||
    sha256Value(pageTags.labels) !== plan.tags_sha256 ||
    !Array.isArray(pageTags.hrefs) ||
    pageTags.hrefs.length !== plan.tag_count ||
    pageTags.hrefs.some((href) => typeof href !== "string") ||
    sha256Value(pageTags.hrefs) !== plan.hrefs_sha256 ||
    !Array.isArray(pageTags.child_rects) ||
    pageTags.child_rects.length !== plan.tag_count ||
    pageTags.child_rects.some((rect) => rect === null || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) ||
    !Number.isSafeInteger(pageTags.line_count) ||
    pageTags.line_count < 1
  ) throw new Error("page-tags DOM shape or geometry is not the public fixture shape");
  if (!Array.isArray(pageTags.active_rules) || !pageTags.active_rules.some(({ href, selector }) => typeof href === "string" && href.endsWith(BASE_STYLESHEET_PATH) && typeof selector === "string" && selector.includes(".page-tags"))) {
    throw new Error("page-tags active imported stylesheet rule is missing");
  }
  const assets = row.stylesheet_assets;
  if (!Array.isArray(assets) || !assets.some(({ url, sha256 }) => typeof url === "string" && url.endsWith(BASE_STYLESHEET_PATH) && sha256 === BASE_STYLESHEET_SHA256)) throw new Error("page-tags stylesheet asset identity is missing or stale");
  for (const asset of assets) {
    if (typeof asset?.url !== "string") throw new Error("page-tags stylesheet URL is missing");
    requireSha256(asset.sha256, "page-tags stylesheet asset SHA-256");
  }
  if (!Array.isArray(row.capture_failures) || !Array.isArray(row.request_gate_aborts) || sha256Value({ failures: row.capture_failures, request_gate_aborts: row.request_gate_aborts }) !== row.failed_request_identity_sha256) throw new Error(`page-tags ${width} failed-request evidence is not bound to its identity`);
  requireSha256(row.failed_request_identity_sha256, `page-tags ${width} failed-request identity SHA-256`);
  return { width, artifact_sha256: temporal.artifact.sha256 };
}

export function verifyOpen43PageTagsCase(caseId, rawObservations, rawPlan) {
  const expectedPhase = PHASE_BY_CASE_ID[caseId];
  if (expectedPhase === undefined) throw new Error(`unknown Open43 page-tags case: ${caseId}`);
  const observations = requirePlainObject(rawObservations, `${caseId} observations`);
  const plan = requirePlainObject(rawPlan, "Open43 page-tags browser plan");
  if (observations.page_url !== plan.page_url) throw new Error("page-tags observation URL differs from its plan");
  const page = requirePlainObject(observations.public_page, "public page-tags producer identity");
  if (
    page.site_id !== plan.site_id ||
    page.page_id !== plan.page_id ||
    page.slug !== plan.page_slug ||
    page.page_category_id !== plan.page_category_id ||
    !Number.isSafeInteger(page.revision_id) ||
    page.tag_count !== plan.tag_count ||
    page.tags_sha256 !== plan.tags_sha256 ||
    page.hrefs_sha256 !== plan.hrefs_sha256
  ) throw new Error("page-tags producer identity does not match the fixture plan");
  requireSha256(page.tags_sha256, "public page tags SHA-256");
  requireSha256(page.hrefs_sha256, "public page tag hrefs SHA-256");
  if (!Array.isArray(observations.captures) || observations.captures.length !== 3) throw new Error("page-tags capture denominator is incomplete");
  const verified = observations.captures.map((capture, index) => verifyPageTagsViewport(capture, index, plan, expectedPhase));
  if (new Set(verified.map(({ artifact_sha256 }) => artifact_sha256)).size !== verified.length) throw new Error("page-tags viewport artifacts are not distinct");
  return { verified: true, phase: expectedPhase.name, viewport_count: verified.length, tag_count: plan.tag_count };
}

export function verifyOpen43PageTagsCleanup(rawProof, resources) {
  const proof = requirePlainObject(rawProof, "page-tags cleanup proof");
  const before = requirePlainObject(proof.before, "page-tags pre-run identity");
  const after = requirePlainObject(proof.after, "page-tags post-run identity");
  if (sha256Value(before) !== sha256Value(after)) throw new Error("page-tags cleanup changed the public page");
  if (!Array.isArray(resources) || resources.length !== 1 || resources[0]?.kind !== "page-tags" || resources[0].released !== true) throw new Error("page-tags cleanup left its run resource unreleased");
  const resource = resources[0];
  const identity = requirePlainObject(resource.identity, "page-tags cleanup resource identity");
  const releaseProof = requirePlainObject(resource.release_proof, "page-tags cleanup release proof");
  const beforeSha256 = sha256Value(before);
  if (identity.before_sha256 !== beforeSha256 || releaseProof.before_sha256 !== beforeSha256 || releaseProof.after_sha256 !== beforeSha256) throw new Error("page-tags cleanup resource is not bound to the unchanged public page");
  return { public_absence_verified: true, public_restoration_verified: true, page_tags_unchanged_verified: true, resources_released: 1 };
}
