import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {runPromotion} from "../promote.mjs";

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const REPOSITORY = fileURLToPath(new URL("../../..", import.meta.url));

test("relative promote CLI path runs its main entrypoint", () => {
  const result = spawnSync(process.execPath, ["install/standing/promote.mjs", "--help"], {cwd: REPOSITORY, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage: promote\.mjs /u);
});

function options(root) {
  const file = (name) => path.join(root, name);
  return {
    "source-root": root,
    "candidate-receipt": file("candidate.json"),
    "final-frozen-receipt": file("final-frozen.json"),
    "candidate-identity": file("identity.json"),
    "live-reference": file("live.json"),
    "live-completion-policy": file("policy.json"),
    "build-evidence": file("build"),
    "staging-home": file("staging"),
    "admission-output": file("admission.json"),
    "promotion-precondition": file("promotion.json"),
    "prepared-receipt": file("prepared.json"),
    "runtime-home": file("runtime"),
    "standing-receipt": file("standing.json"),
  };
}

test("promotion controller stops before the next side effect when a stage fails", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "wikijump-promote-"));
  t.after(() => fsp.rm(root, {recursive: true, force: true}));
  const args = options(root);
  const calls = [];
  const run = (command, commandArgs) => {
    const script = path.basename(commandArgs[0]);
    if (script === "verify-standing-candidate-parity-admission.mjs") {
      calls.push("candidate-admission");
      assert.deepEqual(commandArgs.slice(1), ["--receipt", args["candidate-receipt"], "--candidate-identity", args["candidate-identity"], "--live-reference", args["live-reference"], "--live-completion-policy", args["live-completion-policy"], "--output", args["admission-output"]]);
      fs.writeFileSync(args["admission-output"], JSON.stringify({schema: "admission", status: "pass"}));
      return JSON.stringify({status: "pass", output: args["admission-output"], sha256: sha256(fs.readFileSync(args["admission-output"]))});
    }
    if (script === "prepare.py") {
      calls.push("prepare");
      fs.writeFileSync(args["prepared-receipt"], "prepared");
      return JSON.stringify({status: "pass", receipt: args["prepared-receipt"]});
    }
    calls.push("refresh");
    fs.writeFileSync(args["standing-receipt"], "standing");
    return JSON.stringify({status: "pass", receipt: args["standing-receipt"]});
  };
  const verifyPromotion = async ({outputPath, verifyAdmission, receiptPath, finalFrozenReceiptPath, candidateIdentityPath, liveReferencePath, liveCompletionPolicyPath, buildEvidencePath, stagingHomePath}) => {
    calls.push("promotion-precondition");
    assert.deepEqual({receiptPath, finalFrozenReceiptPath, candidateIdentityPath, liveReferencePath, liveCompletionPolicyPath, buildEvidencePath, stagingHomePath}, {receiptPath: args["candidate-receipt"], finalFrozenReceiptPath: args["final-frozen-receipt"], candidateIdentityPath: args["candidate-identity"], liveReferencePath: args["live-reference"], liveCompletionPolicyPath: args["live-completion-policy"], buildEvidencePath: args["build-evidence"], stagingHomePath: args["staging-home"]});
    assert.equal((await verifyAdmission()).schema, "admission");
    fs.writeFileSync(outputPath, "promotion");
    return {output: {path: outputPath, sha256: sha256("promotion")}};
  };

  const result = await runPromotion(args, {run, verifyPromotion});
  assert.deepEqual(calls, ["candidate-admission", "promotion-precondition", "prepare", "refresh"]);
  assert.equal(result.status, "pass");
  assert.equal(result.prepared_receipt.path, args["prepared-receipt"]);
  assert.equal(result.standing_receipt.path, args["standing-receipt"]);

  for (const failure of ["candidate-admission", "promotion-precondition", "prepare", "refresh"]) {
    const seen = [];
    const failingRun = (command, commandArgs) => {
      const script = path.basename(commandArgs[0]);
      const name = script === "verify-standing-candidate-parity-admission.mjs" ? "candidate-admission" : script === "prepare.py" ? "prepare" : "refresh";
      seen.push(name);
      if (name === failure) {
        if (failure === "refresh") fs.writeFileSync(args["standing-receipt"].replace(/\.json$/u, "-failure.json"), "failure");
        throw new Error(`${failure} failed`);
      }
      if (name === "candidate-admission") {
        fs.writeFileSync(args["admission-output"], JSON.stringify({schema: "admission", status: "pass"}));
        return JSON.stringify({status: "pass", output: args["admission-output"], sha256: sha256(fs.readFileSync(args["admission-output"]))});
      }
      if (name === "prepare") {
        fs.writeFileSync(args["prepared-receipt"], "prepared");
        return JSON.stringify({status: "pass", receipt: args["prepared-receipt"]});
      }
      return JSON.stringify({status: "pass", receipt: args["standing-receipt"]});
    };
    const failingVerify = async ({outputPath, verifyAdmission}) => {
      seen.push("promotion-precondition");
      if (failure === "promotion-precondition") throw new Error("promotion-precondition failed");
      await verifyAdmission();
      fs.writeFileSync(outputPath, "promotion");
      return {output: {path: outputPath, sha256: sha256("promotion")}};
    };
    await assert.rejects(runPromotion(args, {run: failingRun, verifyPromotion: failingVerify}), new RegExp(`${failure} failed`));
    assert.deepEqual(seen, ["candidate-admission", ...(failure === "candidate-admission" ? [] : ["promotion-precondition"]), ...(failure === "candidate-admission" || failure === "promotion-precondition" ? [] : ["prepare"]), ...(failure === "refresh" ? ["refresh"] : [])]);
    if (failure === "refresh") assert.equal(fs.existsSync(args["standing-receipt"].replace(/\.json$/u, "-failure.json")), true);
  }
});
