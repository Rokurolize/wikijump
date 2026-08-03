#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { attestUntouchedListPagesAcceptanceSurface } from "../src/listpages-acceptance-surface.mjs";
import { sha256 } from "../src/syntax-differential.mjs";

const execFileAsync = promisify(execFile);

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new Error(`${arg} requires a value`);
      return next;
    };
    if (arg === "--base") args.base = value();
    else if (arg === "--head") args.head = value();
    else if (arg === "--prior-receipt") args.priorReceipt = path.resolve(value());
    else if (arg === "--current-receipt") args.currentReceipt = path.resolve(value());
    else if (arg === "--output") args.output = path.resolve(value());
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.help) return args;
  for (const key of ["base", "priorReceipt", "output"]) {
    if (!args[key]) throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  return args;
}

async function git(repositoryRoot, ...gitArgs) {
  const { stdout } = await execFileAsync("git", ["-C", repositoryRoot, ...gitArgs], {
    encoding: "utf8",
  });
  return stdout.trim();
}

export async function createListPagesAcceptanceAttestation({
  repositoryRoot,
  base,
  head = "HEAD",
  priorReceiptPath,
  currentReceiptPath = priorReceiptPath,
}) {
  const [baseRevision, headRevision, changedText, priorText, currentText] =
    await Promise.all([
      git(repositoryRoot, "rev-parse", base),
      git(repositoryRoot, "rev-parse", head),
      git(repositoryRoot, "diff", "--name-only", `${base}..${head}`),
      fs.readFile(priorReceiptPath, "utf8"),
      fs.readFile(currentReceiptPath, "utf8"),
    ]);
  const priorReceipt = JSON.parse(priorText);
  const currentReceipt = JSON.parse(currentText);
  const attestation = attestUntouchedListPagesAcceptanceSurface({
    baseRevision,
    headRevision,
    changedPaths: changedText === "" ? [] : changedText.split(/\r?\n/u),
    previousSurface: priorReceipt.acceptance_dependency_surface,
    currentSurface: currentReceipt.acceptance_dependency_surface,
    priorReceiptSha256: sha256(priorText),
  });
  return {
    ...attestation,
    prior_receipt_path: priorReceiptPath,
    current_receipt_path: currentReceiptPath,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(
      "Usage: attest-listpages-corpus-replay.mjs --base REV [--head REV] --prior-receipt FILE [--current-receipt FILE] --output FILE\n",
    );
    return 0;
  }
  const repositoryRoot = await git(path.dirname(new URL(import.meta.url).pathname), "rev-parse", "--show-toplevel");
  const attestation = await createListPagesAcceptanceAttestation({
    repositoryRoot,
    base: args.base,
    head: args.head,
    priorReceiptPath: args.priorReceipt,
    currentReceiptPath: args.currentReceipt,
  });
  await fs.mkdir(path.dirname(args.output), { recursive: true, mode: 0o700 });
  await fs.writeFile(args.output, `${JSON.stringify(attestation, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify(attestation, null, 2)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
