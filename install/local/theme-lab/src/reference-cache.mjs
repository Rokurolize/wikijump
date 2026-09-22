// Content-addressed acquisition of foreign reference resources.
//
// A reference page is fetched once, its stylesheets/@imports/url() assets and
// fonts are fetched once, everything is stored by SHA-256, and later runs read
// only from disk. Routine iteration never contacts the foreign Wikidot/WDFiles
// origin.

import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {fail} from "./errors.mjs";

export const DEFAULT_LIMITS = Object.freeze({
  maxObjectBytes: 8 * 1024 * 1024,
  maxAssets: 200,
  maxRedirects: 5,
  maxImportDepth: 8,
  timeoutMs: 15_000,
});

export function defaultCacheDir(env = process.env) {
  const base = env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(base, "wikijump", "theme-lab");
}

export function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function objectPath(digest) {
  return path.join("objects", digest.slice(0, 2), digest);
}

export function resolveUrl(base, ref) {
  return new URL(ref, base).href;
}

const PRIVATE_V4 = [
  /^10\./u,
  /^127\./u,
  /^169\.254\./u,
  /^192\.168\./u,
  /^172\.(1[6-9]|2\d|3[01])\./u,
  /^0\./u,
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./u,
];

export function isPrivateAddress(address) {
  const value = address.toLowerCase();
  if (value === "::1" || value === "::") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true; // unique local
  if (value.startsWith("fe80")) return true; // link local
  if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice("::ffff:".length));
  return PRIVATE_V4.some((pattern) => pattern.test(value));
}

export function assertFetchableUrl(value, {allowPrivate = false} = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("reference_invalid_url", `reference URL is not valid: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail("reference_blocked_scheme", `reference scheme is not allowed: ${url.protocol}`, {url: value});
  }
  if (url.username || url.password) {
    fail("reference_blocked_credentials", "reference URL must not embed credentials", {url: value});
  }
  if (!allowPrivate && (url.hostname === "localhost" || url.hostname.endsWith(".localhost"))) {
    fail("reference_blocked_private_host", `reference host is loopback: ${url.hostname}`, {url: value});
  }
  if (!allowPrivate && /^\d+\.\d+\.\d+\.\d+$/u.test(url.hostname) && isPrivateAddress(url.hostname)) {
    fail("reference_blocked_private_host", `reference host is private: ${url.hostname}`, {url: value});
  }
  return url;
}

export async function assertPublicDns(value, {allowPrivate = false, lookup = dns.lookup} = {}) {
  if (allowPrivate) return;
  const {hostname} = new URL(value);
  if (/^\d+\.\d+\.\d+\.\d+$/u.test(hostname) || hostname.includes(":")) return;
  let records;
  try {
    records = await lookup(hostname, {all: true});
  } catch {
    fail("reference_dns_failure", `could not resolve reference host: ${hostname}`, {url: value});
  }
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      fail("reference_blocked_private_host", `reference host resolves to a private address: ${record.address}`, {
        url: value,
      });
    }
  }
}

function splitCssValue(value) {
  return value.replace(/["']/gu, "").trim();
}

export function extractCssReferences(cssText, baseUrl) {
  const imports = [];
  const assets = [];
  const importPattern = /@import\s+(?:url\(\s*)?["']?([^"')]+)["']?\s*\)?([^;]*);/gu;
  let match;
  let assetText = cssText;
  while ((match = importPattern.exec(cssText)) !== null) {
    imports.push({url: resolveUrl(baseUrl, splitCssValue(match[1])), raw: match[0]});
    assetText = assetText.split(match[0]).join(" ");
  }
  const urlPattern = /url\(\s*["']?([^"')]+)["']?\s*\)/gu;
  while ((match = urlPattern.exec(assetText)) !== null) {
    const raw = splitCssValue(match[1]);
    if (raw.startsWith("data:") || raw.startsWith("#") || raw.startsWith("blob:")) continue;
    assets.push({url: resolveUrl(baseUrl, raw), raw});
  }
  return {imports, assets};
}

const HTML_REFERENCE_ATTRIBUTES = [
  {pattern: /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/giu, group: 1},
  {pattern: /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/giu, group: 1},
  {pattern: /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/giu, group: 1},
  {pattern: /<source\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/giu, group: 1},
  {pattern: /\bsrcset\s*=\s*["']([^"']+)["']/giu, group: 1, srcset: true},
];

export function extractHtmlReferences(html, baseUrl) {
  const references = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    references.push(url);
  };
  // Only http(s) references are ever fetched. Resolving first means data:,
  // javascript:, vbscript:, file:, and other schemes are rejected uniformly.
  const pushResolved = (raw) => {
    if (!raw || raw.startsWith("#")) return;
    let resolved;
    try {
      resolved = resolveUrl(baseUrl, raw);
    } catch {
      return;
    }
    if (resolved.startsWith("http:") || resolved.startsWith("https:")) push(resolved);
  };
  for (const {pattern, srcset} of HTML_REFERENCE_ATTRIBUTES) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(html)) !== null) {
      const value = match[1];
      if (srcset) {
        for (const candidate of value.split(",")) {
          pushResolved(candidate.trim().split(/\s+/u)[0]);
        }
      } else {
        pushResolved(value);
      }
    }
  }
  const styleAttribute = /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/giu;
  let match;
  while ((match = styleAttribute.exec(html)) !== null) {
    const value = match[2] ?? match[3] ?? "";
    const {assets} = extractCssReferences(value, baseUrl);
    for (const asset of assets) push(asset.url);
  }
  const styleElement = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu;
  while ((match = styleElement.exec(html)) !== null) {
    const {imports, assets} = extractCssReferences(match[1], baseUrl);
    for (const entry of [...imports, ...assets]) push(entry.url);
  }
  return references;
}

function localFor(raw, baseUrl, urlToLocal) {
  const value = splitCssValue(raw);
  if (!value || value.startsWith("data:") || value.startsWith("#") || value.startsWith("blob:")) return null;
  return urlToLocal.get(resolveUrl(baseUrl, value)) ?? null;
}

export function rewriteCssReferences(cssText, baseUrl, urlToLocal) {
  const rewritten = cssText.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gu, (whole, raw) => {
    const local = localFor(raw, baseUrl, urlToLocal);
    return local ? `url("${local}")` : whole;
  });
  return rewritten.replace(
    /@import\s+(?:url\(\s*)?(["']?)([^"');]+)\1\s*\)?/giu,
    (whole, quote, raw) => {
      const local = localFor(raw, baseUrl, urlToLocal);
      return local ? `@import url("${local}")` : whole;
    },
  );
}

const HTML_REWRITE_PATTERNS = [
  /(<link\b[^>]*\bhref\s*=\s*)(["'])([^"']+)(\2)/giu,
  /(<script\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)(\2)/giu,
  /(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)(\2)/giu,
  /(<source\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)(\2)/giu,
];

export function rewriteHtmlReferences(html, baseUrl, urlToLocal) {
  let output = html;
  for (const pattern of HTML_REWRITE_PATTERNS) {
    output = output.replace(pattern, (whole, prefix, quote, raw) => {
      const local = localFor(raw, baseUrl, urlToLocal);
      return local ? `${prefix}${quote}${local}${quote}` : whole;
    });
  }
  output = output.replace(
    /(\bsrcset\s*=\s*)(["'])([^"']+)(\2)/giu,
    (whole, prefix, quote, value) => {
      const rewritten = value
        .split(",")
        .map((candidate) => {
          const trimmed = candidate.trim();
          const [url, ...descriptor] = trimmed.split(/\s+/u);
          const local = localFor(url, baseUrl, urlToLocal);
          return local ? [local, ...descriptor].join(" ") : trimmed;
        })
        .join(", ");
      return `${prefix}${quote}${rewritten}${quote}`;
    },
  );
  output = output.replace(/(\bstyle\s*=\s*)(["'])([^"']*)(\2)/giu, (whole, prefix, quote, value) => {
    const rewritten = value.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gu, (urlWhole, raw) => {
      const local = localFor(raw, baseUrl, urlToLocal);
      return local ? `url("${local}")` : urlWhole;
    });
    return `${prefix}${quote}${rewritten}${quote}`;
  });
  output = output.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/giu, (whole, open, css, close) =>
    `${open}${rewriteCssReferences(css, baseUrl, urlToLocal)}${close}`,
  );
  return output;
}

export function contentTypeIsCss(contentType) {
  return /text\/css/iu.test(contentType ?? "");
}

export function contentTypeIsHtml(contentType) {
  return /text\/html/iu.test(contentType ?? "");
}

export class ReferenceCache {
  #fetchImpl;
  #lookup;

  constructor({
    cacheDir = defaultCacheDir(),
    limits = DEFAULT_LIMITS,
    allowPrivate = false,
    fetchImpl = globalThis.fetch,
    lookup = dns.lookup,
  } = {}) {
    this.cacheDir = cacheDir;
    this.limits = {...DEFAULT_LIMITS, ...limits};
    this.allowPrivate = allowPrivate;
    this.#fetchImpl = fetchImpl;
    this.#lookup = lookup;
    this.manifest = null;
    this.externalRequests = 0;
    this.cacheHits = 0;
    this.failedAssets = [];
  }

  get manifestPath() {
    return path.join(this.cacheDir, "manifest.json");
  }

  get objectDir() {
    return path.join(this.cacheDir, "objects");
  }

  async load() {
    if (this.manifest) return this.manifest;
    try {
      this.manifest = JSON.parse(await fs.readFile(this.manifestPath, "utf8"));
    } catch {
      this.manifest = {version: 1, objects: {}, urls: {}, snapshots: {}};
    }
    this.manifest.objects ??= {};
    this.manifest.urls ??= {};
    this.manifest.snapshots ??= {};
    this.manifest.failures ??= {};
    return this.manifest;
  }

  async save() {
    await fs.mkdir(this.cacheDir, {recursive: true});
    const temporary = `${this.manifestPath}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(this.manifest, null, 2)}\n`, {mode: 0o600});
    await fs.rename(temporary, this.manifestPath);
  }

  async readObject(digest) {
    return fs.readFile(path.join(this.cacheDir, objectPath(digest)));
  }

  async storeObject(bytes, contentType, {originalUrl = null, finalUrl = null} = {}) {
    const digest = sha256Hex(bytes);
    const target = path.join(this.cacheDir, objectPath(digest));
    if (!this.manifest.objects[digest]) {
      await fs.mkdir(path.dirname(target), {recursive: true});
      await fs.writeFile(target, bytes, {mode: 0o644});
      this.manifest.objects[digest] = {
        content_type: contentType,
        bytes: bytes.length,
        original_urls: [],
      };
    }
    const record = this.manifest.objects[digest];
    if (originalUrl && !record.original_urls.includes(originalUrl)) record.original_urls.push(originalUrl);
    return {digest, content_type: contentType, bytes: bytes.length, final_url: finalUrl ?? originalUrl};
  }

  async fetchRaw(url, {offline = false} = {}) {
    const manifest = await this.load();
    const cached = manifest.urls[url];
    if (cached) {
      this.cacheHits += 1;
      const bytes = await this.readObject(cached.digest);
      return {digest: cached.digest, bytes, content_type: cached.content_type, final_url: cached.final_url, from_cache: true};
    }
    if (offline) {
      fail("reference_offline_miss", `offline reference cache has no entry for ${url}`, {url});
    }
    const fetched = await this.#download(url);
    const stored = await this.storeObject(fetched.bytes, fetched.content_type, {originalUrl: url, finalUrl: fetched.final_url});
    manifest.urls[url] = {
      digest: stored.digest,
      final_url: fetched.final_url,
      content_type: fetched.content_type,
      fetched_at: new Date().toISOString(),
    };
    return {...stored, bytes: fetched.bytes, from_cache: false};
  }

  async #download(url) {
    let current = url;
    for (let redirect = 0; redirect <= this.limits.maxRedirects; redirect += 1) {
      assertFetchableUrl(current, {allowPrivate: this.allowPrivate});
      await assertPublicDns(current, {allowPrivate: this.allowPrivate, lookup: this.#lookup});
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.limits.timeoutMs);
      let response;
      try {
        this.externalRequests += 1;
        response = await this.#fetchImpl(current, {redirect: "manual", signal: controller.signal});
      } catch (error) {
        fail("reference_fetch_failed", `reference fetch failed for ${current}: ${error.message}`, {url: current});
      } finally {
        clearTimeout(timer);
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) fail("reference_redirect_without_location", `redirect without Location for ${current}`, {url: current});
        current = resolveUrl(current, location);
        continue;
      }
      if (!response.ok) {
        fail("reference_http_error", `reference fetch returned HTTP ${response.status} for ${current}`, {url: current, status: response.status});
      }
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > this.limits.maxObjectBytes) {
        fail("reference_object_too_large", `reference object exceeds ${this.limits.maxObjectBytes} bytes`, {url: current});
      }
      const bytes = await readLimited(response, this.limits.maxObjectBytes, current);
      return {
        bytes,
        content_type: response.headers.get("content-type") ?? "application/octet-stream",
        final_url: response.url || current,
      };
    }
    fail("reference_too_many_redirects", `too many redirects for ${url}`, {url});
  }

  // Acquire a root page and every same-origin-ish subresource it needs.
  async acquire(rootUrl, {offline = false} = {}) {
    await this.load();
    this.externalRequests = 0;
    this.cacheHits = 0;
    this.failedAssets = [];
    const retained = this.manifest.snapshots[rootUrl];
    if (retained?.replay_complete === true && Array.isArray(retained.object_digests)) {
      for (const digest of retained.object_digests) {
        try {
          await fs.access(path.join(this.cacheDir, objectPath(digest)));
        } catch {
          fail("reference_cache_corrupt", `cached reference object is missing: ${digest}`, {digest});
        }
      }
      this.cacheHits = 1;
      return {
        root_url: rootUrl,
        entry: retained.entry,
        asset_count: retained.assets,
        external_requests: 0,
        cache_hits: 1,
        failed_assets: retained.failed_asset_details ?? [],
        failed_asset_count: retained.failed_assets,
      };
    }
    const urlToLocal = new Map();
    const root = await this.fetchRaw(rootUrl, {offline});
    const rootText = root.bytes.toString("utf8");
    const references = extractHtmlReferences(rootText, rootUrl);
    const pending = references.map((url) => ({url, depth: 0}));
    let assetCount = 0;
    const visited = new Set();
    while (pending.length > 0) {
      const {url, depth} = pending.shift();
      if (visited.has(url)) continue;
      visited.add(url);
      if (assetCount >= this.limits.maxAssets || depth > this.limits.maxImportDepth) {
        const code = assetCount >= this.limits.maxAssets ? "reference_asset_limit" : "reference_import_depth";
        this.failedAssets.push({url, code, message: `reference asset omitted by ${code}`});
        urlToLocal.set(url, "/missing");
        continue;
      }
      if (this.manifest.failures[url]) {
        this.failedAssets.push({url, ...this.manifest.failures[url]});
        urlToLocal.set(url, "/missing");
        continue;
      }
      let record;
      try {
        record = await this.fetchRaw(url, {offline});
      } catch (error) {
        if (error?.code === "reference_offline_miss") throw error;
        // Optional subresources may 404 or time out; keep the snapshot local by
        // pointing them at the replay server's missing path instead of the
        // foreign origin.
        const failure = {code: error?.code ?? "reference_error", message: error?.message ?? String(error)};
        this.manifest.failures[url] = failure;
        this.failedAssets.push({url, ...failure});
        urlToLocal.set(url, "/missing");
        continue;
      }
      assetCount += 1;
      if (contentTypeIsCss(record.content_type)) {
        const cssText = record.bytes.toString("utf8");
        const {imports, assets} = extractCssReferences(cssText, record.final_url ?? url);
        for (const entry of [...imports, ...assets]) {
          if (!visited.has(entry.url)) pending.push({url: entry.url, depth: depth + 1});
        }
        const localMap = await this.#localizeCss(cssText, record.final_url ?? url, depth, offline, visited);
        for (const [key, value] of localMap) urlToLocal.set(key, value);
        const rewritten = rewriteCssReferences(cssText, record.final_url ?? url, urlToLocal);
        const stored = await this.storeObject(Buffer.from(rewritten), record.content_type, {originalUrl: url});
        urlToLocal.set(url, `/o/${stored.digest}`);
      } else {
        urlToLocal.set(url, `/o/${record.digest}`);
      }
    }
    const renderedHtml = rewriteHtmlReferences(rootText, rootUrl, urlToLocal);
    const entry = await this.storeObject(Buffer.from(renderedHtml), "text/html; charset=utf-8", {originalUrl: rootUrl});
    const objectDigests = [...new Set([entry.digest, ...[...urlToLocal.values()]
      .filter((value) => value.startsWith("/o/"))
      .map((value) => value.slice(3))])];
    this.manifest.snapshots[rootUrl] = {
      entry: `/o/${entry.digest}`,
      created_at: new Date().toISOString(),
      assets: urlToLocal.size,
      failed_assets: this.failedAssets.length,
      failed_asset_details: this.failedAssets.slice(0, 20),
      replay_complete: true,
      object_digests: objectDigests,
    };
    await this.save();
    return {
      root_url: rootUrl,
      entry: `/o/${entry.digest}`,
      asset_count: urlToLocal.size,
      external_requests: this.externalRequests,
      cache_hits: this.cacheHits,
      failed_assets: this.failedAssets.slice(0, 20),
      failed_asset_count: this.failedAssets.length,
    };
  }

  async #localizeCss(cssText, baseUrl, depth, offline, visited) {
    const map = new Map();
    const {imports, assets} = extractCssReferences(cssText, baseUrl);
    for (const entry of [...imports, ...assets]) {
      if (visited.has(entry.url)) continue;
      visited.add(entry.url);
      if (depth + 1 > this.limits.maxImportDepth) {
        map.set(entry.url, "/missing");
        this.failedAssets.push({url: entry.url, code: "reference_import_depth", message: "reference CSS import depth exceeded"});
        continue;
      }
      if (this.manifest.failures[entry.url]) {
        this.failedAssets.push({url: entry.url, ...this.manifest.failures[entry.url]});
        map.set(entry.url, "/missing");
        continue;
      }
      let record;
      try {
        record = await this.fetchRaw(entry.url, {offline});
      } catch (error) {
        if (error?.code === "reference_offline_miss") throw error;
        const failure = {code: error?.code ?? "reference_error", message: error?.message ?? String(error)};
        this.manifest.failures[entry.url] = failure;
        this.failedAssets.push({url: entry.url, ...failure});
        map.set(entry.url, "/missing");
        continue;
      }
      if (contentTypeIsCss(record.content_type)) {
        const nested = record.bytes.toString("utf8");
        const nestedMap = await this.#localizeCss(nested, record.final_url ?? entry.url, depth + 1, offline, visited);
        for (const [key, value] of nestedMap) map.set(key, value);
        const rewritten = rewriteCssReferences(nested, record.final_url ?? entry.url, map);
        const stored = await this.storeObject(Buffer.from(rewritten), record.content_type, {originalUrl: entry.url});
        map.set(entry.url, `/o/${stored.digest}`);
      } else {
        map.set(entry.url, `/o/${record.digest}`);
      }
    }
    return map;
  }

  async snapshot(rootUrl) {
    const manifest = await this.load();
    return manifest.snapshots[rootUrl] ?? null;
  }
}

async function readLimited(response, maxBytes, url) {
  const chunks = [];
  let total = 0;
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) fail("reference_object_too_large", `reference object exceeds ${maxBytes} bytes`, {url});
    return buffer;
  }
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      fail("reference_object_too_large", `reference object exceeds ${maxBytes} bytes`, {url});
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
