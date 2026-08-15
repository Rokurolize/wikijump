import {
  requireNonEmptyString,
  requirePlainObject,
  requireSha256,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

const VISIBLE_MARKERS = Object.freeze(["NAME", "ID"]);
const NO_IDENTITY_MARKUP = Object.freeze(["<a", "onclick=", "printuser", "avatar"]);

function object(value, name) {
  return requirePlainObject(value, name);
}

function verifyVisible(body, marker, user, surface) {
  const profile = `http://www.wikidot.com/user:info/${user.slug}`;
  const onclick = `WIKIDOT.page.listeners.userInfo(${user.user_id}); return false;`;
  if (!body.includes(profile) || !body.includes(onclick) || !body.includes(`>${user.name}</a>`)) {
    throw new Error(`${surface} ${marker} lookup did not render the fixed visible identity`);
  }
  return { marker, profile, onclick };
}

function verifyHidden(body, user, surface) {
  const fragments = [...body.matchAll(/<span class="error-inline">[\s\S]*?<\/span>/gu)].map(([output]) => output);
  if (fragments.length !== 8 || !body.includes(`${user.name}`) || !body.includes("does not match any existing user name") || body.includes(`user:info/${user.slug}`)) {
    throw new Error(`${surface} deleted and unknown lookups did not preserve the fixed fail-closed boundary`);
  }
  for (const forbidden of NO_IDENTITY_MARKUP) {
    if (fragments.some((output) => output.includes(forbidden))) throw new Error(`${surface} unknown or hidden lookup leaked ${forbidden}`);
  }
  return { error_fragment_count: fragments.length, forbidden_markup_absent: [...NO_IDENTITY_MARKUP] };
}

function verifySurface(body, fixture, surface) {
  const html = requireNonEmptyString(body, `${surface} HTML`);
  const visible = VISIBLE_MARKERS.map((marker) => verifyVisible(html, marker, fixture.visible_user, surface));
  const hidden = verifyHidden(html, fixture.deleted_user, surface);
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
