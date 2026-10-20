/**
 * Roster import manifests (offline half of #2205 voters, #2172 watchers,
 * #2073 members).
 *
 * This module turns captured wikidot.py outputs into deterministic import
 * manifests with provenance. It performs no live fetches: its input is a
 * capture envelope whose user objects mirror the shapes documented in the
 * wikidot.py `llms.txt` reference (AbstractUser id/name/unix_name/
 * avatar_url, PageVote user+value, SiteMember user+joined_at, and the
 * site moderators/admins lists). Watcher rosters are lists of the same
 * user objects. Anything the documented shapes do not cover is passed
 * through verbatim and tagged, never synthesized or dropped silently.
 *
 * Determinism contract (verify mode re-checks all of it):
 * - rows are sorted by (page, user key) or user key with code-point order;
 * - the manifest hash is the sha256 of the canonical (stable-stringified)
 *   manifest body, so byte-identical inputs always yield byte-identical
 *   manifests;
 * - duplicate (page, user) vote rows with the same value collapse to one
 *   row; conflicting values fail closed instead of picking a winner;
 * - member roles are the union across the members/moderators/admins
 *   lists with the earliest joined_at kept.
 */

import { codePointCompare, sha256Hex, stableStringify } from "./canonical-json.mjs";

export const ROSTER_MANIFEST_SCHEMA = "wikijump.roster_import_manifest.v1";

const USER_KINDS = new Set(["regular", "deleted", "anonymous", "guest", "wikidot"]);
const MEMBER_ROLES = new Set(["member", "moderator", "admin"]);

function fail(message) {
  throw new Error(`roster manifest: ${message}`);
}

function assertRecord(value, what) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`expected an object for ${what}`);
  }
  return value;
}

function assertNonEmptyString(value, what) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`expected a non-empty string for ${what}`);
  }
  return value;
}

function assertOptionalString(value, what) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(`expected a string or null for ${what}`);
  return value;
}

function assertOptionalInteger(value, what) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(`expected an integer or null for ${what}`);
  }
  return value;
}

function assertOptionalIsoDateTime(value, what) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    fail(`expected an ISO-8601 datetime or null for ${what}`);
  }
  return value;
}

/**
 * Canonical user reference. `kind` tags the documented wikidot.py user
 * taxonomy (regular/deleted/anonymous/guest/wikidot) and passes through
 * untouched: deleted and anonymous roster entries are real roster state,
 * not synthesizable identities.
 */
export function normalizeCaptureUser(raw, what) {
  const user = assertRecord(raw, what);
  const id = assertOptionalInteger(user.id, `${what}.id`);
  const name = assertOptionalString(user.name, `${what}.name`);
  const unixName = assertOptionalString(user.unix_name, `${what}.unix_name`);
  const avatarUrl = assertOptionalString(user.avatar_url, `${what}.avatar_url`);
  const ip = assertOptionalString(user.ip, `${what}.ip`);
  let kind = "regular";
  if (user.kind !== undefined && user.kind !== null) {
    if (typeof user.kind !== "string" || !USER_KINDS.has(user.kind)) {
      fail(`unknown user kind for ${what}: ${JSON.stringify(user.kind)}`);
    }
    kind = user.kind;
  }
  if (id === null && unixName === null && name === null && ip === null) {
    fail(`user ${what} has no id, unix_name, name, or ip to key on`);
  }
  const normalized = { kind };
  if (id !== null) normalized.id = id;
  if (unixName !== null) normalized.unix_name = unixName;
  if (name !== null) normalized.name = name;
  if (avatarUrl !== null) normalized.avatar_url = avatarUrl;
  if (ip !== null) normalized.ip = ip;
  return normalized;
}

/**
 * Preferred identity key: numeric id, then unix name, then display name,
 * then anonymous IP (the documented AnonymousUser key).
 */
export function captureUserKey(user) {
  if (user.id !== undefined && user.id !== null) return `id:${user.id}`;
  if (user.unix_name !== undefined && user.unix_name !== null) return `unix:${user.unix_name}`;
  if (user.name !== undefined && user.name !== null) return `name:${user.name}`;
  return `ip:${user.ip}`;
}

function compareRows(left, right) {
  return (
    codePointCompare(left.page ?? "", right.page ?? "") ||
    codePointCompare(captureUserKey(left.user), captureUserKey(right.user))
  );
}

function normalizeVoteValue(raw, what) {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    fail(`expected an integer vote value for ${what}, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

function buildVoterRows(pages) {
  if (!Array.isArray(pages)) fail("voters capture needs a pages array");
  const rows = [];
  const seen = new Map();
  for (const entry of pages) {
    const page = assertNonEmptyString(assertRecord(entry, "pages[]").page, "pages[].page");
    const votes = assertRecord(entry, `pages[${page}]`).votes;
    if (!Array.isArray(votes)) fail(`expected a votes array for page ${page}`);
    for (const vote of votes) {
      const record = assertRecord(vote, `votes[] on ${page}`);
      const row = {
        page,
        user: normalizeCaptureUser(record.user, `voter on ${page}`),
        value: normalizeVoteValue(record.value, `vote on ${page}`),
      };
      const key = `${page}\u0000${captureUserKey(row.user)}`;
      const prior = seen.get(key);
      if (prior !== undefined) {
        if (prior !== row.value) {
          fail(`conflicting vote values for ${key}: ${prior} vs ${row.value}`);
        }
        continue;
      }
      seen.set(key, row.value);
      rows.push(row);
    }
  }
  rows.sort(compareRows);
  return rows;
}

function buildWatcherRows(pages) {
  if (!Array.isArray(pages)) fail("watchers capture needs a pages array");
  const rows = [];
  const seen = new Set();
  for (const entry of pages) {
    const page = assertNonEmptyString(assertRecord(entry, "pages[]").page, "pages[].page");
    const watchers = assertRecord(entry, `pages[${page}]`).watchers;
    if (!Array.isArray(watchers)) fail(`expected a watchers array for page ${page}`);
    for (const watcher of watchers) {
      const row = {
        page,
        user: normalizeCaptureUser(watcher, `watcher on ${page}`),
      };
      const key = `${page}\u0000${captureUserKey(row.user)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  rows.sort(compareRows);
  return rows;
}

function buildMemberRows(capture) {
  const lists = { member: [], moderator: [], admin: [] };
  for (const [key, role] of [["members", "member"], ["moderators", "moderator"], ["admins", "admin"]]) {
    const entries = capture[key] ?? [];
    if (!Array.isArray(entries)) fail(`expected an array for ${key}`);
    for (const item of entries) {
      const record = assertRecord(item, `${key}[]`);
      lists[role].push({
        user: normalizeCaptureUser(record.user, `${key}[] user`),
        joined_at: assertOptionalIsoDateTime(record.joined_at, `${key}[] joined_at`),
      });
    }
  }
  const merged = new Map();
  for (const role of ["member", "moderator", "admin"]) {
    const sorted = [...lists[role]].sort((left, right) =>
      codePointCompare(captureUserKey(left.user), captureUserKey(right.user)),
    );
    for (const { user, joined_at } of sorted) {
      const key = captureUserKey(user);
      let row = merged.get(key);
      if (row === undefined) {
        row = { user, roles: [], joined_at: null };
        merged.set(key, row);
      }
      if (!row.roles.includes(role)) row.roles.push(role);
      if (joined_at !== null && (row.joined_at === null || joined_at < row.joined_at)) {
        row.joined_at = joined_at;
      }
    }
  }
  const rows = [...merged.values()];
  rows.sort((left, right) =>
    codePointCompare(captureUserKey(left.user), captureUserKey(right.user)),
  );
  return rows;
}

function manifestBody({ kind, source, provenance, rows }) {
  return { schema: ROSTER_MANIFEST_SCHEMA, kind, source, provenance, rows, row_count: rows.length };
}

/**
 * Build a deterministic roster import manifest from a capture envelope.
 * The envelope carries provenance (`capture_id`, `captured_at`,
 * `collector`); the manifest binds the canonical capture bytes with
 * `capture_sha256` so a manifest can only verify against the exact
 * capture that produced it.
 */
export function buildRosterManifest(capture) {
  const input = assertRecord(capture, "capture");
  const kind = input.kind;
  if (kind !== "voters" && kind !== "watchers" && kind !== "members") {
    fail(`unknown roster kind: ${JSON.stringify(kind)}`);
  }
  const source = {
    site: assertNonEmptyString(input.site, "site"),
    branch: assertNonEmptyString(input.branch ?? "en", "branch"),
  };
  const provenance = {
    collector: assertNonEmptyString(input.collector ?? "wikidot.py", "collector"),
    capture_id: assertNonEmptyString(input.capture_id, "capture_id"),
    captured_at: assertNonEmptyString(input.captured_at, "captured_at"),
    capture_sha256: sha256Hex(stableStringify(input)),
  };
  let rows;
  if (kind === "voters") rows = buildVoterRows(input.pages);
  else if (kind === "watchers") rows = buildWatcherRows(input.pages);
  else rows = buildMemberRows(input);
  const body = manifestBody({ kind, source, provenance, rows });
  return { ...body, manifest_sha256: sha256Hex(stableStringify(body)) };
}

/**
 * Verify a manifest: schema and kind, canonical row order, row count, the
 * manifest hash, and — when the capture is supplied — byte-identical
 * reproducibility from that capture.
 */
export function verifyRosterManifest(manifest, capture = null) {
  const problems = [];
  const check = (ok, message) => {
    if (!ok) problems.push(message);
  };
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { ok: false, problems: ["manifest is not an object"] };
  }
  check(manifest.schema === ROSTER_MANIFEST_SCHEMA, `unexpected schema ${JSON.stringify(manifest.schema)}`);
  check(
    manifest.kind === "voters" || manifest.kind === "watchers" || manifest.kind === "members",
    `unexpected kind ${JSON.stringify(manifest.kind)}`,
  );
  check(Array.isArray(manifest.rows), "rows is not an array");
  check(manifest.row_count === (Array.isArray(manifest.rows) ? manifest.rows.length : -1), "row_count mismatch");
  if (Array.isArray(manifest.rows)) {
    const sorted = [...manifest.rows].sort(
      manifest.kind === "members"
        ? (left, right) => codePointCompare(captureUserKey(left.user), captureUserKey(right.user))
        : compareRows,
    );
    check(
      stableStringify(sorted) === stableStringify(manifest.rows),
      "rows are not in canonical order",
    );
  }
  const { manifest_sha256, ...body } = manifest;
  check(
    typeof manifest_sha256 === "string" && manifest_sha256 === sha256Hex(stableStringify(body)),
    "manifest_sha256 mismatch",
  );
  if (capture !== null && problems.length === 0) {
    let rebuilt;
    try {
      rebuilt = buildRosterManifest(capture);
    } catch (error) {
      return { ok: false, problems: [...problems, `capture rebuild failed: ${error.message}`] };
    }
    check(
      stableStringify(rebuilt) === stableStringify(manifest),
      "manifest does not reproduce from the capture",
    );
  }
  return { ok: problems.length === 0, problems };
}
