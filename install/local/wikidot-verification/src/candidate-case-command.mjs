import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { runCandidateCaseSet } from "./candidate-case-runner.mjs";
import {
  canonicalJson,
  readJsonObject,
  requirePlainObject,
  sha256File,
} from "./standing-browser-parity-util.mjs";

const OPTIONS = ["case-set", "candidate-identity", "private-input", "output-dir"];

export function candidateCaseUsage() {
  return `Usage: run-candidate-cases.mjs --case-set issue1373-amc-new-page|framerail-route-action-browser|comments-hideform-browser|open43-backlinks|open43-authoring|open43-categories|open43-media-files|open43-media-browser|open43-embedvideo-browser|open43-authoring-history|open43-page-tree|open43-page-query-nextprevious|open43-settings-browser|open43-settings-analytics|open43-settings-theme|open43-settings-toolbar|open43-settings-admin|open43-mailform-fail-closed|open43-b610-shell|open43-issue775-edit|open43-searchall|open43-a1038-admin-boundary|open43-q809|open43-q1032-members-userinfo|open43-q1036-search-feed|open43-q1040|open43-featuredsite|open43-689-tabview --candidate-identity FILE --private-input PRIVATE.json --output-dir DIRECTORY

Attaches to one sealed external non-standing candidate without owning its stack. PRIVATE.json must be a private regular file with no group or other permissions. Receipts retain only its SHA-256 and secret hashes.`;
}

export function parseCandidateCaseArgs(argv) {
  const values = argv[0] === "--" ? argv.slice(1) : argv;
  if (values.includes("--help") || values.includes("-h")) return { help: true };
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    const name = flag?.startsWith("--") ? flag.slice(2) : "";
    if (!OPTIONS.includes(name) || Object.hasOwn(args, name) || !value || value.startsWith("--")) throw new Error(`unknown or duplicate option: ${flag}\n${candidateCaseUsage()}`);
    args[name] = value;
  }
  for (const name of OPTIONS) if (!args[name]) throw new Error(`missing --${name}\n${candidateCaseUsage()}`);
  return args;
}

export async function readPrivateCandidateCaseInput(filePath) {
  const before = await fs.lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (before.mode & 0o077) !== 0) throw new Error("private input must be a private regular file with no group or other permissions");
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  let bytes;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || (opened.mode & 0o077) !== 0) throw new Error("private input changed while it was being opened");
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  let value;
  try {
    value = requirePlainObject(JSON.parse(bytes), "private candidate case input");
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("private candidate case input is not valid JSON");
    throw error;
  }
  return { value, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function candidateCaseSet(name) {
  if (name === "open43-backlinks") {
    const { createOpen43BacklinksCandidateCaseSet } = await import("./open43-backlinks-candidate-case-set.mjs");
    return createOpen43BacklinksCandidateCaseSet();
  }
  if (name === "open43-media-files") {
    const { createOpen43MediaCandidateCaseSet } = await import("./open43-media-candidate-case-set.mjs");
    return createOpen43MediaCandidateCaseSet();
  }
  if (name === "open43-media-browser") {
    const { createOpen43MediaBrowserCandidateCaseSet } = await import("./open43-media-browser-candidate.mjs");
    return createOpen43MediaBrowserCandidateCaseSet();
  }
  if (name === "open43-authoring-history") {
    const { createOpen43AuthoringHistoryCandidateCaseSet } = await import("./open43-authoring-history-candidate-case-set.mjs");
    return createOpen43AuthoringHistoryCandidateCaseSet();
  }
  if (name === "open43-page-tree") {
    const { createOpen43PageTreeCandidateCaseSet } = await import("./open43-page-tree-candidate-case-set.mjs");
    return createOpen43PageTreeCandidateCaseSet();
  }
  if (name === "open43-page-query-nextprevious") {
    const { createOpen43NextPreviousCandidateCaseSet } = await import("./open43-nextprevious-candidate-case-set.mjs");
    return createOpen43NextPreviousCandidateCaseSet();
  }
  if (name === "open43-embedvideo-browser") {
    const { createOpen43EmbedVideoBrowserCandidateCaseSet } = await import("./open43-embedvideo-browser-candidate.mjs");
    return createOpen43EmbedVideoBrowserCandidateCaseSet();
  }
  if (name === "open43-settings-browser") {
    const { createOpen43SettingsBrowserCandidateCaseSet } = await import("./open43-settings-browser-candidate-case-set.mjs");
    return createOpen43SettingsBrowserCandidateCaseSet();
  }
  if (["open43-settings-analytics", "open43-settings-theme", "open43-settings-toolbar", "open43-settings-admin"].includes(name)) {
    const { createOpen43SettingsGroupCandidateCaseSet } = await import("./open43-settings-browser-candidate-case-set.mjs");
    return createOpen43SettingsGroupCandidateCaseSet({ group: name.slice("open43-settings-".length) });
  }
  if (name === "open43-mailform-fail-closed") {
    const { createOpen43MailformCandidateCaseSet } = await import("./open43-mailform-candidate-case-set.mjs");
    return createOpen43MailformCandidateCaseSet();
  }
  if (name === "open43-b610-shell") {
    const { createOpen43B610ShellCandidateCaseSet } = await import("./open43-b610-shell-candidate-case-set.mjs");
    return createOpen43B610ShellCandidateCaseSet();
  }
  if (name === "open43-issue775-edit") {
    const { createOpen43Issue775EditCandidateCaseSet } = await import("./open43-issue775-edit-candidate-case-set.mjs");
    return createOpen43Issue775EditCandidateCaseSet();
  }
  if (name === "open43-searchall") {
    const { createOpen43Q807SearchAllCandidateCaseSet } = await import("./open43-q807-searchall-candidate-case-set.mjs");
    return createOpen43Q807SearchAllCandidateCaseSet();
  }
  if (name === "issue1373-amc-new-page") {
    const { createIssue1373AmcNewPageCandidateCaseSet } = await import("./issue1373-amc-new-page-candidate-case-set.mjs");
    return createIssue1373AmcNewPageCandidateCaseSet();
  }
  if (name === "framerail-route-action-browser") {
    const { createFramerailRouteActionCandidateCaseSet } = await import("./framerail-route-action-candidate-case-set.mjs");
    return createFramerailRouteActionCandidateCaseSet();
  }
  if (name === "comments-hideform-browser") {
    const { createCommentsHideformBrowserCandidateCaseSet } = await import("./comments-hideform-browser-candidate-case-set.mjs");
    return createCommentsHideformBrowserCandidateCaseSet();
  }
  if (name === "open43-a1038-admin-boundary") {
    const { createOpen43A1038AdminBoundaryCandidateCaseSet } = await import("./open43-a1038-admin-boundary-candidate-case-set.mjs");
    return createOpen43A1038AdminBoundaryCandidateCaseSet();
  }
  if (name === "open43-authoring") {
    const { createOpen43AuthoringCandidateCaseSet } = await import("./open43-authoring-candidate-case-set.mjs");
    return createOpen43AuthoringCandidateCaseSet();
  }
  if (name === "open43-q1032-members-userinfo") {
    const { createOpen43Q1032CandidateCaseSet } = await import("./open43-q1032-members-userinfo-candidate-case-set.mjs");
    return createOpen43Q1032CandidateCaseSet();
  }
  if (name === "open43-q1040") {
    const { createOpen43Q1040CandidateCaseSet } = await import("./open43-q1040-candidate-case-set.mjs");
    return createOpen43Q1040CandidateCaseSet();
  }
  if (name === "open43-q1036-search-feed") {
    const { createOpen43Q1036CandidateCaseSet } = await import("./open43-q1036-search-feed-candidate-case-set.mjs");
    return createOpen43Q1036CandidateCaseSet();
  }
  if (name === "open43-q809") {
    const { createOpen43Q809CandidateCaseSet } = await import("./open43-q809-candidate-case-set.mjs");
    return createOpen43Q809CandidateCaseSet();
  }
  if (name === "open43-categories") {
    const { createOpen43CategoriesCandidateCaseSet } = await import("./open43-categories-candidate-case-set.mjs");
    return createOpen43CategoriesCandidateCaseSet();
  }
  if (name === "open43-featuredsite") {
    const { createOpen43FeaturedSiteCandidateCaseSet } = await import("./open43-q810-featuredsite-candidate-case-set.mjs");
    return createOpen43FeaturedSiteCandidateCaseSet();
  }
  if (name === "open43-689-tabview") {
    const { createOpen43B689TabviewCandidateCaseSet } = await import("./open43-browser-689-candidate-case-set.mjs");
    return createOpen43B689TabviewCandidateCaseSet();
  }
  throw new Error(`unknown source-owned candidate case set: ${name}`);
}

function interruption() {
  const controller = new AbortController();
  const handlers = ["SIGINT", "SIGTERM"].map((name) => {
    const handler = () => controller.abort(new Error(`candidate case run interrupted by ${name}`));
    process.once(name, handler);
    return [name, handler];
  });
  return { signal: controller.signal, close: () => handlers.forEach(([name, handler]) => process.off(name, handler)) };
}

export async function runCandidateCaseCommand(args) {
  const [identity, identitySha256, privateInput, selectedCaseSet] = await Promise.all([
    readJsonObject(args["candidate-identity"], "candidate identity"),
    sha256File(args["candidate-identity"]),
    readPrivateCandidateCaseInput(args["private-input"]),
    candidateCaseSet(args["case-set"]),
  ]);
  const outputDir = path.resolve(args["output-dir"]);
  await fs.mkdir(path.dirname(outputDir), { recursive: true, mode: 0o700 });
  const signals = interruption();
  try {
    return await runCandidateCaseSet({
      candidateIdentity: identity,
      candidateIdentitySha256: identitySha256,
      privateInput: privateInput.value,
      privateInputSha256: privateInput.sha256,
      outputDir,
      caseSet: selectedCaseSet,
      signal: signals.signal,
    });
  } finally {
    signals.close();
  }
}

export async function candidateCaseMain(argv = process.argv.slice(2)) {
  const args = parseCandidateCaseArgs(argv);
  if (args.help) return void process.stdout.write(`${candidateCaseUsage()}\n`);
  process.stdout.write(canonicalJson(await runCandidateCaseCommand(args)));
}
