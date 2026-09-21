import fs from "node:fs/promises";
import {gunzip as gunzipCallback} from "node:zlib";
import {promisify} from "node:util";

export const OFFLINE_BROWSER_RESPONSE_FIXTURE_SCHEMA =
  "wikijump.offline_browser_response_fixture.v1";

const gunzip = promisify(gunzipCallback);
const CONDITIONAL_MARKER = "#__wikijump_evidence_request=";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 10;

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function baseUrl(key) {
  return key.split(CONDITIONAL_MARKER, 1)[0];
}

function normalizedEntry(entry, index) {
  const value = requireObject(entry, `offline response entry ${index}`);
  if (typeof value.key !== "string" || !/^https?:\/\//u.test(value.key)) {
    throw new Error(`offline response entry ${index} has an invalid key`);
  }
  if (!Number.isInteger(value.status) || value.status < 100 || value.status > 599) {
    throw new Error(`offline response entry ${index} has an invalid status`);
  }
  if (typeof value.body_base64 !== "string") {
    throw new Error(`offline response entry ${index} has no body`);
  }
  const body = Buffer.from(value.body_base64, "base64");
  if (body.toString("base64") !== value.body_base64) {
    throw new Error(`offline response entry ${index} has malformed base64`);
  }
  const headers = requireObject(value.headers, `offline response entry ${index} headers`);
  if (
    Object.entries(headers).some(
      ([name, headerValue]) =>
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) ||
        typeof headerValue !== "string",
    )
  ) {
    throw new Error(`offline response entry ${index} has malformed headers`);
  }
  return {
    key: value.key,
    url: baseUrl(value.key),
    status: value.status,
    headers,
    body,
  };
}

function responseSignature(entry) {
  const browserSignificantHeaders = new Set([
    "access-control-allow-credentials",
    "access-control-allow-origin",
    "content-disposition",
    "content-security-policy",
    "content-type",
    "cross-origin-embedder-policy",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
    "location",
    "referrer-policy",
    "x-content-type-options",
  ]);
  const headers = Object.fromEntries(
    Object.entries(entry.headers)
      .filter(([name]) => browserSignificantHeaders.has(name.toLowerCase()))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return JSON.stringify([
    entry.status,
    headers,
    entry.body.toString("base64"),
  ]);
}

function selectReplayable(entries, url) {
  const replayable = entries.filter((entry) => entry.status !== 304);
  if (replayable.length === 0) {
    throw new Error(`offline response fixture contains only 304 for ${url}`);
  }
  const signatures = new Set(replayable.map(responseSignature));
  if (signatures.size !== 1) {
    throw new Error(`offline response fixture has conflicting replayable variants for ${url}`);
  }
  return replayable[0];
}

function resolveRetainedRedirect(responses, startUrl) {
  let url = startUrl;
  const chain = [];
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const entry = responses.get(url);
    if (!entry) return null;
    chain.push(url);
    if (!REDIRECT_STATUSES.has(entry.status)) return {entry, chain};
    const location = entry.headers.location;
    if (!location) return {entry, chain};
    const target = new URL(location, url).href;
    if (chain.includes(target)) {
      throw new Error(`offline response fixture redirect cycle at ${target}`);
    }
    url = target;
  }
  throw new Error(`offline response fixture redirect limit exceeded for ${startUrl}`);
}

export async function loadOfflineBrowserResponseFixture(filePath) {
  const compressed = await fs.readFile(filePath);
  const raw = await gunzip(compressed);
  const fixture = JSON.parse(raw.toString("utf8"));
  if (fixture.schema !== OFFLINE_BROWSER_RESPONSE_FIXTURE_SCHEMA) {
    throw new Error(
      `offline response fixture must use ${OFFLINE_BROWSER_RESPONSE_FIXTURE_SCHEMA}`,
    );
  }
  if (typeof fixture.identity !== "string" || fixture.identity.length === 0) {
    throw new Error("offline response fixture identity is missing");
  }
  if (!Array.isArray(fixture.entries) || fixture.entries.length === 0) {
    throw new Error("offline response fixture has no entries");
  }
  const grouped = new Map();
  fixture.entries.map(normalizedEntry).forEach((entry) => {
    const existing = grouped.get(entry.url) ?? [];
    existing.push(entry);
    grouped.set(entry.url, existing);
  });
  const responses = new Map(
    [...grouped.entries()].map(([url, entries]) => [
      url,
      selectReplayable(entries, url),
    ]),
  );
  return Object.freeze({
    schema: fixture.schema,
    identity: fixture.identity,
    roots: Object.freeze([...(fixture.roots ?? [])]),
    closureUrls: Object.freeze([...(fixture.closure_urls ?? [])]),
    missingUrls: Object.freeze([...(fixture.missing_urls ?? [])]),
    entryCount: fixture.entries.length,
    responseCount: responses.size,
    lookup(rawUrl) {
      const url = new URL(rawUrl).href;
      const resolved = resolveRetainedRedirect(responses, url);
      if (!resolved) return null;
      const {entry, chain} = resolved;
      return {
        status: entry.status,
        headers: {...entry.headers},
        body: entry.body,
        original_url: url,
        resolved_url: chain.at(-1),
        redirect_chain: chain,
      };
    },
  });
}
