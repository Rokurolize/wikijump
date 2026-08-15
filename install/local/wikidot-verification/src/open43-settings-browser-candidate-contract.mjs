import {
  requirePlainObject,
  requireSha256,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_SETTINGS_BROWSER_CASE_IDS = Object.freeze([
  "S754_ANALYTICS_INITIAL",
  "S754_ANALYTICS_SETTLED",
  "S755_THEME_INITIAL",
  "S755_THEME_SETTLED",
  "S757_TOOLBAR_INITIAL",
  "S757_TOOLBAR_SETTLED",
  "S1046_ADMIN_INITIAL",
  "S1046_ADMIN_SETTLED",
  "S1046_PUBLIC_PERMISSION_CSRF_REVISION_MATRIX",
]);

export const OPEN43_SETTINGS_ANALYTICS_CASE_IDS = Object.freeze([
  "S754_ANALYTICS_INITIAL",
  "S754_ANALYTICS_SETTLED",
]);

export const OPEN43_SETTINGS_THEME_CASE_IDS = Object.freeze([
  "S755_THEME_INITIAL",
  "S755_THEME_SETTLED",
]);

export const OPEN43_SETTINGS_UNAVAILABLE_CASE_IDS = Object.freeze([
  "S754_IMPORT_EXPORT_REPRESENTATION",
  "S754_LIVE_BEACON_PAYLOAD_AND_TIMING",
  "S755_BUILT_IN_ASSET_MAPPING",
  "S755_LEGACY_GALLERY_AND_CUSTOM_LIFECYCLE",
  "S755_EXTERNAL_RESOURCE_FAILURE_POLICY",
]);

const SETTINGS_SITE_FIELDS = Object.freeze([
  "site_id",
  "slug",
  "name",
  "tagline",
  "description",
  "locale",
  "default_page",
  "welcome_page",
  "google_analytics_enabled",
  "google_analytics_profile",
  "show_top_toolbar",
  "show_bottom_toolbar",
]);

const SETTINGS_CATEGORY_FIELDS = Object.freeze([
  "category_id",
  "slug",
  "theme_kind",
  "theme_builtin_id",
  "theme_external_url",
  "theme_custom_css",
]);

function requireSettingsSnapshot(value, label) {
  const settings = requirePlainObject(value, label);
  const site = requirePlainObject(settings.site, `${label}.site`);
  for (const field of SETTINGS_SITE_FIELDS) if (!Object.hasOwn(site, field)) throw new Error(`${label}.site is missing ${field}`);
  if (!Array.isArray(settings.categories) || settings.categories.length !== 2) throw new Error(`${label}.categories must contain the two fixed candidate categories`);
  for (const [index, categoryValue] of settings.categories.entries()) {
    const category = requirePlainObject(categoryValue, `${label}.categories[${index}]`);
    for (const field of SETTINGS_CATEGORY_FIELDS) if (!Object.hasOwn(category, field)) throw new Error(`${label}.categories[${index}] is missing ${field}`);
  }
  return settings;
}

function requireTemporal(value, phase, sequence, label) {
  const temporal = requirePlainObject(value, `${label} temporal observation`);
  if (temporal.phase !== phase || temporal.sequence !== sequence) {
    throw new Error(`${label} has the wrong ${sequence === 1 ? "initial" : "settled"} observation phase or order`);
  }
  if (
    temporal.navigation_status !== 200 ||
    typeof temporal.input_url !== "string" ||
    temporal.final_url !== temporal.input_url
  ) {
    throw new Error(`${label} did not bind one successful candidate navigation`);
  }
  const artifact = requirePlainObject(temporal.artifact, `${label} artifact`);
  if (typeof artifact.path !== "string" || artifact.path.length === 0) {
    throw new Error(`${label} artifact path is missing`);
  }
  requireSha256(artifact.sha256, `${label} artifact SHA-256`);
  requireSha256(
    temporal.counterpart_artifact_sha256,
    `${label} counterpart artifact SHA-256`,
  );
  if (typeof temporal.counterpart_artifact_path !== "string" || temporal.counterpart_artifact_path.length === 0) {
    throw new Error(`${label} counterpart artifact path is missing`);
  }
  if (artifact.path === temporal.counterpart_artifact_path) {
    throw new Error(`${label} reused one artifact for initial and settled observations`);
  }
  return temporal;
}

function requireGroupFailedRequestIdentity(value, label, plan) {
  if (plan.group === "analytics" || plan.group === "theme") {
    requireSha256(value?.failed_request_identity_sha256, `${label} failed-request identity SHA-256`);
  }
}

function verifyAnalyticsInitial(observations, plan) {
  requireTemporal(observations.disabled_temporal, "domcontentloaded_immediate_observation", 1, "disabled analytics initial");
  requireTemporal(observations.enabled_temporal, "domcontentloaded_immediate_observation", 1, "enabled analytics initial");
  const disabled = requirePlainObject(observations.disabled, "disabled analytics initial state");
  const analytics = requirePlainObject(observations.enabled, "enabled analytics initial state");
  requireGroupFailedRequestIdentity(disabled, "disabled analytics initial", plan);
  requireGroupFailedRequestIdentity(analytics, "enabled analytics initial", plan);
  const expectedQueue = [["_setAccount", plan.analytics_profile], ["_trackPageview"]];
  requireSha256(disabled.initial_navigation_csp_header_sha256, "disabled initial navigation CSP header SHA-256");
  requireSha256(analytics.initial_navigation_csp_header_sha256, "enabled initial navigation CSP header SHA-256");
  if (
    observations.disabled_temporal.artifact.path === observations.enabled_temporal.artifact.path ||
    disabled.enabled !== false ||
    disabled.meta_present !== false ||
    disabled.profile !== null ||
    disabled.script_count !== 1 ||
    JSON.stringify(disabled.queue) !== "[]" ||
    disabled.remote_request_count !== 0 ||
    analytics.enabled !== true ||
    analytics.meta_present !== true ||
    analytics.script_count !== 1 ||
    analytics.profile !== plan.analytics_profile ||
    JSON.stringify(analytics.queue) !== JSON.stringify(expectedQueue) ||
    analytics.remote_request_count !== 0 ||
    analytics.csp_nonce_matches_initial_navigation_header !== true
  ) {
    throw new Error("analytics initial state is stale or widened");
  }
  requireSha256(analytics.csp_nonce_sha256, "analytics CSP nonce SHA-256");
  return {
    verified: true,
    phase: observations.enabled_temporal.phase,
    disabled_artifact_sha256: observations.disabled_temporal.artifact.sha256,
    artifact_sha256: observations.enabled_temporal.artifact.sha256,
    queue_sha256: sha256Value(expectedQueue),
    csp_nonce_sha256: analytics.csp_nonce_sha256,
  };
}

function verifyAnalyticsSettled(observations, plan) {
  requireTemporal(observations.temporal, "settled", 2, "analytics settled");
  if (observations.temporal.resource_completion !== "complete") {
    throw new Error("analytics settled resources are incomplete");
  }
  const analytics = requirePlainObject(observations.analytics, "analytics settled state");
  const lifecycle = requirePlainObject(observations.admin_lifecycle, "analytics admin lifecycle");
  requireGroupFailedRequestIdentity(analytics, "analytics settled", plan);
  const queue = [["_setAccount", plan.analytics_profile], ["_trackPageview"]];
  requireSha256(analytics.initial_navigation_csp_header_sha256, "analytics initial navigation CSP header SHA-256");
  if (
    analytics.profile !== plan.analytics_profile ||
    JSON.stringify(analytics.queue) !== JSON.stringify(queue) ||
    JSON.stringify(analytics.reload_queue) !== JSON.stringify(queue) ||
    JSON.stringify(analytics.client_navigation_queue) !== JSON.stringify(queue) ||
    analytics.client_navigation_preserved_document !== true ||
    analytics.client_resource_completion !== "complete" ||
    analytics.remote_request_count !== 0 ||
    analytics.csp_nonce_matches_initial_navigation_header !== true ||
    analytics.reload_url !== plan.default_page_url ||
    !Array.isArray(analytics.console_errors) ||
    analytics.console_errors.length !== 0 ||
    lifecycle.stale_status !== 500 ||
    lifecycle.error_visible !== true ||
    lifecycle.error_code !== plan.revision_conflict_code ||
    lifecycle.error_message_sha256 !== plan.revision_conflict_message_sha256 ||
    lifecycle.success_status !== 200 ||
    lifecycle.saved_profile !== plan.analytics_profile
  ) {
    if (analytics.reload_url !== plan.default_page_url) throw new Error("analytics reload URL differs from the independently planned page URL");
    throw new Error("analytics settled state is stale or widened");
  }
  return {
    verified: true,
    phase: observations.temporal.phase,
    artifact_sha256: observations.temporal.artifact.sha256,
  };
}

function verifyTheme(observations, plan, settled) {
  const phase = settled ? "settled" : "domcontentloaded_immediate_observation";
  const sequence = settled ? 2 : 1;
  const defaultTemporal = requireTemporal(observations.default_temporal, phase, sequence, `default theme ${settled ? "settled" : "initial"}`);
  const transitionTemporal = requireTemporal(observations.transition_temporal, phase, sequence, `transition theme ${settled ? "settled" : "initial"}`);
  const categoryTransitionTemporal = requireTemporal(observations.category_transition_temporal, settled ? "client_navigation_settled" : "client_navigation_immediate_observation", sequence, `client transition ${settled ? "settled" : "initial"}`);
  const defaultTheme = requirePlainObject(observations.default_theme, "default theme observation");
  const transitionTheme = requirePlainObject(observations.transition_theme, "direct target theme observation");
  const categoryTransitionTheme = requirePlainObject(observations.category_transition_theme, "client transition theme observation");
  requireGroupFailedRequestIdentity(defaultTheme, "default theme", plan);
  requireGroupFailedRequestIdentity(transitionTheme, "direct target theme", plan);
  requireGroupFailedRequestIdentity(categoryTransitionTheme, "client transition theme", plan);
  if (
    defaultTemporal.input_url !== plan.default_page_url ||
    transitionTemporal.input_url !== plan.transition_page_url ||
    categoryTransitionTemporal.input_url !== plan.transition_page_url ||
    new Set([defaultTemporal.artifact.path, transitionTemporal.artifact.path, categoryTransitionTemporal.artifact.path]).size !== 3 ||
    defaultTheme.expected_marker !== plan.theme_marker ||
    defaultTheme.computed_marker !== plan.theme_marker ||
    JSON.stringify(defaultTheme.stylesheet_order) !== JSON.stringify(["base", "site"]) ||
    defaultTheme.stale_theme_present !== false ||
    transitionTheme.expected_marker !== plan.transition_theme_marker ||
    transitionTheme.computed_marker !== plan.transition_theme_marker ||
    JSON.stringify(transitionTheme.stylesheet_order) !== JSON.stringify(["base", "site"]) ||
    transitionTheme.stale_previous_theme_present !== false
  ) {
    throw new Error("theme observation is stale or has the wrong cascade");
  }
  if (
    categoryTransitionTheme.expected_marker !== plan.transition_theme_marker ||
    categoryTransitionTheme.computed_marker !== plan.transition_theme_marker ||
    JSON.stringify(categoryTransitionTheme.stylesheet_order) !== JSON.stringify(["base", "site"]) ||
    categoryTransitionTheme.stale_previous_theme_present !== false ||
    categoryTransitionTheme.navigation_source_marker !== plan.theme_marker ||
    categoryTransitionTheme.navigation_from_url !== plan.default_page_url
  ) throw new Error("client transition theme observation is stale or has the wrong cascade");
  if (
    defaultTheme.body_font_family !== plan.theme_body_font_family ||
    defaultTheme.body_background_color !== plan.theme_body_background_color ||
    defaultTheme.body_color !== plan.theme_body_color ||
    transitionTheme.body_font_family !== plan.theme_body_font_family ||
    transitionTheme.body_background_color !== plan.transition_body_background_color ||
    transitionTheme.body_color !== plan.theme_body_color ||
    categoryTransitionTheme.body_font_family !== plan.theme_body_font_family ||
    categoryTransitionTheme.body_background_color !== plan.transition_body_background_color ||
    categoryTransitionTheme.body_color !== plan.theme_body_color
  ) {
    throw new Error("theme computed style is wrong");
  }
  requireSha256(defaultTheme.initial_navigation_csp_header_sha256, "default initial navigation CSP header SHA-256");
  requireSha256(transitionTheme.initial_navigation_csp_header_sha256, "direct target initial navigation CSP header SHA-256");
  if (!Array.isArray(defaultTheme.capture_failures) || defaultTheme.capture_failures.length !== 0) throw new Error("default theme capture has public failures");
  if (!Array.isArray(transitionTheme.capture_failures) || transitionTheme.capture_failures.length !== 0) throw new Error("direct target theme capture has public failures");
  if (!Array.isArray(categoryTransitionTheme.capture_failures) || categoryTransitionTheme.capture_failures.length !== 0) throw new Error("client transition theme capture has public failures");
  if (settled && (defaultTemporal.resource_completion !== "complete" || transitionTemporal.resource_completion !== "complete" || categoryTransitionTemporal.resource_completion !== "complete")) {
    throw new Error("theme settled resources are incomplete");
  }
  if (settled) {
    if (defaultTheme.reload_url !== plan.default_page_url || transitionTheme.reload_url !== plan.transition_page_url) throw new Error("theme reload URL differs from the independently planned page URL");
    const changes = requirePlainObject(observations.setting_changes, "theme setting changes");
    for (const role of ["default", "transition"]) {
      const change = requirePlainObject(changes[role], `${role} theme setting change`);
      requireSha256(change.before_sha256, `${role} theme setting before SHA-256`);
      requireSha256(change.after_sha256, `${role} theme setting after SHA-256`);
      if (change.before_sha256 === change.after_sha256) throw new Error("theme setting change is missing");
    }
  }
  return {
    verified: true,
    phase,
    default_artifact_sha256: defaultTemporal.artifact.sha256,
    transition_artifact_sha256: transitionTemporal.artifact.sha256,
    category_transition_artifact_sha256: categoryTransitionTemporal.artifact.sha256,
  };
}

function verifyToolbar(observations, plan, settled) {
  const captures = observations.captures;
  const disabledCaptures = observations.disabled_captures;
  const widths = [1280, 767, 479];
  if (!Array.isArray(captures) || captures.length !== widths.length || !Array.isArray(disabledCaptures) || disabledCaptures.length !== widths.length) {
    throw new Error("toolbar observation has the wrong viewport denominator");
  }
  for (const [enabled, rows] of [[false, disabledCaptures], [true, captures]]) for (const [index, captureValue] of rows.entries()) {
    const capture = requirePlainObject(captureValue, "toolbar viewport observation");
    if (
      capture.viewport?.width !== widths[index] ||
      capture.viewport?.height !== 900 ||
      capture.top_toolbar_count !== (enabled ? 1 : 0) ||
      capture.stale_previous_setting_present !== false
    ) {
      throw new Error("toolbar observation is stale or has the wrong viewport state");
    }
    requireTemporal(
      capture.temporal,
      settled ? "settled" : "domcontentloaded_immediate_observation",
      settled ? 2 : 1,
      `toolbar ${widths[index]} ${settled ? "settled" : "initial"}`,
    );
    if (settled && capture.temporal.resource_completion !== "complete") {
      throw new Error("toolbar settled resources are incomplete");
    }
    if (settled && capture.reload_url !== plan.default_page_url) {
      throw new Error("toolbar reload URL differs from the independently planned page URL");
    }
    if (settled && enabled) {
      const visible = widths[index] > 767;
      const geometryVisible = capture.geometry?.width > 0 && capture.geometry?.height > 0 && capture.hit_target?.width > 0 && capture.hit_target?.height > 0;
      const geometryHidden = capture.geometry?.width === 0 && capture.geometry?.height === 0 && capture.hit_target?.width === 0 && capture.hit_target?.height === 0;
      if (visible ? !geometryVisible : !geometryHidden) throw new Error("toolbar settled geometry or hit target is missing");
    }
  }
  if (new Set([...captures, ...disabledCaptures].map(({ temporal }) => temporal.artifact.path)).size !== widths.length * 2) {
    throw new Error("toolbar observation artifacts are not distinct");
  }
  if (settled) {
    const transition = requirePlainObject(observations.setting_transition, "toolbar setting transition");
    const transitionInitial = requireTemporal(transition.initial_temporal, "client_navigation_immediate_observation", 1, "toolbar setting transition initial");
    const transitionSettled = requireTemporal(transition.settled_temporal, "client_navigation_settled", 2, "toolbar setting transition settled");
    if (
      transition.before_top_toolbar_count !== 0 || transition.client_immediate_top_toolbar_count !== 1 || transition.client_settled_top_toolbar_count !== 1 ||
      transition.client_immediate_stale_previous_setting_present !== false || transition.client_settled_stale_previous_setting_present !== false ||
      transition.navigation_from_url !== plan.transition_page_url || transition.navigation_to_url !== plan.default_page_url ||
      transitionInitial.input_url !== plan.default_page_url || transitionSettled.input_url !== plan.default_page_url || transitionSettled.resource_completion !== "complete" ||
      transition.client_navigation_preserved_document !== true || transition.client_resource_completion !== "complete" ||
      [...captures, ...disabledCaptures].some(({ temporal }) => [transitionInitial.artifact.path, transitionSettled.artifact.path].includes(temporal.artifact.path))
    ) throw new Error("toolbar observation is stale across the public setting transition");
    const interactions = requirePlainObject(observations.interactions, "toolbar interactions");
    if (
      JSON.stringify(Object.keys(interactions).sort()) !==
        JSON.stringify(["client_navigation_preserved", "client_navigation_preserved_document", "client_resource_completion", "focusable_link", "visible_after_scroll"]) ||
      interactions.visible_after_scroll !== true ||
      interactions.focusable_link !== true ||
      interactions.client_navigation_preserved !== true ||
      interactions.client_navigation_preserved_document !== true ||
      interactions.client_resource_completion !== "complete"
    ) {
      throw new Error("toolbar settled interactions are incomplete");
    }
    if (observations.setting_change?.before_sha256 === observations.setting_change?.after_sha256) throw new Error("toolbar setting change is missing");
    requireSha256(observations.setting_change.before_sha256, "toolbar setting before SHA-256");
    requireSha256(observations.setting_change.after_sha256, "toolbar setting after SHA-256");
  }
  return {
    verified: true,
    viewport_count: captures.length,
    top_toolbar_count: 1,
  };
}

const ADMIN_CONTROLS = Object.freeze([
  "unixName",
  "name",
  "subtitle",
  "language",
  "description",
  "default_page",
  "welcome_page",
]);

function verifyAdminInitial(observations, plan) {
  requireTemporal(
    observations.temporal,
    "domcontentloaded_immediate_observation",
    1,
    "admin initial",
  );
  const admin = requirePlainObject(observations.admin, "admin initial state");
  if (
    admin.route !== "/_admin" ||
    admin.status !== 200 ||
    JSON.stringify(admin.controls) !== JSON.stringify(ADMIN_CONTROLS) ||
    admin.values_sha256 !== plan.admin_initial_values_sha256
  ) {
    throw new Error("admin initial route or seven-control state is wrong");
  }
  const expectedDenied = [
    { actor: "anonymous", status: 401, settings_disclosed: false },
    { actor: "non_admin", status: 401, settings_disclosed: false },
  ];
  if (JSON.stringify(observations.denied) !== JSON.stringify(expectedDenied)) {
    throw new Error("admin denial disclosed settings or returned the wrong status");
  }
  return {
    verified: true,
    control_count: ADMIN_CONTROLS.length,
    artifact_sha256: observations.temporal.artifact.sha256,
  };
}

function verifyAdminSettled(observations, plan) {
  requireTemporal(observations.temporal, "settled", 2, "admin settled");
  if (observations.temporal.resource_completion !== "complete") {
    throw new Error("admin settled resources are incomplete");
  }
  const lifecycle = requirePlainObject(observations.lifecycle, "admin settled lifecycle");
  if (!Number.isSafeInteger(plan.admin_initial_revision) || plan.admin_settled_revision !== plan.admin_initial_revision + 3) {
    throw new Error("admin general form revision plan is invalid");
  }
  if (Object.hasOwn(lifecycle, "cancel")) {
    throw new Error("admin settled lifecycle claims unevidenced cancel behavior");
  }
  if (lifecycle.reload_url !== plan.admin_url) {
    throw new Error("admin reload URL differs from the independently planned admin URL");
  }
  if (
    lifecycle.form_action !== "?/site" ||
    lifecycle.stale_status !== 500 ||
    lifecycle.stale_error_visible !== true ||
    lifecycle.stale_error_code !== plan.revision_conflict_code ||
    lifecycle.stale_error_message_sha256 !== plan.revision_conflict_message_sha256 ||
    lifecycle.success_status !== 200 ||
    lifecycle.invalidation_status !== 200 ||
    lifecycle.invalidation_resource_completion !== "complete" ||
    lifecycle.fresh_revision_confirmation_status !== 200 ||
    lifecycle.confirmation_invalidation_status !== 200 ||
    lifecycle.confirmation_resource_completion !== "complete" ||
    lifecycle.stale_submitted_revision !== plan.admin_initial_revision ||
    lifecycle.stale_public_revision !== plan.admin_initial_revision + 1 ||
    lifecycle.success_submitted_revision !== plan.admin_initial_revision + 1 ||
    lifecycle.confirmation_submitted_revision !== plan.admin_initial_revision + 2 ||
    lifecycle.success_public_revision !== plan.admin_settled_revision ||
    lifecycle.success_error_visible !== false ||
    lifecycle.edited_description_sha256 !== plan.general_description_sha256
  ) {
    throw new Error("admin general form lifecycle was not exercised through the public UI");
  }
  if (
    lifecycle.stale_mutated !== false ||
    lifecycle.success_public_values_sha256 !== plan.admin_settled_values_sha256 ||
    lifecycle.success_dom_values_sha256 !== plan.admin_settled_values_sha256 ||
    lifecycle.settled_values_sha256 !== plan.admin_settled_values_sha256 ||
    lifecycle.reload_values_sha256 !== plan.admin_settled_values_sha256 ||
    lifecycle.client_navigation_values_sha256 !== plan.admin_settled_values_sha256 ||
    lifecycle.client_navigation_preserved_document !== true ||
    lifecycle.client_resource_completion !== "complete" ||
    !Array.isArray(lifecycle.console_errors) ||
    lifecycle.console_errors.length !== 0
  ) {
    throw new Error("admin settled settings are stale or the mutation lifecycle widened");
  }
  return {
    verified: true,
    artifact_sha256: observations.temporal.artifact.sha256,
  };
}

function verifyPermissionMatrix(observations, plan) {
  if (
    !Number.isSafeInteger(plan.matrix_site_id) ||
    !Number.isSafeInteger(plan.matrix_before_revision) ||
    plan.matrix_admin_after_revision !== plan.matrix_before_revision + 1 ||
    !Number.isSafeInteger(plan.administrator_user_id) ||
    !Number.isSafeInteger(plan.non_admin_user_id)
  ) {
    throw new Error("permission matrix site or revision plan is invalid");
  }
  const actorSessions = requirePlainObject(observations.actor_sessions, "actor session identity");
  if (
    JSON.stringify(Object.keys(actorSessions).sort()) !== JSON.stringify(["administrator_user_id", "expired_session", "non_admin_user_id"]) ||
    actorSessions.administrator_user_id !== plan.administrator_user_id ||
    actorSessions.non_admin_user_id !== plan.non_admin_user_id ||
    actorSessions.expired_session !== null
  ) throw new Error("actor session identity differs from public session_get");
  const expected = [
    ["anonymous", 401, false, plan.matrix_before_sha256, plan.matrix_before_revision],
    ["non_admin", 403, false, plan.matrix_before_sha256, plan.matrix_before_revision],
    ["cross_site", 403, false, plan.matrix_before_sha256, plan.matrix_before_revision],
    ["stale_revision", 500, false, plan.matrix_before_sha256, plan.matrix_before_revision],
    ["wrong_origin", 403, false, plan.matrix_before_sha256, plan.matrix_before_revision],
    ["expired_session", 401, false, plan.matrix_before_sha256, plan.matrix_before_revision],
    ["administrator", 200, true, plan.matrix_admin_after_sha256, plan.matrix_admin_after_revision],
  ];
  if (!Array.isArray(observations.outcomes) || observations.outcomes.length !== expected.length) {
    throw new Error("permission matrix denominator is incomplete");
  }
  for (const [index, [caseName, status, mutated, readHash, revision]] of expected.entries()) {
    const outcome = requirePlainObject(observations.outcomes[index], `${caseName} outcome`);
    requireSha256(outcome.next_read_sha256, `${caseName} next-read SHA-256`);
    if (outcome.case !== caseName) throw new Error("permission matrix order changed");
    if (caseName === "expired_session" && outcome.http_status === 500) {
      throw new Error("expired session returned 500 instead of 401");
    }
    if (caseName === "wrong_origin" && outcome.http_status !== 403) {
      throw new Error("wrong-origin request widened beyond CSRF denial");
    }
    if (!mutated && outcome.mutated === true) {
      throw new Error(`${caseName} denied actor mutated public settings`);
    }
    if (
      outcome.http_status !== status ||
      outcome.mutated !== mutated ||
      outcome.next_read_sha256 !== readHash ||
      outcome.site_id !== plan.matrix_site_id ||
      outcome.settings_revision !== revision
    ) {
      throw new Error(`${caseName} permission outcome or next public read changed`);
    }
  }
  return {
    verified: true,
    outcome_count: expected.length,
    administrator_after_sha256: plan.matrix_admin_after_sha256,
  };
}

export function verifyOpen43SettingsBrowserCase(caseId, rawObservations, rawPlan) {
  const observations = requirePlainObject(rawObservations, `${caseId} observations`);
  const plan = requirePlainObject(rawPlan, "Open43 settings browser plan");
  if (caseId === "S754_ANALYTICS_INITIAL") {
    return verifyAnalyticsInitial(observations, plan);
  }
  if (caseId === "S754_ANALYTICS_SETTLED") {
    return verifyAnalyticsSettled(observations, plan);
  }
  if (caseId === "S755_THEME_INITIAL") return verifyTheme(observations, plan, false);
  if (caseId === "S755_THEME_SETTLED") return verifyTheme(observations, plan, true);
  if (caseId === "S757_TOOLBAR_INITIAL") return verifyToolbar(observations, plan, false);
  if (caseId === "S757_TOOLBAR_SETTLED") return verifyToolbar(observations, plan, true);
  if (caseId === "S1046_ADMIN_INITIAL") return verifyAdminInitial(observations, plan);
  if (caseId === "S1046_ADMIN_SETTLED") return verifyAdminSettled(observations, plan);
  if (caseId === "S1046_PUBLIC_PERMISSION_CSRF_REVISION_MATRIX") {
    return verifyPermissionMatrix(observations, plan);
  }
  throw new Error(`unknown Open43 settings browser case: ${caseId}`);
}

export function verifyOpen43SettingsBrowserCleanup(rawProof, resources) {
  const proof = requirePlainObject(rawProof, "settings cleanup proof");
  const before = requireSettingsSnapshot(proof.before, "pre-run public settings");
  const after = requireSettingsSnapshot(proof.after, "restored public settings");
  if (sha256Value(before) !== sha256Value(after)) {
    throw new Error("public settings were not restored to their exact pre-run values");
  }
  if (Object.hasOwn(proof, "pages")) {
    throw new Error("settings cleanup must not publish a page cleanup proof");
  }
  if (
    !Array.isArray(resources) ||
    resources.length !== 1 ||
    resources.some((resource) => resource?.kind !== "settings" || resource.released !== true)
  ) {
    throw new Error("settings cleanup left a run resource unreleased");
  }
  const resource = resources[0];
  const identity = requirePlainObject(resource.identity, "settings cleanup resource identity");
  const releaseProof = requirePlainObject(resource.release_proof, "settings cleanup resource release proof");
  const beforeSha256 = sha256Value(before);
  const afterSha256 = sha256Value(after);
  if (
    identity.site_id !== before.site.site_id ||
    JSON.stringify(identity.category_ids) !== JSON.stringify(before.categories.map(({ category_id }) => category_id)) ||
    identity.before_sha256 !== beforeSha256 ||
    releaseProof.before_sha256 !== beforeSha256 ||
    releaseProof.after_sha256 !== afterSha256
  ) {
    throw new Error("settings cleanup resource identity does not match the restored settings");
  }
  return {
    public_absence_verified: true,
    public_restoration_verified: true,
    settings_restored_sha256: afterSha256,
    resources_released: resources.length,
  };
}
