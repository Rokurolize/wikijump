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
  return `Usage: run-candidate-cases.mjs --case-set open43-media-files|open43-settings-browser|open43-settings-analytics|open43-settings-theme|open43-mailform-fail-closed|open43-b610-shell --candidate-identity FILE --private-input PRIVATE.json --output-dir DIRECTORY

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
  if (name === "open43-media-files") {
    const { createOpen43MediaCandidateCaseSet } = await import("./open43-media-candidate-case-set.mjs");
    return createOpen43MediaCandidateCaseSet();
  }
  if (name === "open43-settings-browser") {
    const { createOpen43SettingsBrowserCandidateCaseSet } = await import("./open43-settings-browser-candidate-case-set.mjs");
    return createOpen43SettingsBrowserCandidateCaseSet();
  }
  if (name === "open43-settings-analytics" || name === "open43-settings-theme") {
    const { createOpen43SettingsGroupCandidateCaseSet } = await import("./open43-settings-browser-candidate-case-set.mjs");
    return createOpen43SettingsGroupCandidateCaseSet({ group: name === "open43-settings-analytics" ? "analytics" : "theme" });
  }
  if (name === "open43-mailform-fail-closed") {
    const { createOpen43MailformCandidateCaseSet } = await import("./open43-mailform-candidate-case-set.mjs");
    return createOpen43MailformCandidateCaseSet();
  }
  if (name === "open43-b610-shell") {
    const { createOpen43B610ShellCandidateCaseSet } = await import("./open43-b610-shell-candidate-case-set.mjs");
    return createOpen43B610ShellCandidateCaseSet();
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
