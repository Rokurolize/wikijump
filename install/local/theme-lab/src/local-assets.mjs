// Inline a port's local assets in the injected CSS. Wikijump's CSP permits
// data: images and fonts, but forbids a separate loopback asset origin.

import fs from "node:fs/promises";
import path from "node:path";

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
