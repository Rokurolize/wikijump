#!/usr/bin/env node

import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";

import {verifyStandingPromotionPrecondition} from "./scripts/verify-promotion-precondition.mjs";

const REQUIRED = Object.freeze([
  "source-root",
  "candidate-receipt",
  "candidate-identity",
  "live-reference",
  "live-completion-policy",
  "build-evidence",
  "staging-home",
  "admission-output",
  "promotion-precondition",
  "prepared-receipt",
  "runtime-home",
  "standing-receipt",
]);

const ADMISSION_SCRIPT = "install/local/wikidot-verification/scripts/verify-standing-candidate-parity-admission.mjs";
const PREPARE_SCRIPT = "install/standing/prepare.py";
const REFRESH_SCRIPT = "install/standing/refresh.py";

function toCamelCase(key) {
  return key.replace(/-([a-z])/gu, (_, character) => character.toUpperCase());
}

export function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return {help: true};
    if (!flag?.startsWith("--") || !REQUIRED.includes(flag.slice(2))) {
      throw new Error(`unknown argument: ${flag}`);
    }
    const key = flag.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (Object.hasOwn(values, key)) throw new Error(`${flag} may be supplied only once`);
    values[key] = path.resolve(value);
    index += 1;
  }
  for (const key of REQUIRED) if (!values[key]) throw new Error(`--${key} is required`);
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [toCamelCase(key), value]));
}

export function usage() {
  return `Usage: promote.mjs --source-root DIR --candidate-receipt FILE --candidate-identity FILE --live-reference FILE --live-completion-policy FILE --build-evidence DIR --staging-home DIR --admission-output FILE --promotion-precondition FILE --prepared-receipt FILE --runtime-home DIR --standing-receipt FILE`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function artifact(pathname) {
  const bytes = await fs.readFile(pathname);
  return {path: path.resolve(pathname), sha256: sha256(bytes)};
}

function runSubprocess(command, args, {cwd, spawn = spawnSync} = {}) {
  const result = spawn(command, args, {cwd, encoding: "utf8", stdio: "pipe"});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`${path.basename(command)} failed${detail ? `: ${detail}` : ""}`);
  }
  return (result.stdout || "").trim();
}

function cliResult(stdout, name, expectedPath) {
  let result;
  try {
    result = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${name} did not return JSON: ${error.message}`);
  }
  if (result.status !== "pass" || path.resolve(result.output || result.receipt || "") !== path.resolve(expectedPath)) {
    throw new Error(`${name} did not return a passing receipt for ${expectedPath}`);
  }
  return result;
}

export async function runPromotion(rawArgs, {
  run = runSubprocess,
  verifyPromotion = verifyStandingPromotionPrecondition,
  node = process.execPath,
  python = process.env.PYTHON || "python3",
} = {}) {
  const args = Object.hasOwn(rawArgs, "sourceRoot")
    ? rawArgs
    : parseArgs(Object.entries(rawArgs).flatMap(([key, value]) => [`--${key}`, value]));
  const sourceRoot = args.sourceRoot;
  let stage = "candidate-admission";
  try {
    const admissionOutput = path.join(sourceRoot, ADMISSION_SCRIPT);
    const admissionResult = cliResult(
      run(node, [admissionOutput, "--receipt", args.candidateReceipt, "--candidate-identity", args.candidateIdentity, "--live-reference", args.liveReference, "--live-completion-policy", args.liveCompletionPolicy, "--output", args.admissionOutput], {cwd: sourceRoot}),
      "candidate admission",
      args.admissionOutput,
    );
    const admissionBytes = await fs.readFile(args.admissionOutput);
    if (sha256(admissionBytes) !== admissionResult.sha256) throw new Error("candidate admission receipt changed");
    const admission = JSON.parse(admissionBytes);
    stage = "promotion-precondition";
    const promotion = await verifyPromotion({
      receiptPath: args.candidateReceipt,
      candidateIdentityPath: args.candidateIdentity,
      liveReferencePath: args.liveReference,
      liveCompletionPolicyPath: args.liveCompletionPolicy,
      buildEvidencePath: args.buildEvidence,
      stagingHomePath: args.stagingHome,
      outputPath: args.promotionPrecondition,
      verifyAdmission: async () => admission,
    });
    if (path.resolve(promotion.output.path) !== path.resolve(args.promotionPrecondition)) {
      throw new Error("promotion precondition output path changed");
    }
    stage = "prepare";
    cliResult(
      run(python, [path.join(sourceRoot, PREPARE_SCRIPT), "--source-root", sourceRoot, "--promotion-precondition", args.promotionPrecondition, "--output", args.preparedReceipt], {cwd: sourceRoot}),
      "standing preparation",
      args.preparedReceipt,
    );
    const prepared = await artifact(args.preparedReceipt);
    stage = "refresh";
    cliResult(
      run(python, [path.join(sourceRoot, REFRESH_SCRIPT), "--source-root", sourceRoot, "--runtime-home", args.runtimeHome, "--prepared-receipt", args.preparedReceipt, "--receipt", args.standingReceipt], {cwd: sourceRoot}),
      "standing refresh",
      args.standingReceipt,
    );
    const standing = await artifact(args.standingReceipt);
    return {
      schema: "wikijump.standing_promotion_controller_result.v1",
      status: "pass",
      admission: {path: path.resolve(args.admissionOutput), sha256: admissionResult.sha256},
      promotion_precondition: {path: path.resolve(args.promotionPrecondition), sha256: promotion.output.sha256},
      prepared_receipt: {path: prepared.path, sha256: prepared.sha256},
      standing_receipt: {path: standing.path, sha256: standing.sha256},
    };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.stage = stage;
    throw failure;
  }
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  try {
    const parsed = parseArgs(argv);
    if (parsed.help) {
      console.log(usage());
      return 0;
    }
    console.log(JSON.stringify(await runPromotion(parsed, dependencies)));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({
      schema: "wikijump.standing_promotion_controller_result.v1",
      status: "fail",
      stage: error.stage ?? "arguments",
      error: error.message ?? String(error),
    }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; });
}
