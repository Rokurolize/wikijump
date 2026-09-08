import {
  requireNonEmptyString,
  requirePlainObject,
  requireSha256,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

const VISIBLE_MARKERS = Object.freeze([
  ["NAME", "visible_user", false],
  ["NAME_STAR", "visible_user", true],
  ["NAME_ONLY", "name_only_user", false],
  ["UNICODE", "unicode_user", false],
  ["NUMERIC_DISPLAY", "display_numeric_name_user", false],
  ["SYSTEM", "system_user", false],
]);
const NO_IDENTITY_MARKUP = Object.freeze(["<a", "onclick=", "printuser", "avatar"]);

function object(value, name) {
  return requirePlainObject(value, name);
}

function markerFragment(body, marker) {
  const start = body.indexOf(`${marker}=`);
  if (start < 0) throw new Error(`missing #1026 marker ${marker}`);
  const tail = body.slice(start);
  const endings = [tail.indexOf("\n"), tail.indexOf("<br"), tail.indexOf("</p>")].filter((index) => index >= 0);
  return tail.slice(0, endings.length === 0 ? undefined : Math.min(...endings));
}

function verifyVisible(body, marker, user, surface, starred) {
  const fragment = markerFragment(body, marker);
  const profile = `http://www.wikidot.com/user:info/${user.slug}`;
  const onclick = `WIKIDOT.page.listeners.userInfo(${user.user_id}); return false;`;
  if (!fragment.includes(profile) || !fragment.includes(onclick) || !fragment.includes(`>${user.name}</a>`)) {
    throw new Error(`${surface} ${marker} lookup did not render the fixed visible identity`);
  }
  if (starred) {
    if (!fragment.includes('class="printuser avatarhover"') || !fragment.includes("<img") || !fragment.includes(`userid=${user.user_id}`)) throw new Error(`${surface} ${marker} did not preserve avatarhover identity`);
  } else if (fragment.includes("avatarhover") || fragment.includes("<img")) {
    throw new Error(`${surface} ${marker} unexpectedly emitted avatar identity`);
  }
  return { marker, profile, onclick };
}

function verifyHidden(body, fixture, surface) {
  const user = fixture.deleted_user;
  const fragments = [...body.matchAll(/<span class="error-inline">[\s\S]*?<\/span>/gu)].map(([output]) => output);
  if (
    fragments.length !== OPEN43_Q1026_EXPECTED_EM_CONTENTS.length ||
    !body.includes(`<em>${fixture.visible_user.user_id}</em> does not match any existing user name`) ||
    !body.includes(`${user.name}`) ||
    !body.includes("does not match any existing user name") ||
    body.includes(`user:info/${user.slug}`) ||
    body.includes(`user:info/${fixture.visible_user.user_id}`)
  ) {
    throw new Error(`${surface} deleted and unknown lookups did not preserve the fixed fail-closed boundary`);
  }
  for (const forbidden of NO_IDENTITY_MARKUP) {
    if (fragments.some((output) => output.includes(forbidden))) throw new Error(`${surface} unknown or hidden lookup leaked ${forbidden}`);
  }
  return { error_fragment_count: fragments.length, forbidden_markup_absent: [...NO_IDENTITY_MARKUP] };
}

function verifySurface(body, fixture, surface) {
  const html = requireNonEmptyString(body, `${surface} HTML`);
  const visible = VISIBLE_MARKERS.map(([marker, fixtureName, starred]) => verifyVisible(html, marker, fixture[fixtureName], surface, starred));
  const hidden = verifyHidden(html, fixture, surface);
  const anonymous = markerFragment(html, "ANONYMOUS");
  if (anonymous !== "ANONYMOUS=Anonymous" || NO_IDENTITY_MARKUP.some((marker) => anonymous.includes(marker))) throw new Error(`${surface} anonymous special identity is not literal`);
  return { html_sha256: sha256Value(html), visible, hidden };
}

export function verifyOpen43Q1026UserIdentityCase(caseId, observations, plan) {
  if (caseId !== "Q1026_EXACT_CANDIDATE_PREVIEW_SAVED_IDENTITY") throw new Error(`unsupported Open43 #1026 case: ${caseId}`);
  const value = object(observations, `${caseId} observations`);
  if (value.source_sha256 !== plan.source_sha256) throw new Error("#1026 candidate source identity changed during execution");
  const page = object(value.page_get, "#1026 candidate page_get observation");
  if (page.site_id !== plan.site_id || page.page_id !== plan.page_id || page.revision_id !== plan.revision_id || page.slug !== plan.page_slug || page.wikitext_sha256 !== plan.source_sha256) {
    throw new Error("#1026 candidate saved fixture identity is not exact");
  }
  const preview = verifySurface(value.preview_body, plan.fixture, "PagePreview");
  const saved = verifySurface(value.saved_body, plan.fixture, "saved page");
  if (preview.html_sha256 !== value.preview_surface_sha256 || saved.html_sha256 !== value.saved_surface_sha256) {
    throw new Error("#1026 candidate surface hashes do not bind their observations");
  }
  const events = object(value.rpc_events, "#1026 candidate RPC events");
  if (JSON.stringify(events.methods) !== JSON.stringify(["page_get", "wikidot_page_preview", "page_view"]) || events.statuses.some((status) => status !== 200)) {
    throw new Error("#1026 candidate did not use the fixed read-only RPC sequence");
  }
  requireSha256(value.preview_surface_sha256, "#1026 preview surface SHA-256");
  requireSha256(value.saved_surface_sha256, "#1026 saved surface SHA-256");
  return {
    verified: true,
    source_sha256: plan.source_sha256,
    page_identity: { site_id: plan.site_id, page_id: plan.page_id, revision_id: plan.revision_id, slug: plan.page_slug },
    preview_surface_sha256: value.preview_surface_sha256,
    saved_surface_sha256: value.saved_surface_sha256,
    visible_lookup_count: preview.visible.length + saved.visible.length,
    hidden_lookup_count: preview.hidden.error_fragment_count + saved.hidden.error_fragment_count,
  };
}

export function verifyOpen43Q1026UserIdentityCleanup(proof, resources) {
  if (!object(proof, "#1026 candidate cleanup proof").public_absence_verified || resources.length !== 0 || proof.mutation_count !== 0) {
    throw new Error("#1026 candidate cleanup did not prove a read-only run");
  }
  return { verified: true, public_absence_verified: true, mutation_count: 0 };
}

export const OPEN43_Q1026_EXPECTED_EM_CONTENTS = Object.freeze([
  "Shared Person",
  "Unknown Avatar User",
  "19102600",
  "Deleted User",
  "v7ws=\"alpha beta\u00a0gamma\"",
  "v7ser=\"serialized body\"",
  "v7text=\"visible text\"",
  "v7arg=\"one\" v7arg=\"two\"",
  "v7arg=\"\"",
  "v7UnknownArgument=\"x\"",
  "v7arg='single quoted' data-v7=unquoted",
]);

export function verifyOpen43Q1026ActorMatrixCase(caseId, observations, plan) {
  if (caseId !== "Q1026_ACTOR_SPECIAL_IDENTITY_MATRIX") throw new Error(`unsupported Open43 #1026 actor matrix case: ${caseId}`);
  const value = object(observations, `${caseId} observations`);
  if (value.source_sha256 !== plan.source_sha256) throw new Error("#1026 actor matrix source identity changed during execution");
  const surfaces = object(value.actor_surfaces, "#1026 actor surfaces");
  const actors = ["anonymous", "editor", "administrator", "other"];
  if (JSON.stringify(Object.keys(surfaces).sort()) !== JSON.stringify([...actors].sort())) throw new Error("#1026 actor matrix denominator changed");
  const baseline = object(surfaces.anonymous, "#1026 anonymous actor surface");
  if (baseline.user_id !== null) throw new Error("#1026 anonymous actor unexpectedly has a user ID");
  for (const actor of actors) {
    const surface = object(surfaces[actor], `#1026 ${actor} actor surface`);
    if (surface.user_id !== plan.actor_user_ids[actor]) throw new Error(`#1026 ${actor} actor identity drifted`);
    requireSha256(surface.preview_sha256, `#1026 ${actor} preview SHA-256`);
    requireSha256(surface.saved_sha256, `#1026 ${actor} saved SHA-256`);
    if (surface.preview_sha256 !== baseline.preview_sha256 || surface.saved_sha256 !== baseline.saved_sha256) throw new Error(`#1026 ${actor} changed user-syntax output by request actor`);
  }
  return { verified: true, actor_count: actors.length, preview_sha256: baseline.preview_sha256, saved_sha256: baseline.saved_sha256 };
}

function verifyPrintuserState(state, fixture, label) {
  const value = object(state, `#1026 ${label}`);
  if (value.printuser_count !== 6 || value.avatarhover_count !== 1) {
    throw new Error(`#1026 ${label} printuser wrapper counts differ from the sealed live matrix`);
  }
  const expectedAnchors = new Map([
    [fixture.visible_user.slug, { user_id: fixture.visible_user.user_id, count: 3 }],
    [fixture.name_only_user.slug, { user_id: fixture.name_only_user.user_id, count: 1 }],
    [fixture.unicode_user.slug, { user_id: fixture.unicode_user.user_id, count: 1 }],
    [fixture.display_numeric_name_user.slug, { user_id: fixture.display_numeric_name_user.user_id, count: 1 }],
    [fixture.system_user.slug, { user_id: fixture.system_user.user_id, count: 1 }],
  ]);
  if (!Array.isArray(value.anchors) || value.anchors.length !== 7) {
    throw new Error(`#1026 ${label} printuser links differ from the sealed live matrix`);
  }
  for (const [slug, expected] of expectedAnchors) {
    const profile = `http://www.wikidot.com/user:info/${slug}`;
    const onclick = `WIKIDOT.page.listeners.userInfo(${expected.user_id}); return false;`;
    if (value.anchors.filter((anchor) => anchor.href === profile && anchor.onclick === onclick).length !== expected.count) throw new Error(`#1026 ${label} printuser link identity is wrong for ${slug}`);
  }
  if (!Array.isArray(value.avatar_images) || value.avatar_images.length !== 1 || value.avatar_images[0].alt !== fixture.visible_user.name || !value.avatar_images[0].style?.includes(`u=${fixture.visible_user.user_id}`)) {
    throw new Error(`#1026 ${label} avatar image count is wrong`);
  }
  if (value.error_count !== OPEN43_Q1026_EXPECTED_EM_CONTENTS.length) {
    throw new Error(`#1026 ${label} missing-user error count differs from the sealed live matrix`);
  }
  if (JSON.stringify(value.error_em_html) !== JSON.stringify(OPEN43_Q1026_EXPECTED_EM_CONTENTS)) {
    throw new Error(`#1026 ${label} missing-user em contents differ from the sealed live matrix`);
  }
  if (!Array.isArray(value.error_texts) || value.error_texts.some((text) => typeof text !== "string" || !text.endsWith(" does not match any existing user name"))) {
    throw new Error(`#1026 ${label} missing-user error text is wrong`);
  }
  if (!Array.isArray(value.error_anchor_counts) || value.error_anchor_counts.some((count) => count !== 0)) {
    throw new Error(`#1026 ${label} missing-user error leaked a link or avatar authority`);
  }
  if (value.anonymous_literal_present !== true) throw new Error(`#1026 ${label} anonymous special identity did not stay literal`);
  return {
    printuser_count: value.printuser_count,
    avatarhover_count: value.avatarhover_count,
    error_count: value.error_count,
    anchor_count: value.anchors.length,
  };
}

function expectedPrintuserCspFailure(request, fixture) {
  if (request?.method !== "GET" || request.failure !== "csp") return false;
  const urls = new Set([
    `https://www.wikidot.com/avatar.php?userid=${fixture.visible_user.user_id}&amp;size=small`,
    `https://www.wikidot.com/userkarma.php?u=${fixture.visible_user.user_id}`,
  ]);
  return urls.has(request.url);
}

export function verifyOpen43Q1026PrintuserIntervalsCase(caseId, observations, plan) {
  if (caseId !== "Q1026_BROWSER_PRINTUSER_INTERVALS") throw new Error(`unsupported Open43 #1026 case: ${caseId}`);
  const value = object(observations, `${caseId} observations`);
  const saved = object(value.saved_page, "#1026 printuser saved page");
  if (saved.slug !== plan.page_slug || saved.status !== 200 || saved.url !== `${plan.page_origin}/${plan.page_slug}`) {
    throw new Error("#1026 printuser saved fixture identity is wrong");
  }
  const initial = verifyPrintuserState(value.initial, plan.fixture, "initial printuser state");
  const settled = verifyPrintuserState(value.settled, plan.fixture, "settled printuser state");
  if (!Array.isArray(value.request_methods) || value.request_methods.some((method) => !["GET", "HEAD", "OPTIONS"].includes(method))) {
    throw new Error("#1026 printuser candidate issued a mutating request");
  }
  if (!Array.isArray(value.failed_requests) || value.failed_requests.some((request) => !expectedPrintuserCspFailure(request, plan.fixture))) {
    throw new Error("#1026 printuser candidate observed failed requests");
  }
  if (value.mutation_detected !== false) throw new Error("#1026 printuser candidate mutation was detected");
  return {
    verified: true,
    saved_page_slug: saved.slug,
    initial,
    settled,
    request_methods: value.request_methods,
    expected_csp_failures: value.failed_requests.length,
  };
}
