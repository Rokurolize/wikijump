#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {
  inspectCandidateAssets,
  materializeCandidateCssAssets,
} from "../../src/local-assets.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = process.argv[2];
if (!output) {
  throw new Error("usage: node build.mjs /absolute/output.wikidot.txt");
}

const templateCss = await fs.readFile(path.join(here, "candidate-template.css"), "utf8");
const validationCss = await fs.readFile(path.join(here, "candidate.css"), "utf8");
const demoSource = await fs.readFile(path.join(here, "candidate.wikidot.txt"), "utf8");
const shell = await fs.readFile(path.join(here, "theme-shell.wikidot.txt"), "utf8");
const manifest = JSON.parse(await fs.readFile(path.join(here, "manifest.json"), "utf8"));
const assetDir = path.join(here, "assets");
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

const expectedValidationCss = templateCss.replace("{$sous-titre}", "夜明けまで忘れるな");
if (validationCss !== expectedValidationCss) {
  throw new Error("candidate.css is not the deterministic validation expansion of candidate-template.css");
}

for (const [file, expected] of [
  ["upstream-fr.wikidot.txt", manifest.source_sha256],
  ["upstream-ko.wikidot.txt", manifest.cross_branch_reference?.source_sha256],
  ["current-jp-hub.wikidot.txt", manifest.current_jp_usage?.source_sha256],
  ...((manifest.showcase_dependency_evidence ?? []).map((row) => [row.file, row.sha256])),
]) {
  const bytes = await fs.readFile(path.join(here, file));
  if (digest(bytes) !== expected) {
    throw new Error(`source provenance mismatch: ${file}`);
  }
}

const assets = await inspectCandidateAssets(templateCss, assetDir);
if (assets.missing.length) {
  throw new Error(`missing assets: ${assets.missing.join(", ")}`);
}
for (const row of manifest.assets ?? []) {
  const bytes = await fs.readFile(path.join(assetDir, row.name));
  if (bytes.length !== row.bytes || digest(bytes) !== row.sha256) {
    throw new Error(`asset provenance mismatch: ${row.name}`);
  }
}

const inlineTemplateCss = await materializeCandidateCssAssets(templateCss, assetDir);
const inlineDemoCss = inlineTemplateCss.replace("{$sous-titre}", "夜明けまで忘れるな");
const publishAssetRoot =
  "https://scp-jp.wdfiles.com/local--files/theme:quand-le-soleil-se-couche";
let publishCss = templateCss;
for (const row of manifest.assets ?? []) {
  const asset = row.name;
  publishCss = publishCss.replaceAll(
    `./assets/${asset}`,
    `${publishAssetRoot}/${encodeURIComponent(asset)}`,
  );
}

if (
  inlineTemplateCss.includes("./assets/") ||
  inlineDemoCss.includes("./assets/") ||
  publishCss.includes("./assets/")
) {
  throw new Error("build left an unresolved candidate asset");
}
if (
  /https?:\/\/(?:fondationscp\.wdfiles|fonts\.googleapis|fonts\.gstatic)/u.test(
    inlineTemplateCss,
  ) ||
  /https?:\/\/(?:fondationscp\.wdfiles|fonts\.googleapis|fonts\.gstatic)/u.test(
    publishCss,
  )
) {
  throw new Error("build left a foreign runtime asset dependency");
}

const cssModule = `[[module CSS]]\n${publishCss}\n[[/module]]`;
const themeSource = shell.replace("__THEME_CSS_MODULE__", cssModule);
const demo = `[[module CSS]]\n${inlineDemoCss}\n[[/module]]\n\n${demoSource}`;

await fs.mkdir(path.dirname(path.resolve(output)), {recursive: true});
await fs.writeFile(path.resolve(output), demo, "utf8");
const themeOutput = path.resolve(output).replace(/\.wikidot\.txt$/u, "-theme.wikidot.txt");
if (themeOutput === path.resolve(output)) {
  throw new Error("output must end in .wikidot.txt");
}
await fs.writeFile(themeOutput, themeSource, "utf8");

process.stdout.write(`${JSON.stringify({
  demo: {
    output: path.resolve(output),
    bytes: Buffer.byteLength(demo),
    sha256: digest(demo),
  },
  theme: {
    output: themeOutput,
    bytes: Buffer.byteLength(themeSource),
    sha256: digest(themeSource),
  },
  assets: manifest.assets?.map((row) => row.name) ?? [],
})}\n`);
