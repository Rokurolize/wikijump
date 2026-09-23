// Inline a port's local assets in the injected CSS. Wikijump's CSP permits
// data: images and fonts, but forbids a separate loopback asset origin.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import {fail} from "./errors.mjs";

const TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function assetNames(css) {
  const names = [...css.matchAll(/url\(\s*["']?\.\/assets\/([^)'"\s]+)["']?\s*\)/gu)].map((match) => match[1]);
  for (const name of names) {
    if (!name || name === "." || name === ".." || name.includes("..") || name.includes("/") || name.includes("\\")) {
      fail("invalid_candidate_asset", `invalid candidate asset URL: ${name}`);
    }
  }
  return [...new Set(names)];
}

export async function inspectCandidateAssets(css, rootDir) {
  const names = assetNames(css);
  const missing = [];
  for (const name of names) {
    try {
      const stat = await fs.lstat(path.join(rootDir, name));
      if (!stat.isFile()) missing.push(name);
    } catch {
      missing.push(name);
    }
  }
  return {referenced: names.length, missing};
}

export async function materializeCandidateCssAssets(css, rootDir) {
  const replacements = new Map();
  for (const name of assetNames(css)) {
    try {
      const file = path.join(rootDir, name);
      const stat = await fs.lstat(file);
      if (!stat.isFile()) continue;
      const bytes = await fs.readFile(file);
      const type = TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
      replacements.set(name, `data:${type};base64,${bytes.toString("base64")}`);
    } catch {
      // inspectCandidateAssets reports the missing file in the verdict.
    }
  }
  return css.replace(/url\(\s*["']?\.\/assets\/([^)'"\s]+)["']?\s*\)/gu, (whole, name) =>
    replacements.has(name) ? `url("${replacements.get(name)}")` : whole,
  );
}

export async function materializeCandidatePageImages(page, attachments, rootDir) {
  const rows = Array.isArray(attachments) ? attachments : [];
  const replacements = new Map();
  for (const row of rows) {
    if (!/^[a-f0-9]{64}\.[a-z0-9]+$/u.test(row.asset_file ?? "")) {
      fail("invalid_candidate_page_asset", `invalid content-addressed page asset: ${row.asset_file}`);
    }
    const file = path.join(rootDir, row.asset_file);
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat?.isFile()) continue;
    const bytes = await fs.readFile(file);
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (digest !== row.sha256) fail("candidate_page_asset_digest_mismatch", `page asset digest mismatch: ${row.filename}`);
    const type = TYPES[path.extname(row.asset_file).toLowerCase()] ?? "application/octet-stream";
    const dataUrl = `data:${type};base64,${bytes.toString("base64")}`;
    for (const url of row.source_urls ?? []) replacements.set(url, dataUrl);
    if (row.filename) replacements.set(row.filename, dataUrl);
  }
  return page.evaluate((mapping) => {
    let substituted = 0;
    for (const image of document.images) {
      const source = image.currentSrc || image.src || "";
      const filename = (() => {
        try {
          const parts = decodeURIComponent(new URL(source).pathname).split("/").filter(Boolean);
          const resized = parts.indexOf("local--resized-images");
          return resized >= 0 ? parts[resized + 1] : parts.at(-1);
        } catch { return source.split("/").at(-1); }
      })();
      const replacement = mapping[source] ?? mapping[filename];
      if (replacement) {
        image.src = replacement;
        substituted += 1;
      }
    }
    return substituted;
  }, Object.fromEntries(replacements));
}
