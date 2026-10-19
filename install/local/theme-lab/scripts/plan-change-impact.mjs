#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planChangeImpactFromRepository } from "../src/change-impact-plan.mjs";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const args = process.argv.slice(2);
const errors = [];
let paths;
if (args.length === 2 && args[0] === "--changed-paths-json") {
  try {
    paths = JSON.parse(fs.readFileSync(path.resolve(args[1]), "utf8"));
  } catch (error) {
    errors.push(error.message);
  }
} else if (args.length === 2 && args[0] === "--base") {
  try {
    const revision = execFileSync(
      "git",
      ["-C", repo, "rev-parse", "--verify", `${args[1]}^{commit}`],
      { encoding: "utf8" },
    ).trim();
    const diff = execFileSync("git", [
      "-C",
      repo,
      "diff",
      "--name-only",
      "-z",
      `${revision}...HEAD`,
    ]);
    paths = diff.toString("utf8").split("\0").filter(Boolean);
  } catch (error) {
    errors.push(error.message);
  }
} else
  errors.push(
    "usage: plan-change-impact.mjs --base BASE_COMMIT | --changed-paths-json FILE",
  );
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 2;
} else
  try {
    if (!Array.isArray(paths))
      throw new Error("changed path list must be an array");
    console.log(
      JSON.stringify(planChangeImpactFromRepository(repo, paths), null, 2),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
